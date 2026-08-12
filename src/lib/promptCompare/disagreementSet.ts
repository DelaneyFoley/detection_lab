import type { Decision, Prediction, Run } from "@/types";
import { classifyOutcome, confusionFromPairs, hashString, metricsFromConfusion } from "@/lib/promptIteration/metrics";
import { getResolvedGroundTruth } from "@/lib/ui/review";
import type {
  ClassifiedRow,
  DisagreementKind,
  PerPromptOutcome,
  PromptDisagreementMetrics,
} from "@/lib/promptCompare/types";

export interface PromptRunPredictions {
  promptVersionId: string;
  label: string;
  run: Run;
  predictions: Prediction[];
}

interface MatrixRow {
  dataset_id: string;
  image_id: string;
  image_uri: string;
  ground_truth: Decision | null;
  reviewer_note: string | null;
  per_prompt: Array<{ prompt_version_id: string; prediction: Prediction }>;
}

function coerceDecision(value: string | null | undefined): Decision | null {
  if (value === "DETECTED" || value === "NOT_DETECTED") return value;
  return null;
}

/**
 * Join predictions across all selected prompt versions on (dataset_id, image_id).
 * Only rows covered by every prompt are kept — a prompt that never saw an image
 * cannot teach us anything about disagreement on it.
 */
export function buildComparisonMatrix(
  runsByPrompt: PromptRunPredictions[]
): MatrixRow[] {
  if (runsByPrompt.length === 0) return [];
  // Dedupe: the caller may pass one entry per (prompt × dataset) so the same
  // promptVersionId can appear multiple times. Coverage is measured per unique
  // prompt, not per (prompt, dataset) pair.
  const promptIds = Array.from(new Set(runsByPrompt.map((r) => r.promptVersionId)));
  const byKey = new Map<
    string,
    { image_id: string; dataset_id: string; image_uri: string; per_prompt: Map<string, Prediction> }
  >();

  for (const rp of runsByPrompt) {
    for (const pred of rp.predictions) {
      const key = `${rp.run.dataset_id}::${pred.image_id}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          image_id: pred.image_id,
          dataset_id: rp.run.dataset_id,
          image_uri: pred.image_uri,
          per_prompt: new Map(),
        };
        byKey.set(key, entry);
      }
      if (!entry.per_prompt.has(rp.promptVersionId)) {
        entry.per_prompt.set(rp.promptVersionId, pred);
      }
    }
  }

  const matrix: MatrixRow[] = [];
  for (const entry of byKey.values()) {
    if (entry.per_prompt.size !== promptIds.length) continue;
    // Resolve ground truth + reviewer note from any prompt (prefer any that has a corrected label).
    let gt: Decision | null = null;
    let reviewerNote: string | null = null;
    for (const id of promptIds) {
      const p = entry.per_prompt.get(id)!;
      const resolved = coerceDecision(getResolvedGroundTruth(p));
      if (resolved && !gt) gt = resolved;
      if (!reviewerNote && p.reviewer_note) reviewerNote = p.reviewer_note;
    }
    matrix.push({
      dataset_id: entry.dataset_id,
      image_id: entry.image_id,
      image_uri: entry.image_uri,
      ground_truth: gt,
      reviewer_note: reviewerNote,
      per_prompt: promptIds.map((id) => ({ prompt_version_id: id, prediction: entry.per_prompt.get(id)! })),
    });
  }
  return matrix;
}

/**
 * Classify each joined row into the disagreement taxonomy — the kind of teaching
 * signal (if any) the row carries for prompt synthesis.
 */
export function classifyRows(matrix: MatrixRow[]): ClassifiedRow[] {
  const out: ClassifiedRow[] = [];
  for (const row of matrix) {
    const perPrompt: PerPromptOutcome[] = row.per_prompt.map(({ prompt_version_id, prediction }) => {
      const predicted = prediction.predicted_decision ?? null;
      const outcome = classifyOutcome(predicted, row.ground_truth, prediction.parse_ok);
      return {
        prompt_version_id,
        predicted,
        evidence: prediction.evidence ?? null,
        parse_ok: prediction.parse_ok,
        outcome,
      };
    });

    const predictedSet = new Set(perPrompt.map((p) => p.predicted));
    const anyDisagree = predictedSet.size > 1;

    let kind: DisagreementKind;
    if (row.ground_truth == null) {
      kind = "UNLABELED";
    } else {
      const anyWrong = perPrompt.some(
        (p) => p.parse_ok && p.predicted != null && p.predicted !== row.ground_truth
      );
      const allWrong = perPrompt.every(
        (p) => p.parse_ok && p.predicted != null && p.predicted !== row.ground_truth
      );
      if (!anyDisagree && !anyWrong) kind = "AGREE_CORRECT";
      else if (!anyDisagree && allWrong) kind = "UNANIMOUS_ERROR";
      else if (anyDisagree && anyWrong) kind = "PARTIAL_ERROR";
      else kind = "PROMPT_DISAGREEMENT";
    }

    out.push({
      dataset_id: row.dataset_id,
      image_id: row.image_id,
      image_uri: row.image_uri,
      ground_truth: row.ground_truth,
      reviewer_note: row.reviewer_note,
      per_prompt: perPrompt,
      kind,
    });
  }
  return out;
}

/**
 * Pick images to send to the analyzer, capped by count. Priority order:
 *   PARTIAL_ERROR (some prompt got it right → highest teaching signal),
 *   UNANIMOUS_ERROR (all prompts wrong → shared blind spot),
 *   PROMPT_DISAGREEMENT (split but ground truth unknown/ambiguous).
 * Within each tier, deterministic order by image_id hash.
 */
export function selectDisagreementImages(
  classified: ClassifiedRow[],
  cap: number,
  seed = "prompt-compare"
): ClassifiedRow[] {
  if (cap <= 0) return [];
  const tiers: DisagreementKind[] = ["PARTIAL_ERROR", "UNANIMOUS_ERROR", "PROMPT_DISAGREEMENT"];
  const bucketed: Record<DisagreementKind, ClassifiedRow[]> = {
    PARTIAL_ERROR: [],
    UNANIMOUS_ERROR: [],
    PROMPT_DISAGREEMENT: [],
    AGREE_CORRECT: [],
    UNLABELED: [],
  };
  for (const row of classified) bucketed[row.kind].push(row);
  for (const k of tiers) {
    bucketed[k].sort((a, b) => hashString(seed + a.image_id) - hashString(seed + b.image_id));
  }
  const picked: ClassifiedRow[] = [];
  for (const k of tiers) {
    for (const row of bucketed[k]) {
      if (picked.length >= cap) return picked;
      picked.push(row);
    }
  }
  return picked;
}

/**
 * Stratified sample of images all prompts got right (half positives / half negatives).
 * Counterexamples let the analyzer see what a "good" answer looks like on both classes,
 * which reduces the risk of the synthesized prompt over-correcting.
 */
export function sampleAgreementCounterexamples(
  classified: ClassifiedRow[],
  k = 6,
  seed = "prompt-compare-agree"
): ClassifiedRow[] {
  if (k <= 0) return [];
  const correct = classified.filter((r) => r.kind === "AGREE_CORRECT");
  const positives = correct.filter((r) => r.ground_truth === "DETECTED");
  const negatives = correct.filter((r) => r.ground_truth === "NOT_DETECTED");
  const sortBy = (rows: ClassifiedRow[]) =>
    [...rows].sort((a, b) => hashString(seed + a.image_id) - hashString(seed + b.image_id));
  const halfPos = Math.ceil(k / 2);
  const halfNeg = Math.floor(k / 2);
  return [...sortBy(positives).slice(0, halfPos), ...sortBy(negatives).slice(0, halfNeg)];
}

/**
 * Per-prompt confusion + metrics computed over the DISAGREEMENT set only.
 * Rows with no ground truth are excluded.
 */
export function perPromptDisagreementMetrics(
  classified: ClassifiedRow[],
  promptLabels: Array<{ prompt_version_id: string; label: string }>
): PromptDisagreementMetrics[] {
  const disagreementRows = classified.filter((r) => r.kind !== "AGREE_CORRECT" && r.kind !== "UNLABELED");
  return promptLabels.map(({ prompt_version_id, label }) => {
    const pairs = disagreementRows.map((row) => {
      const p = row.per_prompt.find((x) => x.prompt_version_id === prompt_version_id);
      return {
        predicted: p?.predicted ?? null,
        truth: row.ground_truth,
        parseOk: p?.parse_ok ?? false,
      };
    });
    const confusion = confusionFromPairs(pairs);
    const metrics = metricsFromConfusion(confusion);
    return {
      prompt_version_id,
      label,
      tp: confusion.tp,
      fp: confusion.fp,
      fn: confusion.fn,
      tn: confusion.tn,
      parse_fail: confusion.parseFail,
      metrics,
    };
  });
}
