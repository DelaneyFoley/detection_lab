import type { Decision } from "@/types";
import type {
  Confusion,
  CoreMetrics,
  CandidateResult,
  ReviewedRow,
  RowOutcome,
  SelectionResult,
} from "@/lib/promptIteration/types";

/**
 * Pure metric + sampling helpers for the prompt-iteration workflow.
 * Everything here is deterministic and DB-free so it can be unit-tested.
 */

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Optimization objective for candidate selection. All scores are in [0,1] and
 * "higher is better", so the same ranking, near-tie complexity break, and
 * bootstrap CI machinery work across objectives.
 */
export type Objective =
  | { kind: "f1" }
  | { kind: "fbeta"; beta: number }
  | { kind: "recall_at_precision"; precisionFloor: number }
  | { kind: "precision_at_recall"; recallFloor: number }
  | { kind: "balanced_accuracy" };

/** Scalar to maximize for an objective, given metrics + confusion (both in [0,1]). */
export function objectiveScore(m: CoreMetrics, c: Confusion, obj: Objective): number {
  switch (obj.kind) {
    case "fbeta": {
      const b2 = obj.beta * obj.beta;
      const denom = b2 * m.precision + m.recall;
      return denom > 0 ? ((1 + b2) * m.precision * m.recall) / denom : 0;
    }
    case "recall_at_precision":
      return m.recall;
    case "precision_at_recall":
      return m.precision;
    case "balanced_accuracy": {
      const specificity = c.tn + c.fp > 0 ? c.tn / (c.tn + c.fp) : 0;
      return (m.recall + specificity) / 2;
    }
    case "f1":
    default:
      return m.f1;
  }
}

/** Hard constraint a candidate must satisfy for the objective (beyond global guards). */
export function objectiveEligible(
  m: CoreMetrics,
  obj: Objective,
  margins: { precision?: number; recall?: number } = {}
): { ok: boolean; reason?: string } {
  if (obj.kind === "recall_at_precision" && m.precision < obj.precisionFloor - (margins.precision ?? 0)) {
    return { ok: false, reason: `precision ${m.precision.toFixed(3)} below objective floor ${obj.precisionFloor.toFixed(3)}` };
  }
  if (obj.kind === "precision_at_recall" && m.recall < obj.recallFloor - (margins.recall ?? 0)) {
    return { ok: false, reason: `recall ${m.recall.toFixed(3)} below objective floor ${obj.recallFloor.toFixed(3)}` };
  }
  return { ok: true };
}

/** Human-readable objective label for logs/reports. */
export function objectiveLabel(obj: Objective): string {
  switch (obj.kind) {
    case "fbeta":
      return `F${obj.beta} (${obj.beta > 1 ? "recall-weighted" : obj.beta < 1 ? "precision-weighted" : "balanced"})`;
    case "recall_at_precision":
      return `max recall at precision ≥ ${(obj.precisionFloor * 100).toFixed(0)}%`;
    case "precision_at_recall":
      return `max precision at recall ≥ ${(obj.recallFloor * 100).toFixed(0)}%`;
    case "balanced_accuracy":
      return "balanced accuracy";
    case "f1":
    default:
      return "F1";
  }
}

/** Parse/validate a raw objective (from job JSON / API body); defaults to F1. */
export function parseObjective(raw: unknown): Objective {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = String(o.kind || "f1");
  const clamp01 = (v: unknown, d: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(1, Math.max(0, n));
  };
  switch (kind) {
    case "fbeta": {
      const beta = Number(o.beta);
      return { kind: "fbeta", beta: Number.isFinite(beta) && beta > 0 ? Math.min(4, beta) : 1 };
    }
    case "recall_at_precision":
      return { kind: "recall_at_precision", precisionFloor: clamp01(o.precisionFloor, 0.8) };
    case "precision_at_recall":
      return { kind: "precision_at_recall", recallFloor: clamp01(o.recallFloor, 0.8) };
    case "balanced_accuracy":
      return { kind: "balanced_accuracy" };
    case "f1":
    default:
      return { kind: "f1" };
  }
}

/** Classify a prediction against the finalized ground truth. */
export function classifyOutcome(
  predicted: Decision | null,
  truth: Decision | null,
  parseOk: boolean
): RowOutcome {
  if (truth !== "DETECTED" && truth !== "NOT_DETECTED") return "UNLABELED";
  if (!parseOk || (predicted !== "DETECTED" && predicted !== "NOT_DETECTED")) return "PARSE_FAIL";
  if (truth === "DETECTED" && predicted === "DETECTED") return "TP";
  if (truth === "NOT_DETECTED" && predicted === "DETECTED") return "FP";
  if (truth === "DETECTED" && predicted === "NOT_DETECTED") return "FN";
  return "TN";
}

export function emptyConfusion(): Confusion {
  return { tp: 0, fp: 0, fn: 0, tn: 0, parseFail: 0, total: 0 };
}

/** Build a confusion matrix from prediction/truth/parse triples. */
export function confusionFromPairs(
  pairs: Array<{ predicted: Decision | null; truth: Decision | null; parseOk: boolean }>
): Confusion {
  const c = emptyConfusion();
  for (const p of pairs) {
    const outcome = classifyOutcome(p.predicted, p.truth, p.parseOk);
    if (outcome === "UNLABELED") continue;
    c.total += 1;
    switch (outcome) {
      case "TP": c.tp += 1; break;
      case "FP": c.fp += 1; break;
      case "FN": c.fn += 1; break;
      case "TN": c.tn += 1; break;
      case "PARSE_FAIL": c.parseFail += 1; break;
    }
  }
  return c;
}

export function confusionFromRows(rows: ReviewedRow[]): Confusion {
  return confusionFromPairs(
    rows.map((r) => ({ predicted: r.ai_predicted, truth: r.finalized_ground_truth, parseOk: r.parse_ok }))
  );
}

export function metricsFromConfusion(c: Confusion): CoreMetrics {
  const precision = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const evaluated = c.tp + c.fp + c.fn + c.tn;
  const accuracy = evaluated > 0 ? (c.tp + c.tn) / evaluated : 0;
  return { precision: round4(precision), recall: round4(recall), f1: round4(f1), accuracy: round4(accuracy) };
}

/** Deterministic 32-bit hash of a string (FNV-1a) for stable, seeded sampling. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) seeded from a string, for stable bootstrapping. */
function mulberry32(seedStr: string): () => number {
  let a = hashString(seedStr) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Size-adaptive evaluation policy. The right architecture depends on statistical
 * power, which is limited by the SMALLER class (min positives/negatives), not raw
 * row count. Small samples get a larger holdout fraction and a higher required
 * effect size (because a one-image swing is huge); large samples get a leaner
 * holdout and a smaller minimum gain. The bootstrap gate below then self-adapts:
 * CIs are automatically wide for small N and tight for large N.
 */
export interface EvaluationPlan {
  regime: "small" | "medium" | "large";
  holdoutFraction: number;
  /** Minimum ΔF1 vs baseline the winner must clear (effect-size floor). */
  minEffectF1: number;
  bootstrapIters: number;
  /** Required P(ΔF1 > minEffectF1) from the group bootstrap to call it confident. */
  promotionConfidence: number;
  note: string;
}

export function resolveEvaluationPlan(counts: {
  labeled: number;
  positives: number;
  negatives: number;
}): EvaluationPlan {
  const effN = Math.min(counts.positives, counts.negatives);
  if (counts.labeled < 120 || effN < 20) {
    return {
      regime: "small",
      holdoutFraction: 0.3,
      minEffectF1: 0.05,
      bootstrapIters: 2000,
      promotionConfidence: 0.9,
      note: "Small sample: confidence intervals are wide. Treat winners as recommended-for-review, not auto-promote; a growing gold set beats trusting one split.",
    };
  }
  if (counts.labeled < 500) {
    return {
      regime: "medium",
      holdoutFraction: 0.25,
      minEffectF1: 0.03,
      bootstrapIters: 1500,
      promotionConfidence: 0.9,
      note: "Medium sample: a single held-out validation is reasonable; a locked gold set still improves promotion confidence.",
    };
  }
  return {
    regime: "large",
    holdoutFraction: 0.2,
    minEffectF1: 0.02,
    bootstrapIters: 1000,
    promotionConfidence: 0.9,
    note: "Large sample: held-out validation is well-powered; a sealed locked-test slice and wider beam search become worthwhile.",
  };
}

export interface DeltaStat {
  mean: number;
  lo: number;
  hi: number;
}

export interface BootstrapDelta {
  f1: DeltaStat;
  precision: DeltaStat;
  recall: DeltaStat;
  /** Delta of the selected objective (equals f1 when objective is F1). */
  objective: DeltaStat;
  /** P(Δobjective > minGain) across resamples — the promotion significance signal. */
  probGain: number;
  minGain: number;
  iters: number;
  groups: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function confusionOfPreds(rows: Array<{ truth: Decision | null; pred: Decision | null }>): Confusion {
  return confusionFromPairs(rows.map((r) => ({ predicted: r.pred, truth: r.truth, parseOk: true })));
}

/**
 * Group-aware paired bootstrap of the metric DELTA (candidate − baseline) over the
 * same holdout. Resamples whole GROUPS with replacement (near-duplicates move
 * together, matching the split) so the interval reflects real uncertainty. Returns
 * two-sided 90% intervals plus P(ΔF1 > minGain) for a promotion significance gate.
 */
export function groupBootstrapDelta(
  rows: Array<{ group: string; truth: Decision | null; base: Decision | null; cand: Decision | null }>,
  opts: { iters?: number; seed?: string; minGain?: number; objective?: Objective } = {}
): BootstrapDelta {
  const iters = Math.max(1, opts.iters ?? 1000);
  const minGain = opts.minGain ?? 0;
  const objective: Objective = opts.objective ?? { kind: "f1" };
  const byGroup = new Map<string, Array<{ truth: Decision | null; base: Decision | null; cand: Decision | null }>>();
  for (const r of rows) {
    const g = byGroup.get(r.group) || [];
    g.push({ truth: r.truth, base: r.base, cand: r.cand });
    byGroup.set(r.group, g);
  }
  const groups = [...byGroup.values()];
  const empty: DeltaStat = { mean: 0, lo: 0, hi: 0 };
  if (groups.length === 0) {
    return { f1: empty, precision: empty, recall: empty, objective: empty, probGain: 0, minGain, iters, groups: 0 };
  }
  const rng = mulberry32(opts.seed || "bootstrap");
  const dF1: number[] = [];
  const dP: number[] = [];
  const dR: number[] = [];
  const dObj: number[] = [];
  for (let i = 0; i < iters; i++) {
    const sample: Array<{ truth: Decision | null; base: Decision | null; cand: Decision | null }> = [];
    for (let g = 0; g < groups.length; g++) {
      const pick = groups[Math.floor(rng() * groups.length)];
      for (const row of pick) sample.push(row);
    }
    const bc = confusionOfPreds(sample.map((r) => ({ truth: r.truth, pred: r.base })));
    const cc = confusionOfPreds(sample.map((r) => ({ truth: r.truth, pred: r.cand })));
    const bm = metricsFromConfusion(bc);
    const cm = metricsFromConfusion(cc);
    dF1.push(cm.f1 - bm.f1);
    dP.push(cm.precision - bm.precision);
    dR.push(cm.recall - bm.recall);
    dObj.push(objectiveScore(cm, cc, objective) - objectiveScore(bm, bc, objective));
  }
  const stat = (arr: number[]): DeltaStat => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    return { mean: round4(mean), lo: round4(percentile(sorted, 5)), hi: round4(percentile(sorted, 95)) };
  };
  return {
    f1: stat(dF1),
    precision: stat(dP),
    recall: stat(dR),
    objective: stat(dObj),
    probGain: round4(dObj.filter((x) => x > minGain).length / iters),
    minGain,
    iters,
    groups: groups.length,
  };
}

/**
 * Deterministic stratified split into a tuning set (shown to the AI) and a
 * holdout set (used only to evaluate candidates). Stratifies by finalized
 * label so positives/negatives are proportionally represented in the holdout,
 * and is stable across runs for the same seed.
 */
export function stratifiedSplit(
  rows: ReviewedRow[],
  holdoutFraction: number,
  seed = "prompt-iteration"
): { tuning: ReviewedRow[]; holdout: ReviewedRow[] } {
  const frac = Math.min(0.9, Math.max(0.1, holdoutFraction));
  const labeled = rows.filter(
    (r) => r.finalized_ground_truth === "DETECTED" || r.finalized_ground_truth === "NOT_DETECTED"
  );
  const positives = labeled.filter((r) => r.finalized_ground_truth === "DETECTED");
  const negatives = labeled.filter((r) => r.finalized_ground_truth === "NOT_DETECTED");

  const pick = (group: ReviewedRow[]): { tuning: ReviewedRow[]; holdout: ReviewedRow[] } => {
    const sorted = [...group].sort(
      (a, b) => hashString(seed + a.image_id) - hashString(seed + b.image_id)
    );
    // Guarantee at least one holdout item per stratum when the stratum has ≥2.
    const target = sorted.length >= 2 ? Math.max(1, Math.round(sorted.length * frac)) : 0;
    return { holdout: sorted.slice(0, target), tuning: sorted.slice(target) };
  };

  const p = pick(positives);
  const n = pick(negatives);
  return {
    tuning: [...p.tuning, ...n.tuning],
    holdout: [...p.holdout, ...n.holdout],
  };
}

/** Compact complexity proxy: total characters of the tuned prompt fields. */
export function candidateComplexity(
  labelPolicy: string,
  decisionRubric: string,
  systemPrompt?: string | null,
  addendum?: string | null
): number {
  return (
    (labelPolicy || "").length +
    (decisionRubric || "").length +
    (systemPrompt || "").length +
    (addendum || "").length
  );
}

/** Order-independent stratum key from the finalized label + attribute labels. */
export function attributeSignature(attributes: string[]): string {
  return Array.from(new Set((attributes || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean)))
    .sort()
    .join(",");
}

/**
 * Conservative near-duplicate cluster key for an image id. Strips a file
 * extension and explicit duplicate/crop/version markers (copy, dup, crop, v2,
 * "(1)"), but NOT sequential frame indices — so genuine duplicates cluster
 * while distinct images (…_006 vs …_007) stay separate.
 */
export function nearDuplicateGroupKey(imageId: string): string {
  let s = String(imageId || "").trim().toLowerCase();
  s = s.replace(/\.[a-z0-9]{2,5}$/i, "");
  s = s.replace(/[\s._-]*(copy|dup|duplicate|crop|cropped|v\d+|version\s*\d+|\(\d+\))\s*$/i, "");
  return s.trim() || String(imageId || "").trim();
}

/**
 * Group-aware stratified split.
 * - Clusters near-duplicate images into groups (never split across sides) to
 *   prevent tuning→holdout leakage.
 * - Stratifies GROUPS by finalized LABEL only, and allocates a real ~holdoutFraction
 *   of each label's rows to the holdout. (Attribute combinations are far too sparse
 *   to size a split by — stratifying on them collapses the holdout to a tiny slice.)
 * - Attributes still drive group ORDERING (round-robin across attribute signatures)
 *   so the holdout draws a diverse attribute mix before its budget runs out.
 * - Deterministic (seeded).
 */
export function groupAwareStratifiedSplit(
  rows: ReviewedRow[],
  holdoutFraction: number,
  seed = "prompt-iteration"
): { tuning: ReviewedRow[]; holdout: ReviewedRow[] } {
  const frac = Math.min(0.9, Math.max(0.1, holdoutFraction));
  const labeled = rows.filter(
    (r) => r.finalized_ground_truth === "DETECTED" || r.finalized_ground_truth === "NOT_DETECTED"
  );

  // 1) Cluster near-duplicates into groups.
  const groups = new Map<string, ReviewedRow[]>();
  for (const r of labeled) {
    const key = nearDuplicateGroupKey(r.image_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // 2) Stratify GROUPS by finalized label only.
  type Grp = { key: string; rows: ReviewedRow[]; sig: string };
  const byLabel = new Map<string, Grp[]>();
  for (const [key, groupRows] of groups) {
    const first = groupRows[0];
    const label = String(first.finalized_ground_truth);
    const sig = attributeSignature(first.attributes || []);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push({ key, rows: groupRows, sig });
  }

  // 3) Per label: order groups round-robin across attribute signatures, then
  //    accumulate whole groups into the holdout until ~frac of this label's rows.
  const tuning: ReviewedRow[] = [];
  const holdout: ReviewedRow[] = [];
  for (const [, grps] of byLabel) {
    const ordered = orderGroupsByAttributeRoundRobin(grps, seed);
    const stratumRows = grps.reduce((n, g) => n + g.rows.length, 0);
    const targetRows = Math.round(stratumRows * frac);
    let acc = 0;
    for (const g of ordered) {
      if (acc < targetRows) {
        holdout.push(...g.rows);
        acc += g.rows.length;
      } else {
        tuning.push(...g.rows);
      }
    }
  }
  return { tuning, holdout };
}

/**
 * Deterministically order groups by round-robin across their attribute
 * signatures, so a fractional take from the front spreads across attributes.
 */
function orderGroupsByAttributeRoundRobin<T extends { key: string; sig: string }>(
  grps: T[],
  seed: string
): T[] {
  const buckets = new Map<string, T[]>();
  for (const g of grps) {
    if (!buckets.has(g.sig)) buckets.set(g.sig, []);
    buckets.get(g.sig)!.push(g);
  }
  const sigOrder = [...buckets.keys()].sort((a, b) => hashString(seed + a) - hashString(seed + b));
  for (const sig of sigOrder) {
    buckets.get(sig)!.sort((a, b) => hashString(seed + a.key) - hashString(seed + b.key));
  }
  const result: T[] = [];
  let idx = 0;
  let added = true;
  while (added) {
    added = false;
    for (const sig of sigOrder) {
      const bucket = buckets.get(sig)!;
      if (idx < bucket.length) {
        result.push(bucket[idx]);
        added = true;
      }
    }
    idx += 1;
  }
  return result;
}

/**
 * Relative precision floor. Never require MORE precision than the baseline
 * already delivers (minus a tolerance), so a "precision ≥ X" objective can never
 * be strictly unachievable (the reason iteration can churn 10 rounds and promote
 * nothing). Returns null when no floor is requested.
 */
export function relativePrecisionFloor(
  requestedFloor: number | null,
  baselinePrecision: number,
  tolerance = 0.03
): number | null {
  if (requestedFloor == null) return null;
  return Math.max(0, Math.min(requestedFloor, baselinePrecision - tolerance));
}

/**
 * Normal-approx half-width of a proportion estimate at count n. Used to avoid
 * rejecting a candidate for a precision gap that is within sampling noise on a
 * small evaluation set. z≈1.28 ≈ 80% one-sided; p=0.5 is the widest (worst-case)
 * estimate. Returns 0 for large/invalid n so big samples stay strict.
 */
export function proportionNoiseMargin(n: number, p = 0.5, z = 1.28): number {
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  const margin = z * Math.sqrt((p * (1 - p)) / n);
  return Number.isFinite(margin) ? Math.min(0.5, margin) : 0.5;
}

export interface CVMetrics {
  folds: CoreMetrics[];
  mean: CoreMetrics;
  std: { precision: number; recall: number; f1: number };
  /** Mean of the objective score across folds. */
  objectiveMean: number;
  /** Std of the objective score across folds (fold-to-fold instability). */
  objectiveStd: number;
  /** Number of non-empty folds actually used. */
  k: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
};

/**
 * K-fold cross-validated metrics over the SAME predictions. Instead of scoring a
 * candidate on one small holdout (whose luck dominates the number), partition the
 * evaluated rows into k group-aware, label-stratified folds and compute the mean
 * and fold-to-fold spread of each metric. The mean is a lower-variance estimate;
 * the spread quantifies how noisy that estimate is. Near-duplicate GROUPS are
 * kept whole (never split across folds) to prevent leakage, mirroring the split.
 */
export function crossValidatedMetrics(
  rows: Array<{ group: string; truth: Decision | null; pred: Decision | null; parseOk?: boolean }>,
  opts: { k?: number; seed?: string; objective?: Objective } = {}
): CVMetrics {
  const objective: Objective = opts.objective ?? { kind: "f1" };
  const seed = opts.seed || "cv";
  // Cluster rows by group.
  const byGroup = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group)!.push(r);
  }
  const groupKeys = [...byGroup.keys()];
  // Stratify groups by their (majority) truth label so each fold has both classes.
  const labelOf = (g: string): string => {
    const gr = byGroup.get(g)!;
    const det = gr.filter((r) => r.truth === "DETECTED").length;
    return det * 2 >= gr.length ? "DETECTED" : "NOT_DETECTED";
  };
  const k = Math.max(2, Math.min(10, opts.k ?? 5, Math.max(2, groupKeys.length)));
  const foldOfGroup = new Map<string, number>();
  const byLabel = new Map<string, string[]>();
  for (const g of groupKeys) {
    const l = labelOf(g);
    if (!byLabel.has(l)) byLabel.set(l, []);
    byLabel.get(l)!.push(g);
  }
  for (const [label, gks] of byLabel) {
    const ordered = [...gks].sort((a, b) => hashString(seed + label + a) - hashString(seed + label + b));
    ordered.forEach((g, i) => foldOfGroup.set(g, i % k));
  }
  const folds: CoreMetrics[] = [];
  const objScores: number[] = [];
  for (let f = 0; f < k; f++) {
    const foldRows = rows.filter((r) => foldOfGroup.get(r.group) === f);
    if (foldRows.length === 0) continue;
    const c = confusionFromPairs(
      foldRows.map((r) => ({ predicted: r.pred, truth: r.truth, parseOk: r.parseOk !== false }))
    );
    const m = metricsFromConfusion(c);
    folds.push(m);
    objScores.push(objectiveScore(m, c, objective));
  }
  const meanMetrics: CoreMetrics = {
    precision: round4(mean(folds.map((m) => m.precision))),
    recall: round4(mean(folds.map((m) => m.recall))),
    f1: round4(mean(folds.map((m) => m.f1))),
    accuracy: round4(mean(folds.map((m) => m.accuracy))),
  };
  return {
    folds,
    mean: meanMetrics,
    std: {
      precision: round4(stdev(folds.map((m) => m.precision))),
      recall: round4(stdev(folds.map((m) => m.recall))),
      f1: round4(stdev(folds.map((m) => m.f1))),
    },
    objectiveMean: round4(mean(objScores)),
    objectiveStd: round4(stdev(objScores)),
    k: folds.length,
  };
}

export interface SelectionConfig {
  goalF1: number | null;
  /** Reject a candidate whose precision drops more than this below baseline. */
  precisionDropTolerance: number;
  /** If baseline is high-precision, require candidates stay above this floor. */
  precisionFloor: number | null;
  /** Minimum F1 gain to prefer a more-complex candidate over a leaner one. */
  minF1GainForComplexity: number;
  baselineComplexity: number;
  /** Optimization objective (defaults to F1). Ranking + baseline-beat use this. */
  objective?: Objective;
  /** Baseline's score on the objective (defaults to baseline.f1). */
  baselineScore?: number;
  /**
   * Sampling-noise margin (0..1). A candidate is not rejected for a precision
   * gap SMALLER than this below the floor, since on a small eval set such a gap
   * is within the margin of error. Defaults to 0 (strict).
   */
  precisionNoiseMargin?: number;
}

export const DEFAULT_SELECTION_CONFIG: Omit<SelectionConfig, "goalF1" | "precisionFloor" | "baselineComplexity"> = {
  precisionDropTolerance: 0.05,
  minF1GainForComplexity: 0.01,
};

/**
 * Choose the best candidate by validation F1 subject to anti-overfitting
 * guardrails:
 *  - reject candidates that collapse precision beyond tolerance / below floor,
 *  - prefer leaner prompts when F1 is tied or nearly tied,
 *  - never promote a candidate that fails to beat baseline F1,
 *  - respect an optional goal F1 the operator requires before accepting.
 */
export function selectBestCandidate(
  baseline: CoreMetrics,
  candidates: CandidateResult[],
  config: SelectionConfig
): SelectionResult {
  const reasons: string[] = [];
  const objective: Objective = config.objective ?? { kind: "f1" };
  const baselineScore = config.baselineScore ?? baseline.f1;
  const score = (c: CandidateResult) => objectiveScore(c.metrics, c.confusion, objective);
  const objName = objectiveLabel(objective);
  // When the operator sets an explicit precision floor — or the objective is
  // "max recall at precision ≥ X" — that floor governs and the relative
  // "drop from baseline" tolerance is disabled, so we can trade precision for
  // recall down to the accepted floor.
  const objectiveFloor = objective.kind === "recall_at_precision" ? objective.precisionFloor : null;
  const explicitFloor = config.precisionFloor != null || objectiveFloor != null;
  const precisionFloor =
    config.precisionFloor ??
    objectiveFloor ??
    (baseline.precision >= 0.85 ? baseline.precision - config.precisionDropTolerance : null);
  const noiseMargin = Math.max(0, config.precisionNoiseMargin ?? 0);

  const viable: CandidateResult[] = [];
  for (const c of candidates) {
    const rej: string[] = [];
    if (c.eval_error) rej.push(`evaluation error: ${c.eval_error}`);
    // Parse errors are unacceptable: any schema-invalid model output on the
    // holdout hard-disqualifies the candidate from promotion.
    if (c.parse_errors > 0) {
      rej.push(`${c.parse_errors} parse error(s) on the holdout — parse errors are not allowed`);
    }
    const cScore = score(c);
    if (cScore <= baselineScore) {
      rej.push(`${objName} ${cScore.toFixed(3)} does not beat baseline ${baselineScore.toFixed(3)}`);
    }
    const objElig = objectiveEligible(c.metrics, objective, { precision: noiseMargin, recall: noiseMargin });
    if (!objElig.ok) {
      rej.push(objElig.reason || "objective constraint not met");
    }
    if (!explicitFloor && baseline.precision - c.metrics.precision > config.precisionDropTolerance + noiseMargin) {
      rej.push(
        `precision collapse ${c.metrics.precision.toFixed(3)} vs baseline ${baseline.precision.toFixed(3)}`
      );
    }
    if (precisionFloor != null && c.metrics.precision < precisionFloor - noiseMargin) {
      rej.push(`precision ${c.metrics.precision.toFixed(3)} below floor ${precisionFloor.toFixed(3)}`);
    }
    c.rejected_reasons = rej;
    if (rej.length === 0) viable.push(c);
  }

  if (viable.length === 0) {
    reasons.push(`No candidate safely beat the baseline on ${objName} under the guardrails; keeping the current prompt.`);
    return { selected: null, baseline, reasons, goal_met: false };
  }

  // Rank by objective desc; break near-ties (within minF1GainForComplexity) by lower complexity.
  const ranked = [...viable].sort((a, b) => {
    if (Math.abs(score(a) - score(b)) <= config.minF1GainForComplexity) {
      return a.complexity - b.complexity;
    }
    return score(b) - score(a);
  });

  const best = ranked[0];
  reasons.push(
    `Selected "${best.candidate.label}" (${best.candidate.kind}) with holdout F1 ${best.metrics.f1.toFixed(3)} ` +
      `(P ${best.metrics.precision.toFixed(3)}, R ${best.metrics.recall.toFixed(3)}) vs baseline F1 ${baseline.f1.toFixed(3)}.`
  );
  if (best.complexity <= config.baselineComplexity) {
    reasons.push(`Chosen prompt is leaner (${best.complexity} vs ${config.baselineComplexity} chars) — no complexity regression.`);
  } else {
    reasons.push(
      `Chosen prompt is longer (${best.complexity} vs ${config.baselineComplexity} chars) but the F1 gain justifies it.`
    );
  }

  const goalMet = config.goalF1 == null || best.metrics.f1 >= config.goalF1;
  if (config.goalF1 != null && !goalMet) {
    reasons.push(
      `Best F1 ${best.metrics.f1.toFixed(3)} did not reach the required goal F1 ${config.goalF1.toFixed(3)}; ` +
        `promoting the best safe candidate found but flagging the goal as unmet.`
    );
  }

  return { selected: best, baseline, reasons, goal_met: goalMet };
}
