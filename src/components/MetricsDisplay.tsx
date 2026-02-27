"use client";

import type { MetricsSummary } from "@/types";

export function MetricsDisplay({
  metrics,
  label,
  compact,
  showConfusionMatrix = true,
}: {
  metrics: MetricsSummary;
  label?: string;
  compact?: boolean;
  showConfusionMatrix?: boolean;
}) {
  const fmt = (v: number) => (v * 100).toFixed(1) + "%";

  if (compact) {
    return (
      <div className="flex gap-3 text-xs">
        <span>Acc: <b className="text-gray-300">{fmt(metrics.accuracy)}</b></span>
        <span>P: <b className="text-blue-400">{fmt(metrics.precision)}</b></span>
        <span>R: <b className="text-green-400">{fmt(metrics.recall)}</b></span>
        <span>F1: <b className="text-yellow-400">{fmt(metrics.f1)}</b></span>
        <span>Prev: <b className="text-purple-400">{fmt(metrics.prevalence)}</b></span>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      {label && <h3 className="text-sm font-medium text-gray-300 mb-3">{label}</h3>}

      {/* Primary Metrics */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <MetricCard label="Accuracy" value={fmt(metrics.accuracy)} color="text-gray-200" />
        <MetricCard label="Precision" value={fmt(metrics.precision)} color="text-blue-400" />
        <MetricCard label="Recall" value={fmt(metrics.recall)} color="text-green-400" />
        <MetricCard label="F1 Score" value={fmt(metrics.f1)} color="text-yellow-400" />
        <MetricCard label="Prevalence" value={fmt(metrics.prevalence)} color="text-purple-400" />
      </div>

      {showConfusionMatrix && <ConfusionMatrixPanel metrics={metrics} />}
    </div>
  );
}

export function ConfusionMatrixPanel({ metrics }: { metrics: MetricsSummary }) {
  const fmt = (v: number) => (v * 100).toFixed(1) + "%";
  return (
    <div className="flex gap-6 items-start">
      <div className="shrink-0">
        <p className="text-xs text-gray-500 mb-2 font-medium">Confusion Matrix</p>
        <div className="grid grid-cols-3 gap-0 text-xs">
          <div />
          <div className="text-center text-gray-500 pb-1 px-2">Pred +</div>
          <div className="text-center text-gray-500 pb-1 px-2">Pred −</div>
          <div className="text-gray-500 pr-2 text-right">Act +</div>
          <div className="bg-green-900/30 border border-green-800/50 px-3 py-2 text-center font-mono text-green-400">
            {metrics.tp}
          </div>
          <div className="bg-red-900/30 border border-red-800/50 px-3 py-2 text-center font-mono text-red-400">
            {metrics.fn}
          </div>
          <div className="text-gray-500 pr-2 text-right">Act −</div>
          <div className="bg-red-900/30 border border-red-800/50 px-3 py-2 text-center font-mono text-red-400">
            {metrics.fp}
          </div>
          <div className="bg-green-900/30 border border-green-800/50 px-3 py-2 text-center font-mono text-green-400">
            {metrics.tn}
          </div>
        </div>
      </div>

      <div className="text-xs space-y-1 text-gray-400">
        <p>Total: <span className="text-white">{metrics.total}</span></p>
        <p>TP: <span className="text-green-400">{metrics.tp}</span> | FP: <span className="text-red-400">{metrics.fp}</span></p>
        <p>FN: <span className="text-red-400">{metrics.fn}</span> | TN: <span className="text-green-400">{metrics.tn}</span></p>
        <p>Parse failures: <span className={metrics.parse_failure_rate > 0 ? "text-yellow-400" : "text-gray-400"}>{fmt(metrics.parse_failure_rate)}</span></p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-900/50 rounded px-3 py-2 text-center">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
