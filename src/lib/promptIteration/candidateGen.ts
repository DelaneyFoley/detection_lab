import { v4 as uuid } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getProvider } from "@/lib/models";
import { fetchImageAsBase64 } from "@/lib/inference/shared";
import type { FailureImage, FailureMode, PromptCandidate } from "@/lib/promptIteration/types";

export interface CandidateGenInput {
  model: string;
  detectionCode: string;
  detectionCategory: string;
  sourceVersionLabel: string;
  baseLabelPolicy: string;
  baseDecisionRubric: string;
  baseSystemPrompt: string;
  /** Editable detection-specific addendum (guidance body) of the user prompt. */
  baseUserAddendum: string;
  /** Fixed, non-editable guidelines (e.g. severity scale + general spec) always applied. */
  baseFixedGuidance: string;
  failureModes: FailureMode[];
  tuningSummary: {
    total: number;
    positives: number;
    negatives: number;
    fp: number;
    fn: number;
  };  goalF1: number | null;
  maxCandidates: number;
  /** Count of genuine parse errors in the baseline run (must be driven to 0). */
  baselineParseErrors?: number;
  /** Round number (1-based) for multi-round iteration. */
  round?: number;
  /** Summaries of prior rounds so the AI can build on wins and avoid repeats. */
  priorRounds?: Array<{
    round: number;
    label: string;
    f1: number;
    precision: number;
    recall: number;
    target_failure_mode: string;
    rejected_reasons: string[];
  }>;
  /**
   * The COMPLETE history of every candidate evaluated across all prior rounds
   * (promoted and rejected), so each new candidate refines against all of the
   * most relevant, up-to-date testing data.
   */
  testedCandidates?: Array<{
    round: number;
    label: string;
    kind: string;
    f1: number;
    precision: number;
    recall: number;
    parse_errors: number;
    promoted: boolean;
    rejected_reasons: string[];
    rubric_snippet?: string;
  }>;
  /**
   * Every false-positive and false-negative image from the baseline run, so the
   * generator can VISUALLY review its own mistakes before editing the prompt.
   * Attached to the model call (Gemini/OpenAI/Anthropic are all multimodal),
   * trimmed to a safe request-size budget. Empty/omitted = text-only behavior.
   */
  failureImages?: FailureImage[];
}

/** Collapse redundant whitespace / duplicate lines to produce a lean variant. */
function leanText(text: string): string {
  const seen = new Set<string>();
  return (text || "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => {
      if (!l) return false;
      const key = l.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

const CONSERVATIVE_RULE =
  "When evidence is ambiguous, insufficient, or the target component is not clearly eligible, default to NOT_DETECTED.";
const RECALL_RULE =
  "Treat partial but morphologically consistent evidence as DETECTED unless a known confuser better explains it.";

/** A misclassified image fetched and encoded for attachment to the model call. */
interface LoadedFailureImage {
  outcome: "FP" | "FN";
  label: string;
  base64: string;
  mimeType: string;
}

// Keep the total attached-image payload under the providers' inline-request
// limits (Gemini ~20MB, others similar). Base64 inflates bytes ~33%, so budget
// the encoded size conservatively and cap the count.
const MAX_FAILURE_IMAGE_BYTES = 14 * 1024 * 1024;
const MAX_FAILURE_IMAGE_COUNT = 80;

/**
 * Fetch and encode failure images up to a size/count budget. Images are already
 * interleaved (FN/FP) upstream, so a budget cut keeps both error types present.
 * Best-effort: individual fetch failures are skipped, never fatal.
 */
async function loadFailureImageParts(images: FailureImage[]): Promise<LoadedFailureImage[]> {
  const out: LoadedFailureImage[] = [];
  let bytes = 0;
  for (const img of images) {
    if (out.length >= MAX_FAILURE_IMAGE_COUNT) break;
    try {
      const { base64, mimeType } = await fetchImageAsBase64(img.image_uri);
      if (bytes + base64.length > MAX_FAILURE_IMAGE_BYTES) break;
      bytes += base64.length;
      const gt = img.ground_truth || "unknown";
      const label =
        img.outcome === "FN"
          ? `FALSE NEGATIVE — ground truth ${gt}, but the model returned NOT_DETECTED. What visible evidence was missed here?`
          : `FALSE POSITIVE — ground truth ${gt}, but the model returned DETECTED. What confuser was mistaken for the hazard here?`;
      out.push({ outcome: img.outcome, label, base64, mimeType });
    } catch {
      // Skip unresolvable images; continue with the rest.
    }
  }
  return out;
}

/**
 * Deterministic, generic candidates used when no AI is available or the AI
 * returns invalid JSON. These are intentionally morphology/behavior based and
 * never reference specific images, ids, colors, or layouts.
 */
export function fallbackCandidates(input: CandidateGenInput): PromptCandidate[] {
  const leanPolicy = leanText(input.baseLabelPolicy);
  const leanRubric = leanText(input.baseDecisionRubric);
  const candidates: PromptCandidate[] = [
    {
      id: uuid(),
      kind: "lean",
      label: "Lean refactor",
      target_failure_mode: "prompt bloat / redundancy",
      rationale: "Removes redundant and duplicated guidance while preserving every generalizable rule.",
      label_policy: leanPolicy,
      decision_rubric: leanRubric,
    },
    {
      id: uuid(),
      kind: "conservative",
      label: "Precision guard",
      target_failure_mode: "false positives",
      rationale: "Adds a single compact conservative-default rule to curb over-detection.",
      label_policy: leanPolicy,
      decision_rubric: [leanRubric, CONSERVATIVE_RULE].filter(Boolean).join("\n"),
    },
  ];
  // Add a recall-oriented candidate only when false negatives dominate.
  if (input.tuningSummary.fn >= input.tuningSummary.fp && input.tuningSummary.fn > 0) {
    candidates.push({
      id: uuid(),
      kind: "recall",
      label: "Recall boost",
      target_failure_mode: "false negatives",
      rationale: "Broadens acceptance of partial-but-consistent morphology without hardcoding examples.",
      label_policy: leanPolicy,
      decision_rubric: [leanRubric, RECALL_RULE].filter(Boolean).join("\n"),
    });
  }
  return candidates.slice(0, Math.max(1, input.maxCandidates));
}

function buildAIPrompt(input: CandidateGenInput): string {
  const fmLines = input.failureModes.length
    ? input.failureModes
        .map(
          (m) =>
            `- ${m.name} (${m.count} case(s)). Example evidence: ${
              m.example_evidence.slice(0, 3).map((e) => `"${e.slice(0, 160)}"`).join("; ") || "n/a"
            }`
        )
        .join("\n")
    : "- No dominant failure mode.";

  const priorLines = (input.priorRounds || [])
    .map(
      (r) =>
        `- Round ${r.round} ("${r.label}", targeted ${r.target_failure_mode || "general"}): F1 ${(r.f1 * 100).toFixed(1)}%, P ${(r.precision * 100).toFixed(1)}%, R ${(r.recall * 100).toFixed(1)}%.` +
        (r.rejected_reasons.length ? ` Rejected variants: ${r.rejected_reasons.slice(0, 2).join("; ")}.` : "")
    )
    .join("\n");

  const historyLines = (input.testedCandidates || [])
    .map(
      (c) =>
        `- R${c.round} ${c.kind} "${c.label}": F1 ${(c.f1 * 100).toFixed(1)}% · P ${(c.precision * 100).toFixed(1)}% · R ${(c.recall * 100).toFixed(1)}% · parse_err ${c.parse_errors} · ${
          c.promoted ? "PROMOTED (became the new base)" : `REJECTED${c.rejected_reasons[0] ? ` — ${c.rejected_reasons[0]}` : ""}`
        }${c.rubric_snippet ? `\n    rubric tried: "${c.rubric_snippet}"` : ""}`
    )
    .join("\n");

  return [
    "You are tuning a vision-language DETECTION prompt to improve F1 on UNSEEN data.",
    "You must NOT overfit to the reviewed images.",
    input.round && input.round > 1
      ? `This is iteration round ${input.round}. The base prompt below already incorporates the best prompt so far — refine it further; do not repeat changes that were already rejected.`
      : "",
    "",
    `Detection code: ${input.detectionCode}`,
    `Detection category: ${input.detectionCategory}`,
    `Tuning slice: ${input.tuningSummary.total} images (${input.tuningSummary.positives} positive, ${input.tuningSummary.negatives} negative), with ${input.tuningSummary.fp} false positives and ${input.tuningSummary.fn} false negatives.`,
    input.goalF1 != null ? `Target F1 to reach: ${(input.goalF1 * 100).toFixed(1)}%.` : "",
    priorLines ? "\nBest prompt per round so far:\n" + priorLines : "",
    historyLines
      ? "\nCOMPLETE history of every candidate tested so far (learn from ALL of it — build on the highest scorers, do NOT re-propose approaches already rejected for the same reason):\n" +
        historyLines
      : "",
    "",
    "Current base prompt (the best found so far) — refine THIS:",
    input.baseFixedGuidance
      ? "FIXED guidelines (ALWAYS applied automatically, you CANNOT change or remove them — tune AROUND them and do NOT restate, duplicate, or contradict them):\n" +
        input.baseFixedGuidance
      : "",
    "Detection-specific guidance (a FREE-FORM supporting section of the user prompt — you have total creative freedom over its content and structure):",
    input.baseUserAddendum || "(empty)",
    "",
    "Label policy:",
    input.baseLabelPolicy || "(empty)",
    "",
    "Decision rubric:",
    input.baseDecisionRubric || "(empty)",
    "",
    "Observed failure modes:",
    fmLines,
    "",
    (input.failureImages && input.failureImages.length)
      ? [
          "ATTACHED IMAGES: the actual misclassified images from this run are attached below, each captioned as FALSE NEGATIVE or FALSE POSITIVE with its ground truth.",
          "Visually study them before editing: for false negatives, identify the real hazard morphology the model missed; for false positives, identify the confuser it mistook for the hazard.",
          "Turn the RECURRING visual patterns you see into GENERAL, morphology-based rules (do NOT describe or hardcode any single image). Prioritize whichever error type dominates.",
          "",
        ].join("\n")
      : "",
    "Rules for your candidates:",
    "- You control THREE fields: label_policy, decision_rubric, and detection_guidance (the addendum). Concentrate the decision logic in the POLICY and RUBRIC first — those are the primary levers. Use the addendum freely for whatever remains high-signal: key highlights, sharp edge-case/confuser rules, or reminders. You may restructure or drop the current addendum entirely — do NOT feel bound to its existing eligibility/severity/look-alike/evidence layout.",
    "- The addendum's ONE mandatory element is an EVIDENCE REQUIREMENT: it must always instruct the model to populate the evidence field with a short phrase citing the specific visual basis for the decision. Keep this even in the leanest addendum (the system will add it if you omit it, but include it deliberately).",
    "- MAXIMIZE F1 with the LEANEST possible prompt. Fewer tokens is better. Keep a rule ONLY if it changes a decision; cut anything redundant, obvious, restated, or low-impact. A shorter prompt that holds or improves F1 is strictly preferred.",
    "- The task description and the JSON OUTPUT SCHEMA are FIXED by the system and appended automatically. NEVER restate, redefine, or invent a schema/format/confidence scale. Do NOT include any 'Return JSON', 'format instruction', markdown, or confidence-value rules in your output — they will conflict with the real schema (confidence is a float 0-1).",
    "- STRICT FIELD FORMATS (these are parsed into structured UI fields — follow exactly):",
    "  • label_policy MUST be EXACTLY TWO LINES, each starting with the label and a colon, on separate lines:\n      DETECTED: <one concise sentence>\n      NOT_DETECTED: <one concise sentence>\n    Never put both on one line; never omit NOT_DETECTED; never add other lines.",
    "  • decision_rubric MUST be 3–7 criteria, ONE per line, as PLAIN TEXT sentences. NO markdown at all: no ** bold **, no *, -, or • bullets, no nested/indented sub-items, no headings. You may number the lines 1., 2., 3., … (they will be renumbered automatically). Each line is one standalone, self-contained criterion.",
    "- Only generalizable rules based on visual morphology, component eligibility, known confusers, and image-quality constraints.",
    "- NEVER reference specific image ids, exact examples, hardcoded pixel/hex/RGB color values, layouts, or dataset-specific quirks.",
    "- You MAY use GENERIC corrosion color families when tied to morphology (e.g., reddish-brown iron-oxide staining, orange/brown rust, green or blue-green copper patina, black/dark oxidation, white powdery mineral/salt deposits) as generalizable visual cues — but never a single image's exact palette or specific color values.",
    "- Preserve deterministic conservative defaults for unclear/insufficient evidence.",
    "- Keep evidence output concise.",
    "- PARSE ERRORS ARE UNACCEPTABLE. The model MUST always return exactly the strict JSON object {\"decision\", \"confidence\", \"evidence\"} and nothing else — but you do NOT write those format rules; the system enforces them.",
    (input.baselineParseErrors ?? 0) > 0
      ? `- The current prompt produced ${input.baselineParseErrors} parse error(s); eliminating ALL of them is a required objective.`
      : "",
    "",
    input.maxCandidates <= 1
      ? [
          "Write ONE improved, COMPLETE prompt (a fresh detection_guidance + label_policy + decision_rubric) as the next step in a single evolving chain.",
          "  It MUST be MATERIALLY DIFFERENT from the current base prompt above — do NOT return the base unchanged and do NOT merely reformat or re-order it.",
          "  Make a concrete, testable change to the DECISION LOGIC that targets the dominant failure modes: eliminate parse errors first, then reduce whichever of false positives / false negatives dominates.",
          "  Build on the highest-scoring prompt in the history and avoid approaches already shown not to help. Stay general and lean. Return EXACTLY ONE object in the candidates array.",
        ].join("\n")
      : `Generate ${input.maxCandidates} DISTINCT candidates, each targeting a different failure mode (at least one lean/refactored, one precision-protecting, and — when false negatives dominate — one recall-oriented).`,
    "",
    "Return STRICT JSON only, no markdown, matching:",
    '{"candidates":[{"kind":"lean|conservative|recall|balanced","label":"short name","target_failure_mode":"...","rationale":"...","detection_guidance":"...","label_policy":"...","decision_rubric":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJson(text: string): any | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Remove inline markdown emphasis/backticks/indentation that breaks structured parsing. */
function stripInlineMarkdown(text: string): string {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`+/g, "")
    .replace(/^\s{2,}/gm, "");
}

/**
 * Normalize a label policy into the exact two-line form the app parses into its
 * DETECTED / NOT_DETECTED fields: `DETECTED: …` then `NOT_DETECTED: …`, even when
 * the model returned them on one line or with markdown decoration.
 */
export function normalizeLabelPolicy(text: string): string {
  const raw = stripInlineMarkdown(String(text || "")).replace(/\r\n/g, "\n").trim();
  if (!raw) return raw;
  // Locate the NOT_DETECTED marker anywhere (line start or mid-line).
  const ndMatch = raw.match(/NOT[_\s-]?DETECTED\s*:/i);
  let detectedPart = raw;
  let notDetectedPart = "";
  if (ndMatch && ndMatch.index != null) {
    detectedPart = raw.slice(0, ndMatch.index);
    notDetectedPart = raw.slice(ndMatch.index + ndMatch[0].length);
  }
  const detected = detectedPart.replace(/^\s*DETECTED\s*:/i, "").replace(/\s+/g, " ").trim();
  const notDetected = notDetectedPart.replace(/\s+/g, " ").trim();
  return `DETECTED: ${detected}\nNOT_DETECTED: ${notDetected}`.trimEnd();
}

/**
 * Normalize a decision rubric into plain, numbered one-per-line criteria with all
 * markdown stripped, matching the app's rubric parser (splits on lines, strips a
 * leading number/bullet). Criteria are renumbered 1., 2., 3., … for consistency
 * with the app's original rubric format.
 */
export function normalizeDecisionRubric(text: string): string {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripInlineMarkdown(line).trim())
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").replace(/^\s*[-*+•]\s*/, "").trim())
    .filter(Boolean);
  return lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
}

function coerceCandidates(parsed: any, input: CandidateGenInput): PromptCandidate[] {
  const arr = Array.isArray(parsed?.candidates) ? parsed.candidates : Array.isArray(parsed) ? parsed : [];
  const out: PromptCandidate[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const labelPolicy = typeof raw.label_policy === "string" ? raw.label_policy.trim() : "";
    const decisionRubric = typeof raw.decision_rubric === "string" ? raw.decision_rubric.trim() : "";
    const detectionGuidance = typeof raw.detection_guidance === "string" ? raw.detection_guidance.trim() : "";
    if (!labelPolicy && !decisionRubric && !detectionGuidance) continue;
    const kind = ["lean", "conservative", "recall", "balanced"].includes(raw.kind) ? raw.kind : "balanced";
    out.push({
      id: uuid(),
      kind,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 60) : `${kind} candidate`,
      target_failure_mode: typeof raw.target_failure_mode === "string" ? raw.target_failure_mode.trim() : "",
      rationale: typeof raw.rationale === "string" ? raw.rationale.trim() : "",
      // Normalize so the policy/rubric parse cleanly into the app's structured
      // fields (two-line DETECTED/NOT_DETECTED; plain one-per-line criteria).
      label_policy: normalizeLabelPolicy(labelPolicy || input.baseLabelPolicy),
      decision_rubric: normalizeDecisionRubric(decisionRubric || input.baseDecisionRubric),
      system_prompt: typeof raw.system_prompt === "string" && raw.system_prompt.trim() ? raw.system_prompt.trim() : null,
      user_prompt_addendum: detectionGuidance ? detectionGuidance : null,
    });
  }
  return out.slice(0, Math.max(1, input.maxCandidates));
}

function buildOpenAIRequest(input: CandidateGenInput, temperature: number, imageParts: LoadedFailureImage[]) {
  const content: any[] = [{ type: "text", text: buildAIPrompt(input) }];
  for (const im of imageParts) {
    content.push({ type: "text", text: im.label });
    content.push({ type: "image_url", image_url: { url: `data:${im.mimeType};base64,${im.base64}` } });
  }
  return {
    model: input.model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You generate strict JSON only." },
      { role: "user", content },
    ],
  };
}

function buildAnthropicRequest(input: CandidateGenInput, temperature: number, imageParts: LoadedFailureImage[]) {
  const content: any[] = [{ type: "text", text: buildAIPrompt(input) }];
  for (const im of imageParts) {
    content.push({ type: "text", text: im.label });
    content.push({ type: "image", source: { type: "base64", media_type: im.mimeType, data: im.base64 } });
  }
  return {
    model: input.model,
    max_tokens: 1024,
    temperature,
    system: "You generate strict JSON only.",
    messages: [{ role: "user", content }],
  };
}

async function generateCandidateText(
  input: CandidateGenInput,
  apiKey: string,
  temperature: number,
  imageParts: LoadedFailureImage[]
): Promise<string> {
  const provider = getProvider(input.model);
  switch (provider) {
    case "openai": {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildOpenAIRequest(input, temperature, imageParts)),
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`OpenAI API ${resp.status}: ${errBody.slice(0, 200)}`);
      }
      const json = await resp.json();
      return String(json.choices?.[0]?.message?.content || "");
    }
    case "anthropic": {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(buildAnthropicRequest(input, temperature, imageParts)),
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Anthropic API ${resp.status}: ${errBody.slice(0, 200)}`);
      }
      const json = await resp.json();
      return String(json.content?.[0]?.text || "");
    }
    case "gemini":
    default: {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: input.model,
        generationConfig: { temperature, responseMimeType: "application/json" },
      });
      const parts: any[] = [{ text: buildAIPrompt(input) }];
      for (const im of imageParts) {
        parts.push({ text: im.label });
        parts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
      }
      const result = await model.generateContent({ contents: [{ role: "user", parts }] });
      return result.response.text();
    }
  }
}

/**
 * Generate candidate prompt variants. Uses Gemini when a key is available, and
 * falls back to deterministic generic candidates on any failure so the workflow
 * can still proceed. Returns `{ candidates, usedAI, error? }`.
 */
export async function generateCandidates(
  input: CandidateGenInput,
  apiKey: string | null
): Promise<{ candidates: PromptCandidate[]; usedAI: boolean; error?: string }> {
  const key = String(apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!key) {
    return { candidates: fallbackCandidates(input), usedAI: false, error: "no API key" };
  }
  const temperature = Math.min(0.9, 0.4 + 0.08 * Math.max(0, (input.round ?? 1) - 1));
  // Fetch the misclassified images once (not per retry) so the generator can
  // visually review its own FP/FN before rewriting the prompt.
  const imageParts = input.failureImages && input.failureImages.length
    ? await loadFailureImageParts(input.failureImages)
    : [];
  let lastError: string | undefined;
  // Retry once on transient failure / unparseable output before falling back.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rawText = await generateCandidateText(input, key, temperature, imageParts);
      const parsed = extractJson(rawText);
      const candidates = coerceCandidates(parsed, input);
      if (candidates.length === 0) {
        lastError = "AI returned no usable candidate JSON";
        continue;
      }
      // Only guarantee a lean option in multi-candidate (beam) mode. In
      // single-prompt mode, return the AI's actual candidate untouched —
      // prepending the fallback here would silently discard the AI output.
      if (input.maxCandidates > 1 && !candidates.some((c) => c.kind === "lean")) {
        candidates.unshift(fallbackCandidates(input)[0]);
      }
      return { candidates: candidates.slice(0, Math.max(1, input.maxCandidates)), usedAI: true };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { candidates: fallbackCandidates(input), usedAI: false, error: lastError };
}
