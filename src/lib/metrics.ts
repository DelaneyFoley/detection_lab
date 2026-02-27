import type { MetricsSummary, Prediction, Decision } from "@/types";

export function computeMetrics(predictions: Prediction[]): MetricsSummary {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  let parseFailures = 0;
  const labeled = predictions.filter(
    (p) => (p.corrected_label || p.ground_truth_label) === "DETECTED" || (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
  );
  const total = labeled.length;

  for (const p of labeled) {
    if (!p.parse_ok || !p.predicted_decision) {
      parseFailures++;
      // Treat parse failures as incorrect — if ground truth is DETECTED, it's FN; otherwise FP
      if (p.ground_truth_label === "DETECTED") fn++;
      else tn++; // Parse failure on NOT_DETECTED: conservative — count as TN
      continue;
    }

    const gt = p.corrected_label || p.ground_truth_label;
    const pred = p.predicted_decision;

    if (gt === "DETECTED" && pred === "DETECTED") tp++;
    else if (gt === "NOT_DETECTED" && pred === "DETECTED") fp++;
    else if (gt === "DETECTED" && pred === "NOT_DETECTED") fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;

  const positives = labeled.filter(
    (p) => (p.corrected_label || p.ground_truth_label) === "DETECTED"
  ).length;
  const prevalence = total > 0 ? positives / total : 0;

  return {
    tp,
    fp,
    fn,
    tn,
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    accuracy: Math.round(accuracy * 10000) / 10000,
    prevalence: Math.round(prevalence * 10000) / 10000,
    parse_failure_rate:
      total > 0 ? Math.round((parseFailures / total) * 10000) / 10000 : 0,
    total,
  };
}

export function metricsPassThresholds(
  metrics: MetricsSummary,
  thresholds: {
    min_precision?: number;
    min_recall?: number;
    min_f1?: number;
    primary_metric: string;
  }
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (thresholds.min_precision !== undefined && metrics.precision < thresholds.min_precision) {
    failures.push(`Precision ${metrics.precision} < threshold ${thresholds.min_precision}`);
  }
  if (thresholds.min_recall !== undefined && metrics.recall < thresholds.min_recall) {
    failures.push(`Recall ${metrics.recall} < threshold ${thresholds.min_recall}`);
  }
  if (thresholds.min_f1 !== undefined && metrics.f1 < thresholds.min_f1) {
    failures.push(`F1 ${metrics.f1} < threshold ${thresholds.min_f1}`);
  }

  return { passed: failures.length === 0, failures };
}

export function computeRegressionDelta(
  current: MetricsSummary,
  previous: MetricsSummary
): Record<string, number> {
  return {
    precision: Math.round((current.precision - previous.precision) * 10000) / 10000,
    recall: Math.round((current.recall - previous.recall) * 10000) / 10000,
    f1: Math.round((current.f1 - previous.f1) * 10000) / 10000,
    accuracy: Math.round((current.accuracy - previous.accuracy) * 10000) / 10000,
  };
}
