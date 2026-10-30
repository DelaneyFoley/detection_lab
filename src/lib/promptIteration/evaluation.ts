import { runDetectionInference } from "@/lib/inference";
import { confusionFromPairs, metricsFromConfusion, candidateComplexity } from "@/lib/promptIteration/metrics";
import { applyCandidateUserTemplate } from "@/lib/promptIteration/saving";
import { splitUserPromptTemplate } from "@/lib/detectionPrompts";
import type { CandidateResult, PromptCandidate, ReviewedRow } from "@/lib/promptIteration/types";
import type { Decision, PromptComposition } from "@/types";

function parseComposition(value: unknown): PromptComposition | null {
  if (!value) return null;
  if (typeof value === "object") return value as PromptComposition;
  try {
    return JSON.parse(String(value)) as PromptComposition;
  } catch {
    return null;
  }
}

export interface EvalPrediction {
  image_id: string;
  image_uri: string;
  truth: Decision | null;
  predicted: Decision | null;
  confidence: number | null;
  evidence: string | null;
  parse_ok: boolean;
  raw: string;
  parse_error_reason: string | null;
  parse_fix_suggestion: string | null;
  runtime_ms: number | null;
}

/** Build a PromptVersion-shaped object the inference path understands. */
export function buildCandidatePromptVersion(sourcePrompt: any, candidate: PromptCandidate) {
  const baseStructure = (() => {
    const raw = sourcePrompt?.prompt_structure;
    if (raw && typeof raw === "object") return raw;
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  })();

  // Composition-backed source (PC-001 Single Detection): the single tunable
  // lever is the Detection Prompt (the target member description). Clone the
  // source composition, swap the target member description for the candidate's
  // Detection Prompt, and keep the frozen snapshot so the candidate runs through
  // the aggregate single-member path.
  const sourceComposition = parseComposition(sourcePrompt?.composition);
  if (sourceComposition && sourcePrompt?.production_snapshot_id) {
    const tunedDescription =
      candidate.detection_prompt != null
        ? candidate.detection_prompt
        : candidate.user_prompt_addendum != null
          ? candidate.user_prompt_addendum
          : sourceComposition.members.find((m) => m.is_target)?.description || "";
    const members = sourceComposition.members.map((m) =>
      m.is_target ? { ...m, description: tunedDescription } : m
    );
    const nextComposition = { ...sourceComposition, members };
    return {
      ...sourcePrompt,
      composition: nextComposition,
      prompt_structure: {
        ...baseStructure,
        user_prompt_addendum: tunedDescription,
      },
    };
  }

  return {
    ...sourcePrompt,
    system_prompt: candidate.system_prompt || sourcePrompt.system_prompt,
    user_prompt_template: applyCandidateUserTemplate(sourcePrompt.user_prompt_template || "", candidate),
    prompt_structure: {
      ...baseStructure,
      label_policy: candidate.label_policy,
      decision_rubric: candidate.decision_rubric,
    },
  };
}

/**
 * Evaluate one candidate prompt over the holdout rows using the existing model
 * execution path. Returns predictions plus confusion/metrics, complexity, and
 * the set of rows whose decision changed vs the baseline.
 */
export async function evaluateCandidate(params: {
  candidate: PromptCandidate;
  sourcePrompt: any;
  detectionCode: string;
  rows: ReviewedRow[];
  apiKey: string;
  baselineByImageId: Map<string, Decision | null>;
  maxConcurrency?: number;
  isCancelled?: () => boolean;
  onItem?: () => void;
}): Promise<{ result: CandidateResult; predictions: EvalPrediction[] }> {
  const { candidate, sourcePrompt, detectionCode, rows, apiKey, baselineByImageId } = params;
  const maxConcurrency = Math.max(1, Math.min(8, params.maxConcurrency ?? 4));
  const promptVersion = buildCandidatePromptVersion(sourcePrompt, candidate);
  // Effective tunable text for leanness/complexity pressure. For a composition-
  // backed Single Detection source it is the Detection Prompt (target member
  // description); otherwise the user-prompt addendum.
  const candidateComposition = parseComposition(promptVersion.composition);
  const effectiveAddendum = candidateComposition
    ? candidateComposition.members.find((m) => m.is_target)?.description || ""
    : splitUserPromptTemplate(promptVersion.user_prompt_template || "").addendum;

  const predictions: EvalPrediction[] = new Array(rows.length);
  let evalError: string | null = null;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      if (params.isCancelled?.()) return;
      const i = nextIndex;
      if (i >= rows.length) return;
      nextIndex += 1;
      const row = rows[i];
      try {
        const res = await runDetectionInference(apiKey, promptVersion as any, detectionCode, row.image_uri);
        predictions[i] = {
          image_id: row.image_id,
          image_uri: row.image_uri,
          truth: row.finalized_ground_truth,
          predicted: (res.parsed?.decision || null) as Decision | null,
          confidence: res.parsed?.confidence ?? null,
          evidence: res.parsed?.evidence || null,
          parse_ok: res.parseOk,
          raw: res.raw,
          parse_error_reason: res.parseErrorReason,
          parse_fix_suggestion: res.parseFixSuggestion,
          runtime_ms: res.runtimeMs,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        evalError = evalError || msg;
        predictions[i] = {
          image_id: row.image_id,
          image_uri: row.image_uri,
          truth: row.finalized_ground_truth,
          predicted: null,
          confidence: null,
          evidence: null,
          parse_ok: false,
          raw: `ERROR: ${msg}`,
          parse_error_reason: `Model/API error: ${msg}`,
          parse_fix_suggestion: "Verify API key/model availability and retry.",
          runtime_ms: null,
        };
      } finally {
        params.onItem?.();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, rows.length) }, () => worker()));
  const filled = predictions.filter(Boolean);

  const confusion = confusionFromPairs(
    filled.map((p) => ({ predicted: p.predicted, truth: p.truth, parseOk: p.parse_ok }))
  );
  const metrics = metricsFromConfusion(confusion);

  const changed_rows: string[] = [];
  for (const p of filled) {
    const base = baselineByImageId.get(p.image_id) ?? null;
    if (base !== p.predicted) changed_rows.push(p.image_id);
  }

  // Genuine parse errors = schema-invalid model output. Transient API/inference
  // exceptions (raw starts with "ERROR:") are infra noise, not parse errors.
  const parseErrors = filled.filter((p) => !p.parse_ok && !p.raw.startsWith("ERROR:")).length;

  const result: CandidateResult = {
    candidate,
    confusion,
    metrics,
    complexity: candidateComplexity(candidate.label_policy, candidate.decision_rubric, candidate.system_prompt, effectiveAddendum),
    parse_errors: parseErrors,
    changed_rows,
    rejected_reasons: [],
    // Only flag an eval error when every row failed — a few transient failures
    // still produce a usable (if noisier) metric.
    eval_error: filled.length > 0 && filled.every((p) => !p.parse_ok && p.raw.startsWith("ERROR:")) ? evalError : null,
  };

  return { result, predictions: filled };
}

/**
 * Count how the selected candidate changed outcomes vs the baseline on the
 * holdout: FPs/FNs fixed and any new regressions introduced.
 */
export function computeRegressionCounts(
  baselineRows: ReviewedRow[],
  candidatePredictions: EvalPrediction[]
): { fp_fixed: number; fn_fixed: number; new_false_positives: number; new_false_negatives: number } {
  const baseByImage = new Map(baselineRows.map((r) => [r.image_id, r]));
  let fpFixed = 0;
  let fnFixed = 0;
  let newFP = 0;
  let newFN = 0;
  for (const p of candidatePredictions) {
    const base = baseByImage.get(p.image_id);
    if (!base || (base.finalized_ground_truth !== "DETECTED" && base.finalized_ground_truth !== "NOT_DETECTED")) continue;
    if (!p.parse_ok || (p.predicted !== "DETECTED" && p.predicted !== "NOT_DETECTED")) continue;
    const truth = base.finalized_ground_truth;
    const before = base.outcome;
    const nowCorrect = p.predicted === truth;
    if (before === "FP" && nowCorrect) fpFixed += 1;
    if (before === "FN" && nowCorrect) fnFixed += 1;
    if ((before === "TP" || before === "TN") && !nowCorrect) {
      if (truth === "NOT_DETECTED" && p.predicted === "DETECTED") newFP += 1;
      if (truth === "DETECTED" && p.predicted === "NOT_DETECTED") newFN += 1;
    }
  }
  return { fp_fixed: fpFixed, fn_fixed: fnFixed, new_false_positives: newFP, new_false_negatives: newFN };
}
