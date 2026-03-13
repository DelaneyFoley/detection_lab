"use client";

import type { MetricsSummary } from "@/types";
import { formatMetricValue, getEvaluatedTotal, getParseFailureCount } from "@/lib/ui/metrics";

export function MetricsDisplay({
  metrics,
  label,
  compact,
  showConfusionMatrix = true,
  variant = "elevated",
}: {
  metrics: MetricsSummary;
  label?: string;
  compact?: boolean;
  showConfusionMatrix?: boolean;
  variant?: "elevated" | "flat";
}) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-2 text-xs">
        <CompactMetric label="Acc" value={formatMetricValue(metrics, "accuracy")} tone="text-[var(--app-text)]" />
        <CompactMetric label="P" value={formatMetricValue(metrics, "precision")} tone="text-[var(--app-text)]" />
        <CompactMetric label="R" value={formatMetricValue(metrics, "recall")} tone="text-[var(--app-text)]" />
        <CompactMetric label="F1" value={formatMetricValue(metrics, "f1")} tone="text-[var(--app-text)]" />
        <CompactMetric label="Prev" value={formatMetricValue(metrics, "prevalence")} tone="text-[var(--app-text)]" />
      </div>
    );
  }

  return (
    <div className={variant === "flat" ? "app-section p-4 md:p-5" : "app-card-strong p-4 md:p-5"}>
      {label && <h3 className="mb-4 text-sm font-semibold tracking-wide text-[var(--app-text)]">{label}</h3>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Accuracy" value={formatMetricValue(metrics, "accuracy")} color="text-[var(--app-text)]" />
        <MetricCard label="Precision" value={formatMetricValue(metrics, "precision")} color="text-[var(--app-text)]" />
        <MetricCard label="Recall" value={formatMetricValue(metrics, "recall")} color="text-[var(--app-text)]" />
        <MetricCard label="F1 Score" value={formatMetricValue(metrics, "f1")} color="text-[var(--app-text)]" />
        <MetricCard label="Prevalence" value={formatMetricValue(metrics, "prevalence")} color="text-[var(--app-text)]" />
      </div>

      {showConfusionMatrix && <ConfusionMatrixPanel metrics={metrics} />}
      <SegmentMetricsPanel metrics={metrics} />
    </div>
  );
}

export function ConfusionMatrixPanel({
  metrics,
  embedded = false,
}: {
  metrics: MetricsSummary;
  embedded?: boolean;
}) {
  const parseFailures = getParseFailureCount(metrics);
  const totalCorrect = metrics.tp + metrics.tn;
  const totalIncorrect = metrics.fp + metrics.fn;
  return (
    <div className={embedded ? "" : "mt-6 border-t border-white/8 pt-5"}>
      <div className="flex justify-center">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-8">
          <div className="shrink-0">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">Confusion Matrix</p>
            <div className="flex items-start gap-3 text-xs">
              <div className="grid grid-rows-[1.5rem,2.5rem,2.5rem] items-center text-[var(--app-text-subtle)]">
                <div />
                <div className="flex h-10 translate-y-3.5 items-center justify-end pr-1">Act +</div>
                <div className="flex h-10 translate-y-3.5 items-center justify-end pr-1">Act −</div>
              </div>
              <div className="grid grid-cols-2 grid-rows-[1.5rem,2.5rem,2.5rem] gap-0">
                <div className="flex items-center justify-center px-2 text-[var(--app-text-subtle)]">Pred +</div>
                <div className="flex items-center justify-center px-2 text-[var(--app-text-subtle)]">Pred −</div>
                <div className="flex h-10 min-w-[3.4rem] items-center justify-center bg-[rgba(17,59,49,0.56)] px-3 font-mono text-[var(--app-success)]">
                  {metrics.tp}
                </div>
                <div className="flex h-10 min-w-[3.4rem] items-center justify-center bg-[rgba(85,24,31,0.56)] px-3 font-mono text-[var(--app-danger)]">
                  {metrics.fn}
                </div>
                <div className="flex h-10 min-w-[3.4rem] items-center justify-center bg-[rgba(85,24,31,0.56)] px-3 font-mono text-[var(--app-danger)]">
                  {metrics.fp}
                </div>
                <div className="flex h-10 min-w-[3.4rem] items-center justify-center bg-[rgba(17,59,49,0.56)] px-3 font-mono text-[var(--app-success)]">
                  {metrics.tn}
                </div>
              </div>
            </div>
          </div>

          <div className="grid w-fit grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
            <MetricSummary label="Total" value={String(metrics.total)} tone="text-white" />
            <MetricSummary label="Correct" value={String(totalCorrect)} tone={totalCorrect > 0 ? "text-[var(--app-success)]" : "text-white"} />
            <MetricSummary label="Incorrect" value={String(totalIncorrect)} tone={totalIncorrect > 0 ? "text-[var(--app-danger)]" : "text-white"} />
            <MetricSummary label="Failure" value={String(parseFailures)} tone={parseFailures > 0 ? "text-[var(--app-danger)]" : "text-white"} />
            <MetricSummary label="TP" value={String(metrics.tp)} tone="text-[var(--app-success)]" />
            <MetricSummary label="FP" value={String(metrics.fp)} tone={metrics.fp > 0 ? "text-[var(--app-danger)]" : "text-white"} />
            <MetricSummary label="TN" value={String(metrics.tn)} tone="text-white" />
            <MetricSummary label="FN" value={String(metrics.fn)} tone={metrics.fn > 0 ? "text-[var(--app-danger)]" : "text-white"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className={`text-[1.45rem] font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">{label}</div>
    </div>
  );
}

function SegmentMetricsPanel({ metrics }: { metrics: MetricsSummary }) {
  const entries = Object.entries(metrics.segment_metrics || {}).sort(([, a], [, b]) => b.total - a.total);
  if (entries.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">Attribute Breakdown</p>
      <div className="app-metric-breakdown text-xs">
        <div className="app-metric-breakdown-row app-metric-breakdown-head">
          <div className="app-metric-breakdown-cell app-metric-breakdown-label">Attribute</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">Total</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">Accuracy</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">Precision</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">Recall</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">F1</div>
          <div className="app-metric-breakdown-cell app-metric-breakdown-value">Parse Fail</div>
        </div>
        <div className="app-metric-breakdown-body">
          {entries.map(([segment, value]) => (
            <div key={segment} className="app-metric-breakdown-row">
              <div className="app-metric-breakdown-cell app-metric-breakdown-label text-[var(--app-text)]">{segment}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text-muted)]">{value.total}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(value, "accuracy")}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(value, "precision")}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(value, "recall")}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(value, "f1")}</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(value, "parse_failure_rate")}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[var(--app-text-subtle)]">
        Images with multiple attributes are counted in each attribute.
      </p>
    </div>
  );
}

function CompactMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="app-badge">
      <span className="text-[var(--app-text-subtle)]">{label}</span>
      <b className={tone}>{value}</b>
    </span>
  );
}

function MetricSummary({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="flex min-h-[2.2rem] items-end text-[11px] uppercase tracking-[0.14em] leading-[1.1rem] text-[var(--app-text-subtle)]">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
