import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type { PromptComposition, ProductionSnapshot, SiblingDetection, Decision } from "@/types";
import { buildImagePart } from "@/lib/gemini";
import { AGG_MARKER, compileAggregatePrompt, extractPreamble } from "@/lib/inference/aggregateCompile";

export { AGG_MARKER, compileAggregatePrompt, extractPreamble };

// Per-attempt cap so a stalled model call fails and the run can finish instead
// of a worker blocking forever on one image.
const AGGREGATE_TIMEOUT_MS = 90_000;

const THINKING_LEVEL_BY_VALUE: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** Map a snapshot's thinking level to a @google/genai thinkingConfig, if valid. */
function toThinkingConfig(level: string | null | undefined): { thinkingLevel: ThinkingLevel } | undefined {
  const mapped = THINKING_LEVEL_BY_VALUE[String(level || "").toLowerCase()];
  return mapped ? { thinkingLevel: mapped } : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type LabelVerdict = { label: string; present: boolean; reasoning: string };

export type AggregateInferenceResult = {
  decision: Decision | null;
  evidence: string | null;
  siblings: SiblingDetection[];
  emittedLabels: string[];
  /** Per-label verdict + reasoning (multi-label mode); captures negative evidence. */
  labelVerdicts: LabelVerdict[];
  raw: string;
  parseOk: boolean;
  parseErrorReason: string | null;
  runtimeMs: number;
  thinkingApplied: boolean;
};

/**
 * Derive the target outcome from a parsed multi-detection list using PRESENCE
 * semantics: the target is DETECTED iff its label appears in the list. Sibling
 * labels are captured for evidence/export but never scored.
 */
export function deriveAggregateOutcome(
  list: Array<{ detection?: unknown; reasoning?: unknown }>,
  targetLabel: string | null
): { decision: Decision; evidence: string | null; siblings: SiblingDetection[]; emittedLabels: string[] } {
  const emittedLabels = list.map((d) => String(d.detection ?? ""));
  const targetPresent = !!targetLabel && emittedLabels.includes(targetLabel);
  const targetEntry = list.find((d) => String(d.detection ?? "") === targetLabel);
  const siblings: SiblingDetection[] = list
    .filter((d) => String(d.detection ?? "") !== targetLabel)
    .map((d) => ({ label: String(d.detection ?? ""), reasoning: String(d.reasoning ?? "") }));
  return {
    decision: targetPresent ? "DETECTED" : "NOT_DETECTED",
    evidence: targetEntry ? String(targetEntry.reasoning ?? "") : null,
    siblings,
    emittedLabels,
  };
}

/**
 * Strict validation of the aggregate payload, mirroring production's pydantic
 * `model_validate`: enforce the object/array shape, string fields, and that every
 * emitted label is one of the context's allowed labels (the schema enum). Returns
 * a human-readable reason on violation, or null when valid. Label matching is
 * case-insensitive to avoid spurious retries while still catching hallucinations.
 */
export function validateAggregatePayload(parsed: unknown, labels: string[]): string | null {
  if (!parsed || typeof parsed !== "object") {
    return "Response was not a JSON object matching the aggregate schema.";
  }
  const detections = (parsed as { detections?: unknown }).detections;
  if (!Array.isArray(detections)) {
    return "Response is missing the required 'detections' array.";
  }
  const allowed = labels.length > 0 ? new Set(labels.map((l) => l.toLowerCase())) : null;
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    if (!d || typeof d !== "object") {
      return `detections[${i}] is not an object.`;
    }
    const detection = (d as { detection?: unknown }).detection;
    const reasoning = (d as { reasoning?: unknown }).reasoning;
    if (typeof detection !== "string" || !detection.trim()) {
      return `detections[${i}] is missing a string 'detection' label.`;
    }
    if (typeof reasoning !== "string") {
      return `detections[${i}] is missing a string 'reasoning'.`;
    }
    if (allowed && !allowed.has(detection.toLowerCase())) {
      return `detections[${i}] has out-of-schema label "${detection}" (not in the context's allowed labels).`;
    }
  }
  return null;
}

/**
 * Execute a PRODUCTION_MODE aggregate inference: one call over the whole context
 * composition returning a multi-label list. The target's decision is derived by
 * PRESENCE of its label; sibling labels are captured (not scored).
 *
 * Parity note (D19): temperature 0, pinned model, the exact prompt/schema, and
 * the context's thinking level all match production via the @google/genai SDK.
 * Only the image transport (inline base64 vs production's GCS URI) differs, which
 * is an accepted, reported deviation.
 */
export async function runAggregateInference(
  apiKey: string,
  params: {
    model: string;
    snapshot: ProductionSnapshot;
    composition: PromptComposition;
    targetLabel: string | null;
    imageUri: string;
    multiLabel?: boolean;
  }
): Promise<AggregateInferenceResult> {
  const { model, snapshot, composition, targetLabel, imageUri, multiLabel = false } = params;
  const enabled = composition.members.filter((m) => m.enabled);
  const labels = Array.from(new Set(enabled.map((m) => m.label)));
  const preamble = composition.preamble ?? extractPreamble(snapshot.built_prompt);
  const basePrompt = compileAggregatePrompt(
    preamble,
    enabled.map((m) => ({ label: m.label, description: m.description }))
  );
  // Multi-label mode captures a verdict + reasoning for EVERY listed detection
  // (including why a detection is NOT present) so negative evidence is available
  // for troubleshooting. Single-target mode keeps the exact production prompt.
  const prompt = multiLabel
    ? `${basePrompt}\n\nFor EACH detection listed above, return one entry containing its exact label, a boolean "present" indicating whether it is present in the image, and concise "reasoning" explaining your decision. Always include reasoning, even when "present" is false.`
    : basePrompt;

  const responseSchema = {
    type: Type.OBJECT,
    required: ["detections"],
    properties: {
      detections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: multiLabel ? ["detection", "present", "reasoning"] : ["detection", "reasoning"],
          // Match production's pydantic field order (detection before reasoning).
          propertyOrdering: multiLabel ? ["detection", "present", "reasoning"] : ["detection", "reasoning"],
          properties: {
            detection: labels.length > 0 ? { type: Type.STRING, enum: labels } : { type: Type.STRING },
            ...(multiLabel ? { present: { type: Type.BOOLEAN } } : {}),
            reasoning: { type: Type.STRING },
          },
        },
      },
    },
  };

  const ai = new GoogleGenAI({ apiKey });
  // Prefer the (editable) composition's thinking level; fall back to the frozen snapshot.
  const thinkingConfig = toThinkingConfig(composition.thinking_level || snapshot.thinking_level);
  const thinkingApplied = !!thinkingConfig;
  const imageParts = await buildImagePart(imageUri);
  const startedAt = Date.now();
  const modelName = model || composition.google_model || snapshot.google_model || "gemini-2.5-flash";
  const maxAttempts = 3;
  let lastErrorReason: string | null = null;
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGGREGATE_TIMEOUT_MS);
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ text: prompt }, ...imageParts],
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
          abortSignal: controller.signal,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
      clearTimeout(timer);
      const raw = response.text ?? "";
      lastRaw = raw;
      try {
        const parsed = JSON.parse(raw);
        // Strict schema validation (mirrors production's pydantic model_validate):
        // enforce the shape and that every emitted label is within the enum.
        const violation = validateAggregatePayload(parsed, labels);
        if (violation) throw new Error(violation);
        const list: Array<{ detection?: unknown; reasoning?: unknown; present?: unknown }> = Array.isArray(parsed?.detections)
          ? parsed.detections
          : [];
        // Per-label verdicts. In multi-label mode `present` is explicit; otherwise
        // a listed detection implies present=true (production presence semantics).
        const labelVerdicts: LabelVerdict[] = list
          .map((d) => ({
            label: String(d.detection ?? ""),
            present: multiLabel ? d.present === true : true,
            reasoning: String(d.reasoning ?? ""),
          }))
          .filter((v) => v.label);
        const outcome = deriveAggregateOutcome(list, targetLabel);
        // When the target isn't applied, surface a selected supporting detection's
        // reasoning as the evidence (does NOT change the DETECTED/NOT_DETECTED decision).
        let evidence = outcome.evidence;
        if (outcome.decision === "NOT_DETECTED" && !evidence) {
          for (const m of composition.members) {
            if (m.is_support && m.enabled) {
              const hit = outcome.siblings.find((s) => s.label === m.label);
              if (hit && hit.reasoning) {
                evidence = `${m.label}: ${hit.reasoning}`;
                break;
              }
            }
          }
        }
        return {
          decision: outcome.decision,
          evidence,
          siblings: outcome.siblings,
          emittedLabels: outcome.emittedLabels,
          labelVerdicts,
          raw,
          parseOk: true,
          parseErrorReason: null,
          runtimeMs: Date.now() - startedAt,
          thinkingApplied,
        };
      } catch (parseErr: unknown) {
        // Retryable: non-JSON output or a strict schema/enum violation.
        lastErrorReason =
          parseErr instanceof Error && parseErr.message
            ? parseErr.message
            : "Response was not valid JSON matching the aggregate schema.";
      }
    } catch (error: unknown) {
      clearTimeout(timer);
      const aborted = controller.signal.aborted;
      const errMsg = error instanceof Error ? error.message : String(error);
      lastErrorReason = aborted
        ? `Model/API error: aggregate inference timed out after ${AGGREGATE_TIMEOUT_MS}ms`
        : `Model/API error: ${errMsg}`;
      lastRaw = `ERROR: ${lastErrorReason}`;
    }
    if (attempt < maxAttempts) {
      await sleep(2 ** attempt * 500); // 1s, then 2s (exponential backoff)
    }
  }

  return {
    decision: null,
    evidence: null,
    siblings: [],
    emittedLabels: [],
    labelVerdicts: [],
    raw: lastRaw,
    parseOk: false,
    parseErrorReason: lastErrorReason
      ? `${lastErrorReason} (after ${maxAttempts} attempts)`
      : "Aggregate inference failed.",
    runtimeMs: Date.now() - startedAt,
    thinkingApplied,
  };
}
