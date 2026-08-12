import { GoogleGenerativeAI } from "@google/generative-ai";
import { getProvider } from "@/lib/models";
import { fetchImageAsBase64 } from "@/lib/inference/shared";
import type { PromptVersion } from "@/types";
import type {
  ClassifiedRow,
  PromptDisagreementMetrics,
  SynthesisAnalysis,
} from "@/lib/promptCompare/types";
import type { PerPromptAnalysis, SynthesisDraft } from "@/lib/promptCompare/types";
import { normalizeLabelPolicy, normalizeDecisionRubric } from "@/lib/promptIteration/candidateGen";

function extractJsonHelper(text: string): any | null {
  const trimmed = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
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

interface LoadedImage {
  role: "disagreement" | "counterexample";
  caption: string;
  base64: string;
  mimeType: string;
}

const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const MAX_IMAGE_COUNT = 80;

function truncate(text: string | null | undefined, n: number): string {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function pct(x: number): string {
  return `${(Number(x || 0) * 100).toFixed(1)}%`;
}

export interface AnalyzerInput {
  model: string;
  temperature: number;
  detectionCode: string;
  detectionCategory: string;
  detectionDescription: string;
  sourcePrompts: Array<{
    prompt_version_id: string;
    label: string;
    label_policy: string;
    decision_rubric: string;
    user_prompt_addendum: string;
    system_prompt: string;
  }>;
  perPromptMetrics: PromptDisagreementMetrics[];
  disagreementImages: ClassifiedRow[];
  counterexampleImages: ClassifiedRow[];
  totalDisagreementCount: number;
}

export function buildStaticPrefix(input: AnalyzerInput): string {
  const promptBlocks = input.sourcePrompts
    .map(
      (p, i) =>
        [
          `— PROMPT ${i + 1} (id=${p.prompt_version_id}, label="${p.label}") —`,
          `label_policy:\n${p.label_policy.trim() || "(empty)"}`,
          `decision_rubric:\n${p.decision_rubric.trim() || "(empty)"}`,
          `detection_guidance (addendum):\n${p.user_prompt_addendum.trim() || "(empty)"}`,
        ].join("\n\n")
    )
    .join("\n\n");

  // Only require a field when at least one source actually uses it — otherwise
  // we bloat the merged prompt with structure the sources never needed. The
  // analyzer is still allowed to introduce a missing field, but only if doing
  // so meaningfully shortens the merged prompt vs inlining the same content.
  const anySourceLabelPolicy = input.sourcePrompts.some((p) => p.label_policy.trim().length > 0);
  const anySourceDecisionRubric = input.sourcePrompts.some((p) => p.decision_rubric.trim().length > 0);

  const labelPolicyRule = anySourceLabelPolicy
    ? "- label_policy: at least one source uses it. Keep it EXACTLY TWO LINES:\n    DETECTED: <one concise sentence>\n    NOT_DETECTED: <one concise sentence>"
    : "- label_policy: NONE of the source prompts use a label_policy. Emit an EMPTY STRING unless adding a two-line policy meaningfully SHORTENS the merged prompt vs inlining the same rules into the addendum.";

  const decisionRubricRule = anySourceDecisionRubric
    ? "- decision_rubric: at least one source uses it. Keep it to 3–7 plain-text criteria, ONE per line — no markdown, no bullets, no headings. Cut criteria that don't change decisions."
    : "- decision_rubric: NONE of the source prompts use a decision_rubric. Emit an EMPTY STRING unless adding a rubric meaningfully SHORTENS the merged prompt vs listing the same criteria in the addendum.";

  return [
    "You are auditing multiple prompt variants for a vision-language DETECTION task and SYNTHESIZING one master prompt from them.",
    "",
    `Detection code: ${input.detectionCode}`,
    `Detection category: ${input.detectionCategory}`,
    input.detectionDescription ? `Detection description: ${input.detectionDescription}` : "",
    "",
    "The N source prompts below were each independently authored and run on real data.",
    "Your job is to (1) identify each prompt's strengths and weaknesses,",
    "and (2) compile ONE synthesized prompt that keeps the strengths and eliminates the weaknesses.",
    "",
    "SOURCE PROMPTS (verbatim, in their entirety):",
    promptBlocks,
    "",
    "Ground rules for your synthesized prompt:",
    "- OPTIMIZE FOR THE SHORTEST MERGED PROMPT that captures every kept rule. Every sentence must change decisions; if it doesn't, cut it.",
    "- Do NOT introduce structure the sources didn't already use. If none of the sources have a decision_rubric, do not invent one. If none have a label_policy, do not invent one. Only add such a field when doing so meaningfully SHORTENS the overall prompt vs inlining the same content into the addendum.",
    "- You control up to THREE fields: label_policy, decision_rubric, and detection_guidance (the addendum). ANY of these MAY be an empty string.",
    labelPolicyRule,
    decisionRubricRule,
    "- The addendum MUST retain an EVIDENCE REQUIREMENT (instruct the model to populate the evidence field with a short phrase citing the specific visual basis for its decision).",
    "- Only generalizable morphology/eligibility/confuser rules. NEVER reference specific image ids, hex/RGB values, dataset-specific quirks, or single-image details.",
    "- The task description and JSON output schema are FIXED by the system; do NOT restate them or invent format/confidence rules.",
    "- Merge duplicated rules across sources into a single lean sentence. Delete anything a stronger source already covers.",
    "",
    "Return STRICT JSON only (no markdown), matching this exact shape (label_policy and decision_rubric MAY be empty strings):",
    "{",
    '  "per_prompt": [',
    '    {"prompt_version_id":"...","label":"...","strengths":["..."],"weaknesses":["..."]}',
    "  ],",
    '  "synthesis": {',
    '    "label":"synthesis-merge",',
    '    "rationale":"one paragraph — which strengths you kept from each prompt, which weaknesses you eliminated, and why (note any field you deliberately left empty)",',
    '    "label_policy":"" or "DETECTED: ...\\nNOT_DETECTED: ...",',
    '    "decision_rubric":"" or "1. ...\\n2. ...\\n3. ...",',
    '    "detection_guidance":"..."',
    "  }",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDynamicText(input: AnalyzerInput): string {
  const metricLines = input.perPromptMetrics
    .map(
      (m) =>
        `- ${m.label} (id=${m.prompt_version_id}): P ${pct(m.metrics.precision)} · R ${pct(m.metrics.recall)} · F1 ${pct(m.metrics.f1)} · TP ${m.tp} FP ${m.fp} FN ${m.fn} TN ${m.tn} · parse_fail ${m.parse_fail}`
    )
    .join("\n");

  return [
    `SCOPE: ${input.totalDisagreementCount} disagreement rows total across all shared datasets.`,
    `Attached are ${input.disagreementImages.length} disagreement images (highest teaching signal first) and ${input.counterexampleImages.length} agreement counterexamples.`,
    "",
    "Per-prompt metrics RESTRICTED to the disagreement set (this is where each prompt's real teaching signal lives):",
    metricLines,
    "",
    "For every attached DISAGREEMENT image below, its caption lists ground truth + reviewer note + each prompt's prediction and evidence.",
    "For every attached COUNTEREXAMPLE image, all prompts agreed with ground truth — use these as sanity checks so your synthesis does not overcorrect.",
  ].join("\n");
}

function rowCaption(row: ClassifiedRow, kind: "disagreement" | "counterexample"): string {
  const gt = row.ground_truth || "unknown";
  const note = row.reviewer_note ? ` Reviewer note: "${truncate(row.reviewer_note, 300)}".` : "";
  const perPrompt = row.per_prompt
    .map(
      (p) =>
        `    · ${p.prompt_version_id}: ${p.parse_ok ? p.predicted || "null" : "PARSE_FAIL"}${
          p.evidence ? ` — "${truncate(p.evidence, 220)}"` : ""
        }`
    )
    .join("\n");
  const header =
    kind === "counterexample"
      ? `AGREEMENT COUNTEREXAMPLE — ground truth ${gt}. All prompts got this right.${note}`
      : `DISAGREEMENT (${row.kind}) — ground truth ${gt}.${note}`;
  return `${header}\n  Per-prompt outputs:\n${perPrompt}`;
}

async function loadImages(
  rows: ClassifiedRow[],
  kind: "disagreement" | "counterexample",
  budget: { count: number; bytes: number }
): Promise<{ images: LoadedImage[]; usedBytes: number }> {
  const out: LoadedImage[] = [];
  let usedBytes = 0;
  for (const row of rows) {
    if (out.length >= budget.count) break;
    try {
      const { base64, mimeType } = await fetchImageAsBase64(row.image_uri);
      if (usedBytes + base64.length > budget.bytes) break;
      usedBytes += base64.length;
      out.push({ role: kind, caption: rowCaption(row, kind), base64, mimeType });
    } catch {
      // skip individual fetch failures
    }
  }
  return { images: out, usedBytes };
}

async function callAnthropic(
  apiKey: string,
  input: AnalyzerInput,
  staticText: string,
  dynamicText: string,
  images: LoadedImage[]
): Promise<string> {
  const content: any[] = [
    // Static prefix — cache eligible.
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
  for (const im of images) {
    content.push({ type: "text", text: im.caption });
    content.push({ type: "image", source: { type: "base64", media_type: im.mimeType, data: im.base64 } });
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 4096,
      temperature: input.temperature,
      system: "You return strict JSON only.",
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const json = await resp.json();
  return String(json.content?.[0]?.text || "");
}

async function callOpenAI(
  apiKey: string,
  input: AnalyzerInput,
  staticText: string,
  dynamicText: string,
  images: LoadedImage[]
): Promise<string> {
  const content: any[] = [
    { type: "text", text: staticText },
    { type: "text", text: dynamicText },
  ];
  for (const im of images) {
    content.push({ type: "text", text: im.caption });
    content.push({ type: "image_url", image_url: { url: `data:${im.mimeType};base64,${im.base64}` } });
  }
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You return strict JSON only." },
        { role: "user", content },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`OpenAI API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const json = await resp.json();
  return String(json.choices?.[0]?.message?.content || "");
}

async function callGemini(
  apiKey: string,
  input: AnalyzerInput,
  staticText: string,
  dynamicText: string,
  images: LoadedImage[]
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: input.model,
    generationConfig: { temperature: input.temperature, responseMimeType: "application/json" },
  });
  const parts: any[] = [{ text: staticText }, { text: dynamicText }];
  for (const im of images) {
    parts.push({ text: im.caption });
    parts.push({ inlineData: { mimeType: im.mimeType, data: im.base64 } });
  }
  const result = await model.generateContent({ contents: [{ role: "user", parts }] });
  return result.response.text();
}

export interface AnalyzerResult {
  analysis: SynthesisAnalysis;
  raw: string;
  imageCount: number;
  bytesUsed: number;
}

function coerceAnalysis(parsed: any, input: AnalyzerInput): SynthesisAnalysis {
  const perPromptRaw = Array.isArray(parsed?.per_prompt) ? parsed.per_prompt : [];
  const perPrompt: PerPromptAnalysis[] = input.sourcePrompts.map((sp) => {
    const match = perPromptRaw.find(
      (r: any) =>
        (r && typeof r === "object" && (r.prompt_version_id === sp.prompt_version_id || r.label === sp.label)) as boolean
    );
    return {
      prompt_version_id: sp.prompt_version_id,
      label: sp.label,
      strengths: Array.isArray(match?.strengths) ? match.strengths.map((s: any) => String(s)) : [],
      weaknesses: Array.isArray(match?.weaknesses) ? match.weaknesses.map((s: any) => String(s)) : [],
    };
  });
  const synRaw = parsed?.synthesis && typeof parsed.synthesis === "object" ? parsed.synthesis : {};
  const synthesis: SynthesisDraft = {
    label: typeof synRaw.label === "string" && synRaw.label.trim() ? synRaw.label.trim().slice(0, 60) : "synthesis-merge",
    rationale: typeof synRaw.rationale === "string" ? synRaw.rationale.trim() : "",
    label_policy: normalizeLabelPolicy(typeof synRaw.label_policy === "string" ? synRaw.label_policy : ""),
    decision_rubric: normalizeDecisionRubric(typeof synRaw.decision_rubric === "string" ? synRaw.decision_rubric : ""),
    detection_guidance: typeof synRaw.detection_guidance === "string" ? synRaw.detection_guidance.trim() : "",
  };
  return { per_prompt: perPrompt, synthesis };
}

/**
 * Run the analyzer LLM once — a single call that produces per-prompt analysis
 * + a synthesized prompt. On Anthropic the static prefix (framing + full source
 * prompt bodies) is marked cache-eligible so repeat runs for the same prompt
 * selection amortize the preamble tokens.
 */
export async function runAnalyzer(
  input: AnalyzerInput,
  apiKey: string,
  imageCap: number
): Promise<AnalyzerResult> {
  const budget = { count: Math.min(MAX_IMAGE_COUNT, Math.max(0, imageCap)), bytes: MAX_IMAGE_BYTES };
  const dis = await loadImages(input.disagreementImages, "disagreement", budget);
  const remainingBudget = {
    count: Math.max(0, budget.count - dis.images.length),
    bytes: Math.max(0, budget.bytes - dis.usedBytes),
  };
  const ctx = await loadImages(input.counterexampleImages, "counterexample", remainingBudget);
  const images = [...dis.images, ...ctx.images];

  const staticText = buildStaticPrefix(input);
  const dynamicText = buildDynamicText(input);

  const provider = getProvider(input.model);
  let raw: string;
  switch (provider) {
    case "openai":
      raw = await callOpenAI(apiKey, input, staticText, dynamicText, images);
      break;
    case "anthropic":
      raw = await callAnthropic(apiKey, input, staticText, dynamicText, images);
      break;
    case "gemini":
    default:
      raw = await callGemini(apiKey, input, staticText, dynamicText, images);
      break;
  }

  const parsed = extractJsonHelper(raw);
  if (!parsed) {
    throw new Error("Analyzer returned unparseable output");
  }
  const analysis = coerceAnalysis(parsed, input);
  // label_policy and decision_rubric are optional — the analyzer is instructed
  // to leave them empty when sources didn't use them. The addendum
  // (detection_guidance) is where the real rules live, so require that.
  if (!analysis.synthesis.detection_guidance.trim()) {
    throw new Error("Analyzer synthesis is missing detection_guidance");
  }
  return { analysis, raw, imageCount: images.length, bytesUsed: dis.usedBytes + ctx.usedBytes };
}

/** Extract the source-prompt fields the analyzer needs from a full PromptVersion. */
export function extractPromptFields(prompt: PromptVersion): {
  prompt_version_id: string;
  label: string;
  label_policy: string;
  decision_rubric: string;
  user_prompt_addendum: string;
  system_prompt: string;
} {
  const structure =
    prompt.prompt_structure && typeof prompt.prompt_structure === "object"
      ? (prompt.prompt_structure as any)
      : (() => {
          try {
            return JSON.parse(String(prompt.prompt_structure || "{}"));
          } catch {
            return {};
          }
        })();
  return {
    prompt_version_id: prompt.prompt_version_id,
    label: prompt.version_label,
    label_policy: String(structure.label_policy || ""),
    decision_rubric: String(structure.decision_rubric || ""),
    user_prompt_addendum: String(structure.user_prompt_addendum || ""),
    system_prompt: String(prompt.system_prompt || ""),
  };
}
