import type { PromptVersion, GeminiDetectionResponse, PromptComposition, Decision } from "@/types";
import { getProvider } from "@/lib/models";
import { runAnthropicInference } from "./anthropic";
import { runOpenAIInference } from "./openai";
import { runDetectionInference as runGeminiInference } from "@/lib/gemini";
import { runAggregateInference } from "@/lib/inference/aggregate";
import { snapshotRepository } from "@/lib/repositories";

export type InferenceResult = {
  parsed: GeminiDetectionResponse | null;
  raw: string;
  parseOk: boolean;
  parseErrorReason: string | null;
  parseFixSuggestion: string | null;
  runtimeMs: number;
  retryCount: number;
};

function parseComposition(value: unknown): PromptComposition | null {
  if (!value) return null;
  if (typeof value === "object") return value as PromptComposition;
  try {
    return JSON.parse(String(value)) as PromptComposition;
  } catch {
    return null;
  }
}

/**
 * Run a composition-backed version (Single Detection or Production Replication)
 * through the aggregate path and adapt the result to the single-detection
 * InferenceResult shape. DETECTED follows presence semantics: the target label
 * being returned by the model. Confidence is not produced by the aggregate
 * schema, so a definitive 1 is reported for a successful parse.
 */
async function runCompositionInference(
  apiKey: string,
  prompt: PromptVersion,
  composition: PromptComposition,
  snapshotId: string,
  detectionCode: string,
  imageUri: string
): Promise<InferenceResult> {
  const snapshot = snapshotRepository.getSnapshotById(snapshotId);
  if (!snapshot) {
    return {
      parsed: null,
      raw: "ERROR: missing frozen context snapshot for composition-backed version",
      parseOk: false,
      parseErrorReason: "This version is missing its frozen context snapshot.",
      parseFixSuggestion: "Re-select the context and re-save the version.",
      runtimeMs: 0,
      retryCount: 0,
    };
  }
  const targetLabel =
    composition.members.find((m) => m.is_target)?.label ?? prompt.production_label ?? null;
  const r = await runAggregateInference(apiKey, {
    model: prompt.model,
    snapshot,
    composition,
    targetLabel,
    imageUri,
    multiLabel: false,
  });
  return {
    parsed: r.parseOk
      ? {
          detection_code: detectionCode,
          decision: (r.decision || "NOT_DETECTED") as Decision,
          confidence: 1,
          evidence: r.evidence || "",
        }
      : null,
    raw: r.raw,
    parseOk: r.parseOk,
    parseErrorReason: r.parseErrorReason,
    parseFixSuggestion: null,
    runtimeMs: r.runtimeMs,
    retryCount: 0,
  };
}

export async function runDetectionInference(
  apiKey: string,
  prompt: PromptVersion,
  detectionCode: string,
  imageUri: string
): Promise<InferenceResult> {
  // Composition-backed versions run exactly like the production aggregate, over
  // a single member for Single Detection.
  const composition = parseComposition((prompt as { composition?: unknown }).composition);
  const snapshotId = prompt.production_snapshot_id;
  if (composition && snapshotId) {
    return runCompositionInference(apiKey, prompt, composition, snapshotId, detectionCode, imageUri);
  }

  const provider = getProvider(prompt.model);

  switch (provider) {
    case "anthropic":
      return runAnthropicInference(apiKey, prompt, detectionCode, imageUri);
    case "openai":
      return runOpenAIInference(apiKey, prompt, detectionCode, imageUri);
    case "gemini":
    default:
      return runGeminiInference(apiKey, prompt, detectionCode, imageUri);
  }
}
