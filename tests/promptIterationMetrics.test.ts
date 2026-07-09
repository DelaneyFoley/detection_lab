import { describe, it, expect } from "vitest";
import {
  classifyOutcome,
  confusionFromPairs,
  confusionFromRows,
  metricsFromConfusion,
  stratifiedSplit,
  groupAwareStratifiedSplit,
  attributeSignature,
  nearDuplicateGroupKey,
  candidateComplexity,
  selectBestCandidate,
  resolveEvaluationPlan,
  groupBootstrapDelta,
  objectiveScore,
  objectiveEligible,
  parseObjective,
  DEFAULT_SELECTION_CONFIG,
} from "@/lib/promptIteration/metrics";
import type { CandidateResult, ReviewedRow } from "@/lib/promptIteration/types";

function row(partial: Partial<ReviewedRow>): ReviewedRow {
  return {
    image_id: partial.image_id || "img",
    image_uri: partial.image_uri || "uri",
    original_ground_truth: partial.original_ground_truth ?? null,
    finalized_ground_truth: partial.finalized_ground_truth ?? null,
    ai_predicted: partial.ai_predicted ?? null,
    ai_evidence: partial.ai_evidence ?? null,
    reviewer_note: partial.reviewer_note ?? null,
    attributes: partial.attributes ?? [],
    confidence: partial.confidence ?? null,
    parse_ok: partial.parse_ok ?? true,
    outcome: partial.outcome ?? "UNLABELED",
  };
}

function candidateResult(over: Partial<CandidateResult> & { f1: number; precision: number; recall: number; complexity: number; id: string; parse_errors?: number }): CandidateResult {
  return {
    candidate: {
      id: over.id,
      kind: "balanced",
      label: over.id,
      target_failure_mode: "",
      rationale: "",
      label_policy: "policy",
      decision_rubric: "rubric",
    },
    confusion: { tp: 0, fp: 0, fn: 0, tn: 0, parseFail: 0, total: 0 },
    metrics: { precision: over.precision, recall: over.recall, f1: over.f1, accuracy: 0 },
    complexity: over.complexity,
    parse_errors: over.parse_errors ?? 0,
    changed_rows: [],
    rejected_reasons: [],
    eval_error: null,
  };
}

describe("classifyOutcome", () => {
  it("classifies TP/FP/FN/TN correctly", () => {
    expect(classifyOutcome("DETECTED", "DETECTED", true)).toBe("TP");
    expect(classifyOutcome("DETECTED", "NOT_DETECTED", true)).toBe("FP");
    expect(classifyOutcome("NOT_DETECTED", "DETECTED", true)).toBe("FN");
    expect(classifyOutcome("NOT_DETECTED", "NOT_DETECTED", true)).toBe("TN");
  });
  it("treats parse failures and missing labels", () => {
    expect(classifyOutcome(null, "DETECTED", false)).toBe("PARSE_FAIL");
    expect(classifyOutcome("DETECTED", null, true)).toBe("UNLABELED");
  });
});

describe("confusion + metrics", () => {
  it("computes precision/recall/f1 from pairs", () => {
    const c = confusionFromPairs([
      { predicted: "DETECTED", truth: "DETECTED", parseOk: true }, // TP
      { predicted: "DETECTED", truth: "DETECTED", parseOk: true }, // TP
      { predicted: "DETECTED", truth: "NOT_DETECTED", parseOk: true }, // FP
      { predicted: "NOT_DETECTED", truth: "DETECTED", parseOk: true }, // FN
      { predicted: "NOT_DETECTED", truth: "NOT_DETECTED", parseOk: true }, // TN
    ]);
    expect(c).toMatchObject({ tp: 2, fp: 1, fn: 1, tn: 1, total: 5 });
    const m = metricsFromConfusion(c);
    expect(m.precision).toBeCloseTo(2 / 3, 4);
    expect(m.recall).toBeCloseTo(2 / 3, 4);
    expect(m.f1).toBeCloseTo(2 / 3, 4);
    expect(m.accuracy).toBeCloseTo(3 / 5, 4);
  });

  it("ignores unlabeled rows in the denominator", () => {
    const c = confusionFromRows([
      row({ ai_predicted: "DETECTED", finalized_ground_truth: "DETECTED" }),
      row({ ai_predicted: "DETECTED", finalized_ground_truth: null }),
    ]);
    expect(c.total).toBe(1);
  });

  it("returns zeros for empty input", () => {
    const m = metricsFromConfusion(confusionFromPairs([]));
    expect(m).toEqual({ precision: 0, recall: 0, f1: 0, accuracy: 0 });
  });
});

describe("stratifiedSplit", () => {
  const rows: ReviewedRow[] = [
    ...Array.from({ length: 10 }, (_, i) => row({ image_id: `p${i}`, finalized_ground_truth: "DETECTED" })),
    ...Array.from({ length: 10 }, (_, i) => row({ image_id: `n${i}`, finalized_ground_truth: "NOT_DETECTED" })),
  ];

  it("is deterministic for the same seed", () => {
    const a = stratifiedSplit(rows, 0.3, "seed-x");
    const b = stratifiedSplit(rows, 0.3, "seed-x");
    expect(a.holdout.map((r) => r.image_id).sort()).toEqual(b.holdout.map((r) => r.image_id).sort());
  });

  it("stratifies positives and negatives into the holdout", () => {
    const { holdout, tuning } = stratifiedSplit(rows, 0.3, "seed-y");
    const pos = holdout.filter((r) => r.finalized_ground_truth === "DETECTED").length;
    const neg = holdout.filter((r) => r.finalized_ground_truth === "NOT_DETECTED").length;
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeGreaterThan(0);
    // No overlap between tuning and holdout.
    const holdoutIds = new Set(holdout.map((r) => r.image_id));
    expect(tuning.some((r) => holdoutIds.has(r.image_id))).toBe(false);
    expect(holdout.length + tuning.length).toBe(rows.length);
  });

  it("guarantees at least one holdout item per stratum with >= 2 items", () => {
    const tiny: ReviewedRow[] = [
      row({ image_id: "p0", finalized_ground_truth: "DETECTED" }),
      row({ image_id: "p1", finalized_ground_truth: "DETECTED" }),
      row({ image_id: "n0", finalized_ground_truth: "NOT_DETECTED" }),
      row({ image_id: "n1", finalized_ground_truth: "NOT_DETECTED" }),
    ];
    const { holdout } = stratifiedSplit(tiny, 0.2, "seed-z");
    expect(holdout.length).toBeGreaterThanOrEqual(2);
  });
});

describe("attributeSignature + nearDuplicateGroupKey", () => {
  it("is order-independent and normalized", () => {
    expect(attributeSignature(["Rust", "wet"])).toBe(attributeSignature(["wet", "RUST"]));
    expect(attributeSignature([" heavy ", "heavy", ""]))
      .toBe("heavy");
  });

  it("clusters explicit duplicates but not sequential frames", () => {
    // Explicit dup markers collapse to the same group.
    expect(nearDuplicateGroupKey("mcwh_006")).toBe(nearDuplicateGroupKey("MCWH_006-copy"));
    expect(nearDuplicateGroupKey("img12.jpg")).toBe(nearDuplicateGroupKey("img12-v2"));
    expect(nearDuplicateGroupKey("shot(1)")).toBe(nearDuplicateGroupKey("shot"));
    // Sequential distinct images stay separate.
    expect(nearDuplicateGroupKey("mcwh_006")).not.toBe(nearDuplicateGroupKey("mcwh_007"));
  });
});

describe("groupAwareStratifiedSplit", () => {
  it("keeps near-duplicate groups on the same side (no leakage)", () => {
    const rows: ReviewedRow[] = [];
    // 6 objects, each with an original + a "-copy" near-duplicate, all DETECTED.
    for (let i = 0; i < 6; i++) {
      rows.push(row({ image_id: `obj${i}`, finalized_ground_truth: "DETECTED", attributes: ["rust"] }));
      rows.push(row({ image_id: `obj${i}-copy`, finalized_ground_truth: "DETECTED", attributes: ["rust"] }));
    }
    const { tuning, holdout } = groupAwareStratifiedSplit(rows, 0.34, "seed-g");
    const group = (id: string) => nearDuplicateGroupKey(id);
    const tuningGroups = new Set(tuning.map((r) => group(r.image_id)));
    const holdoutGroups = new Set(holdout.map((r) => group(r.image_id)));
    // No group appears on both sides.
    for (const g of holdoutGroups) expect(tuningGroups.has(g)).toBe(false);
    expect(tuning.length + holdout.length).toBe(rows.length);
    expect(holdout.length).toBeGreaterThan(0);
  });

  it("stratifies by label AND attributes", () => {
    const rows: ReviewedRow[] = [
      ...Array.from({ length: 4 }, (_, i) => row({ image_id: `d_rust_${i}`, finalized_ground_truth: "DETECTED", attributes: ["rust"] })),
      ...Array.from({ length: 4 }, (_, i) => row({ image_id: `d_pit_${i}`, finalized_ground_truth: "DETECTED", attributes: ["pitting"] })),
      ...Array.from({ length: 4 }, (_, i) => row({ image_id: `n_${i}`, finalized_ground_truth: "NOT_DETECTED", attributes: [] })),
    ];
    const { holdout } = groupAwareStratifiedSplit(rows, 0.5, "seed-h");
    const sigs = new Set(holdout.map((r) => `${r.finalized_ground_truth}|${attributeSignature(r.attributes)}`));
    // Each of the 3 label×attribute strata is represented in the holdout.
    expect(sigs.size).toBe(3);
  });

  it("holds out a real ~fraction even when attribute combinations are all unique", () => {
    // 100 images, each with a UNIQUE attribute combination — the case that used
    // to collapse the holdout to a tiny slice under attribute stratification.
    const rows: ReviewedRow[] = Array.from({ length: 100 }, (_, i) =>
      row({
        image_id: `img_${i}`,
        finalized_ground_truth: i % 3 === 0 ? "DETECTED" : "NOT_DETECTED",
        attributes: [`attr_${i}`],
      })
    );
    const { tuning, holdout } = groupAwareStratifiedSplit(rows, 0.3, "seed-real");
    expect(tuning.length + holdout.length).toBe(100);
    // Real ~30% holdout (allow small rounding slack), not a collapsed handful.
    expect(holdout.length).toBeGreaterThanOrEqual(28);
    expect(holdout.length).toBeLessThanOrEqual(32);
    // Both labels represented in the holdout.
    expect(holdout.some((r) => r.finalized_ground_truth === "DETECTED")).toBe(true);
    expect(holdout.some((r) => r.finalized_ground_truth === "NOT_DETECTED")).toBe(true);
  });
});

describe("resolveEvaluationPlan (size-adaptive)", () => {
  it("uses a larger holdout + higher effect floor for small samples", () => {
    const small = resolveEvaluationPlan({ labeled: 40, positives: 20, negatives: 20 });
    expect(small.regime).toBe("small");
    expect(small.holdoutFraction).toBe(0.3);
    expect(small.minEffectF1).toBeGreaterThanOrEqual(0.05);
  });
  it("scales down the holdout + effect floor as the sample grows", () => {
    const medium = resolveEvaluationPlan({ labeled: 300, positives: 150, negatives: 150 });
    const large = resolveEvaluationPlan({ labeled: 800, positives: 400, negatives: 400 });
    expect(medium.regime).toBe("medium");
    expect(large.regime).toBe("large");
    expect(large.holdoutFraction).toBeLessThan(medium.holdoutFraction);
    expect(large.minEffectF1).toBeLessThan(small().minEffectF1);
  });
  it("power is limited by the smaller class, not raw row count", () => {
    // 1000 rows but only 10 positives → still 'small' regime.
    const imbalanced = resolveEvaluationPlan({ labeled: 1000, positives: 10, negatives: 990 });
    expect(imbalanced.regime).toBe("small");
  });
  const small = () => resolveEvaluationPlan({ labeled: 40, positives: 20, negatives: 20 });
});

describe("groupBootstrapDelta", () => {
  it("returns a positive, confident ΔF1 when the candidate clearly fixes errors", () => {
    // Baseline misses every positive (all FN); candidate gets them all right.
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ group: `p${i}`, truth: "DETECTED" as const, base: "NOT_DETECTED" as const, cand: "DETECTED" as const })),
      ...Array.from({ length: 12 }, (_, i) => ({ group: `n${i}`, truth: "NOT_DETECTED" as const, base: "NOT_DETECTED" as const, cand: "NOT_DETECTED" as const })),
    ];
    const boot = groupBootstrapDelta(rows, { iters: 500, seed: "s", minGain: 0.05 });
    expect(boot.f1.mean).toBeGreaterThan(0.5);
    expect(boot.f1.lo).toBeGreaterThan(0);
    expect(boot.probGain).toBeGreaterThan(0.95);
  });
  it("reports a near-zero, non-confident ΔF1 when candidate == baseline", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ group: `p${i}`, truth: "DETECTED" as const, base: "DETECTED" as const, cand: "DETECTED" as const })),
      ...Array.from({ length: 12 }, (_, i) => ({ group: `n${i}`, truth: "NOT_DETECTED" as const, base: "NOT_DETECTED" as const, cand: "NOT_DETECTED" as const })),
    ];
    const boot = groupBootstrapDelta(rows, { iters: 500, seed: "s", minGain: 0.05 });
    expect(boot.f1.mean).toBe(0);
    expect(boot.probGain).toBe(0);
  });
  it("is deterministic for a fixed seed", () => {
    const rows = [
      { group: "a", truth: "DETECTED" as const, base: "NOT_DETECTED" as const, cand: "DETECTED" as const },
      { group: "b", truth: "NOT_DETECTED" as const, base: "DETECTED" as const, cand: "NOT_DETECTED" as const },
      { group: "c", truth: "DETECTED" as const, base: "DETECTED" as const, cand: "DETECTED" as const },
    ];
    const a = groupBootstrapDelta(rows, { iters: 200, seed: "fixed", minGain: 0 });
    const b = groupBootstrapDelta(rows, { iters: 200, seed: "fixed", minGain: 0 });
    expect(a).toEqual(b);
  });
});

describe("objective functions", () => {
  const conf = { tp: 6, fp: 1, fn: 4, tn: 9, parseFail: 0, total: 20 };
  const m = { precision: 6 / 7, recall: 6 / 10, f1: 0.706, accuracy: 0.75 };

  it("F0.5 (precision-weighted) beats F2 when precision > recall", () => {
    const f2 = objectiveScore(m, conf, { kind: "fbeta", beta: 2 });
    const f05 = objectiveScore(m, conf, { kind: "fbeta", beta: 0.5 });
    expect(f05).toBeGreaterThan(f2);
  });

  it("recall_at_precision scores recall and gates on the precision floor", () => {
    expect(objectiveScore(m, conf, { kind: "recall_at_precision", precisionFloor: 0.8 })).toBeCloseTo(0.6, 3);
    expect(objectiveEligible(m, { kind: "recall_at_precision", precisionFloor: 0.8 }).ok).toBe(true);
    expect(objectiveEligible(m, { kind: "recall_at_precision", precisionFloor: 0.95 }).ok).toBe(false);
  });

  it("parseObjective normalizes and defaults to F1", () => {
    expect(parseObjective(null)).toEqual({ kind: "f1" });
    expect(parseObjective({ kind: "fbeta", beta: 2 })).toEqual({ kind: "fbeta", beta: 2 });
    expect(parseObjective({ kind: "recall_at_precision", precisionFloor: 1.4 })).toEqual({ kind: "recall_at_precision", precisionFloor: 1 });
    expect(parseObjective({ kind: "bogus" })).toEqual({ kind: "f1" });
  });

  it("selection ranks by the chosen objective, not F1", () => {
    const A = candidateResult({ id: "A", f1: 0.8, precision: 0.95, recall: 0.69, complexity: 100 });
    const B = candidateResult({ id: "B", f1: 0.76, precision: 0.7, recall: 0.83, complexity: 100 });
    const baseCore = { precision: 0.9, recall: 0.5, f1: 0.64, accuracy: 0.7 };
    const byF1 = selectBestCandidate(baseCore, [A, B], {
      goalF1: null, precisionFloor: null, precisionDropTolerance: 0.05,
      minF1GainForComplexity: 0.01, baselineComplexity: 200,
    });
    expect(byF1.selected?.candidate.id).toBe("A");
    const byRecall = selectBestCandidate(baseCore, [A, B], {
      goalF1: null, precisionFloor: null, precisionDropTolerance: 0.05,
      minF1GainForComplexity: 0.01, baselineComplexity: 200,
      objective: { kind: "recall_at_precision", precisionFloor: 0.6 }, baselineScore: 0.5,
    });
    expect(byRecall.selected?.candidate.id).toBe("B");
  });
});

describe("selectBestCandidate guardrails", () => {
  const baseline = { precision: 0.9, recall: 0.6, f1: 0.72, accuracy: 0.8 };
  const config = {
    goalF1: null,
    precisionFloor: null,
    precisionDropTolerance: DEFAULT_SELECTION_CONFIG.precisionDropTolerance,
    minF1GainForComplexity: DEFAULT_SELECTION_CONFIG.minF1GainForComplexity,
    baselineComplexity: 500,
  };

  it("rejects candidates that do not beat baseline F1", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "c1", f1: 0.72, precision: 0.9, recall: 0.6, complexity: 400 }),
    ], config);
    expect(res.selected).toBeNull();
  });

  it("rejects candidates that collapse precision below tolerance", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "c1", f1: 0.8, precision: 0.6, recall: 0.99, complexity: 400 }),
    ], config);
    expect(res.selected).toBeNull();
  });

  it("selects the higher-F1 safe candidate", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "low", f1: 0.75, precision: 0.88, recall: 0.66, complexity: 400 }),
      candidateResult({ id: "high", f1: 0.82, precision: 0.88, recall: 0.77, complexity: 400 }),
    ], config);
    expect(res.selected?.candidate.id).toBe("high");
  });

  it("hard-rejects any candidate that produces parse errors", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "parsey", f1: 0.95, precision: 0.95, recall: 0.95, complexity: 400, parse_errors: 2 }),
    ], config);
    expect(res.selected).toBeNull();
  });

  it("prefers a clean candidate over a higher-F1 one with parse errors", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "parsey", f1: 0.95, precision: 0.95, recall: 0.95, complexity: 400, parse_errors: 1 }),
      candidateResult({ id: "clean", f1: 0.80, precision: 0.88, recall: 0.73, complexity: 400, parse_errors: 0 }),
    ], config);
    expect(res.selected?.candidate.id).toBe("clean");
  });

  it("prefers the leaner candidate when F1 is a near tie", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "fat", f1: 0.80, precision: 0.88, recall: 0.73, complexity: 900 }),
      candidateResult({ id: "lean", f1: 0.795, precision: 0.88, recall: 0.72, complexity: 300 }),
    ], config);
    expect(res.selected?.candidate.id).toBe("lean");
  });

  it("flags goal not met but still promotes the best safe candidate", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "c1", f1: 0.78, precision: 0.88, recall: 0.70, complexity: 400 }),
    ], { ...config, goalF1: 0.9 });
    expect(res.selected?.candidate.id).toBe("c1");
    expect(res.goal_met).toBe(false);
  });
});

describe("selectBestCandidate with an explicit precision floor", () => {
  // Mirrors the user scenario: 100% precision baseline, candidates trade
  // precision for recall. An explicit floor should govern and disable the
  // relative drop-tolerance rejection.
  const baseline = { precision: 1.0, recall: 0.476, f1: 0.645, accuracy: 0.75 };
  const base = {
    goalF1: null,
    precisionDropTolerance: DEFAULT_SELECTION_CONFIG.precisionDropTolerance,
    minF1GainForComplexity: DEFAULT_SELECTION_CONFIG.minF1GainForComplexity,
    baselineComplexity: 88,
  };

  it("rejects everything by default (drop tolerance) when precision is perfect", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "lean", f1: 0.757, precision: 0.823, recall: 0.70, complexity: 88 }),
    ], { ...base, precisionFloor: null });
    expect(res.selected).toBeNull();
  });

  it("promotes a precision-for-recall trade when the floor allows it", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "lean", f1: 0.757, precision: 0.823, recall: 0.70, complexity: 88 }),
    ], { ...base, precisionFloor: 0.8 });
    expect(res.selected?.candidate.id).toBe("lean");
  });

  it("still rejects candidates below the explicit floor", () => {
    const res = selectBestCandidate(baseline, [
      candidateResult({ id: "recall", f1: 0.756, precision: 0.708, recall: 0.81, complexity: 197 }),
    ], { ...base, precisionFloor: 0.8 });
    expect(res.selected).toBeNull();
  });
});

describe("candidateComplexity", () => {
  it("counts characters across tuned fields", () => {
    expect(candidateComplexity("abc", "de", "f")).toBe(6);
  });
});
