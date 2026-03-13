import type { MetricsSummary } from "@/types";

export type MetricKey =
  | "accuracy"
  | "precision"
  | "recall"
  | "f1"
  | "prevalence"
  | "parse_failure_rate";

export function getEvaluatedTotal(metrics: Pick<MetricsSummary, "tp" | "fp" | "fn" | "tn">): number {
  return Number(metrics.tp || 0) + Number(metrics.fp || 0) + Number(metrics.fn || 0) + Number(metrics.tn || 0);
}

export function getParseFailureCount(metrics: Pick<MetricsSummary, "total" | "tp" | "fp" | "fn" | "tn">): number {
  return Math.max(0, Number(metrics.total || 0) - getEvaluatedTotal(metrics));
}

export function isMetricDefined(metrics: MetricsSummary, key: MetricKey): boolean {
  const evaluatedTotal = getEvaluatedTotal(metrics);
  switch (key) {
    case "accuracy":
      return evaluatedTotal > 0;
    case "precision":
      return metrics.tp + metrics.fp > 0;
    case "recall":
      return metrics.tp + metrics.fn > 0;
    case "f1":
      return isMetricDefined(metrics, "precision") && isMetricDefined(metrics, "recall");
    case "prevalence":
    case "parse_failure_rate":
      return metrics.total > 0;
    default:
      return true;
  }
}

export function formatMetricValue(metrics: MetricsSummary, key: MetricKey): string {
  if (!isMetricDefined(metrics, key)) return "N/A";
  return `${(Number(metrics[key] || 0) * 100).toFixed(1)}%`;
}
