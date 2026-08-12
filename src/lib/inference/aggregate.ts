import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type { PromptComposition, ProductionSnapshot, SiblingDetection, Decision } from "@/types";
import { buildImagePart } from "@/lib/gemini";
import { AGG_MARKER, compileAggregatePrompt, extractPreamble } from "@/lib/inference/aggregateCompile";

export { AGG_MARKER, compileAggregatePrompt, extractPreamble };

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

export type AggregateInferenceResult = {
  decision: Decision | null;
  evidence: string | null;
  siblings: SiblingDetection[];
  emittedLabels: string[];
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
  }
): Promise<AggregateInferenceResult> {
  const { model, snapshot, composition, targetLabel, imageUri } = params;
  const enabled = composition.members.filter((m) => m.enabled);
  const labels = Array.from(new Set(enabled.map((m) => m.label)));
  const preamble = composition.preamble ?? extractPreamble(snapshot.built_prompt);
  const prompt = compileAggregatePrompt(
    preamble,
    enabled.map((m) => ({ label: m.label, description: m.description }))
  );

  const responseSchema = {
    type: Type.OBJECT,
    required: ["detections"],
    properties: {
      detections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["detection", "reasoning"],
          properties: {
            detection: labels.length > 0 ? { type: Type.STRING, enum: labels } : { type: Type.STRING },
            reasoning: { type: Type.STRING },
          },
        },
      },
    },
  };

  const ai = new GoogleGenAI({ apiKey });
  const thinkingConfig = toThinkingConfig(snapshot.thinking_level);
  const thinkingApplied = !!thinkingConfig;
  const imageParts = await buildImagePart(imageUri);
  const startedAt = Date.now();
  const modelName = model || snapshot.google_model || "gemini-2.5-flash";
  const maxAttempts = 3;
  let lastErrorReason: string | null = null;
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ text: prompt }, ...imageParts],
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
      const raw = response.text ?? "";
      lastRaw = raw;
      try {
        const parsed = JSON.parse(raw);
        const list: Array<{ detection?: unknown; reasoning?: unknown }> = Array.isArray(parsed?.detections)
          ? parsed.detections
          : [];
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
          raw,
          parseOk: true,
          parseErrorReason: null,
          runtimeMs: Date.now() - startedAt,
          thinkingApplied,
        };
      } catch {
        // Retryable: the model returned text that isn't the expected JSON.
        lastErrorReason = "Response was not valid JSON matching the aggregate schema.";
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      lastErrorReason = `Model/API error: ${errMsg}`;
      lastRaw = `ERROR: ${errMsg}`;
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
    raw: lastRaw,
    parseOk: false,
    parseErrorReason: lastErrorReason
      ? `${lastErrorReason} (after ${maxAttempts} attempts)`
      : "Aggregate inference failed.",
    runtimeMs: Date.now() - startedAt,
    thinkingApplied,
  };
}
