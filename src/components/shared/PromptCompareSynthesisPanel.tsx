"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { AVAILABLE_MODELS } from "@/lib/models";
import type { PromptVersion, Run } from "@/types";
import type { CompareJob } from "@/lib/promptCompare/types";

interface Props {
  detectionId: string;
  detectionCode: string;
  prompts: PromptVersion[];
  runs: Run[];
  selectedPromptIds: string[];
}

const fmtPct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(1)}%`;

const fmtDeltaPct = (delta: number): string => {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)} pts`;
};

/** Client-side preview: shared datasets across every selected prompt. */
function sharedDatasetIds(runs: Run[], promptIds: string[]): string[] {
  if (promptIds.length === 0) return [];
  const perPrompt: Set<string>[] = promptIds.map((pid) => {
    const ids = new Set<string>();
    for (const r of runs) {
      if (r.prompt_version_id === pid && r.status === "completed" && r.dataset_id) {
        ids.add(r.dataset_id);
      }
    }
    return ids;
  });
  const first = perPrompt[0];
  const out: string[] = [];
  for (const id of Array.from(first)) {
    if (perPrompt.every((s) => s.has(id))) out.push(id);
  }
  return out;
}

export function PromptCompareSynthesisPanel({
  detectionId,
  detectionCode,
  prompts,
  runs,
  selectedPromptIds,
}: Props) {
  const { triggerRefresh } = useAppStore();
  const { notify } = useAppFeedback();

  const [analyzerModel, setAnalyzerModel] = useState("claude-sonnet-4-6");
  const [temperature, setTemperature] = useState(0.4);
  const [imageCap, setImageCap] = useState(40);
  const [includeCounterexamples, setIncludeCounterexamples] = useState(true);
  const [evaluate, setEvaluate] = useState(true);

  const [job, setJob] = useState<CompareJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shared = useMemo(
    () => sharedDatasetIds(runs, selectedPromptIds),
    [runs, selectedPromptIds]
  );

  const selectedLabels = useMemo(() => {
    const byId = new Map(prompts.map((p) => [p.prompt_version_id, p.version_label]));
    return selectedPromptIds.map((id) => byId.get(id) || id.slice(0, 8));
  }, [prompts, selectedPromptIds]);

  const canStart = selectedPromptIds.length >= 2 && shared.length > 0 && !starting && !isRunningStatus(job?.status);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/prompts/compare-synthesize?job_id=${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      const next = data?.job as CompareJob | undefined;
      if (!next) return;
      setJob(next);
      if (!isRunningStatus(next.status)) {
        stopPolling();
        if (next.status === "completed") triggerRefresh();
      }
    } catch {
      // best-effort polling
    }
  }, [triggerRefresh, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    // Reset job if user changed the selected prompt set — the old job's context
    // no longer matches what the user is now looking at.
    if (job && !arraysEqual(job.source_prompt_version_ids, selectedPromptIds)) {
      stopPolling();
      setJob(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPromptIds.join(",")]);

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    try {
      const res = await fetch("/api/prompts/compare-synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_id: detectionId,
          prompt_version_ids: selectedPromptIds,
          analyzer_model: analyzerModel,
          analyzer_temperature: temperature,
          image_cap: imageCap,
          include_agreement_samples: includeCounterexamples,
          evaluate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify({ message: data?.error || "Failed to start synthesis", tone: "error" });
        return;
      }
      const started = data?.job as CompareJob;
      setJob(started);
      pollRef.current = setInterval(() => pollOnce(started.job_id), 1500);
    } catch (err) {
      notify({ message: `Failed to start synthesis: ${(err as Error).message}`, tone: "error" });
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const res = await fetch("/api/prompts/compare-synthesize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", job_id: job.job_id }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify({ message: data?.error || "Cancel failed", tone: "error" });
        return;
      }
      pollOnce(job.job_id);
    } finally {
      setBusy(false);
    }
  };

  const trash = async () => {
    if (!job?.result_prompt_version_id) return;
    if (!window.confirm("Trash the synthesized prompt version? This deletes the version and its evaluation run.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/prompts/compare-synthesize", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trash",
          job_id: job.job_id,
          prompt_version_id: job.result_prompt_version_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify({ message: data?.error || "Trash failed", tone: "error" });
        return;
      }
      setJob(data.job as CompareJob);
      triggerRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-card-strong p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Synthesize prompt from disagreements</h3>
          <p className="text-xs text-[var(--app-text-muted)] mt-1">
            Analyzes every shared dataset — union of prompt-vs-prompt and prompt-vs-ground-truth
            errors — and compiles a single merged prompt that keeps each source&apos;s strengths.
          </p>
        </div>
        <div className="text-xs text-[var(--app-text-muted)]">
          <div>Selected: {selectedPromptIds.length} prompt(s){selectedLabels.length ? ` — ${selectedLabels.join(", ")}` : ""}</div>
          <div>Shared datasets: <span className="text-white tabular-nums">{shared.length}</span></div>
        </div>
      </div>

      {selectedPromptIds.length < 2 ? (
        <p className="text-xs text-[var(--app-text-muted)]">Select at least 2 prompts above to enable synthesis.</p>
      ) : shared.length === 0 ? (
        <p className="text-xs text-[var(--app-text-muted)]">No datasets are shared across every selected prompt. Run them on a common dataset first.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs space-y-1">
              <span className="app-label">Analyzer model</span>
              <select
                value={analyzerModel}
                onChange={(e) => setAnalyzerModel(e.target.value)}
                className="app-input w-full text-xs"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span className="app-label">Temperature ({temperature.toFixed(2)})</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="app-label">Image budget ({imageCap})</span>
              <input
                type="range"
                min={8}
                max={80}
                step={4}
                value={imageCap}
                onChange={(e) => setImageCap(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <div className="text-xs space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeCounterexamples}
                  onChange={(e) => setIncludeCounterexamples(e.target.checked)}
                />
                Include agreement counterexamples
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={evaluate}
                  onChange={(e) => setEvaluate(e.target.checked)}
                />
                Evaluate on disagreement set
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={start}
              disabled={!canStart}
              className="app-btn app-btn-primary app-btn-md text-sm"
            >
              {starting ? "Starting..." : isRunningStatus(job?.status) ? "Running..." : "Synthesize prompt"}
            </button>
            {isRunningStatus(job?.status) && (
              <button
                onClick={cancel}
                disabled={busy}
                className="app-btn app-btn-danger app-btn-md text-sm"
              >
                Cancel
              </button>
            )}
            {job && (
              <span className="text-xs text-[var(--app-text-muted)]">
                Job <span className="font-mono">{job.job_id.slice(0, 8)}</span> · {job.status}
                {job.phase ? ` · ${job.phase}` : ""}
                {job.progress != null ? ` · ${job.progress}%` : ""}
              </span>
            )}
          </div>

          {job && <JobPanel job={job} detectionCode={detectionCode} onTrash={trash} busy={busy} />}
        </>
      )}
    </div>
  );
}

function isRunningStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted1 = [...a].sort();
  const sorted2 = [...b].sort();
  return sorted1.every((v, i) => v === sorted2[i]);
}

function JobPanel({
  job,
  detectionCode,
  onTrash,
  busy,
}: {
  job: CompareJob;
  detectionCode: string;
  onTrash: () => void;
  busy: boolean;
}) {
  const analysis = job.synthesis_analysis;
  const lastLog = job.logs[job.logs.length - 1];

  return (
    <div className="space-y-4 border-t border-[var(--app-border)] pt-4">
      {job.error && (
        <div className="rounded border border-red-800 bg-red-950/30 p-3 text-xs text-red-300">
          <div className="font-medium">Job failed</div>
          <div className="mt-1">{job.error}</div>
        </div>
      )}
      {lastLog && (
        <div className="text-xs text-[var(--app-text-muted)]">
          Last update ({lastLog.phase}): {lastLog.message}
        </div>
      )}

      {job.per_prompt_metrics && job.per_prompt_metrics.length > 0 && (
        <div className="app-table-wrap overflow-x-auto">
          <div className="app-label mb-2">Per-prompt performance on the disagreement set ({job.disagreement_image_count} rows)</div>
          <table className="app-table app-table-fixed text-xs">
            <thead>
              <tr>
                <th className="app-table-col-label">Prompt</th>
                <th className="app-table-col-label">P</th>
                <th className="app-table-col-label">R</th>
                <th className="app-table-col-label">F1</th>
                <th className="app-table-col-label">TP/FP/FN/TN</th>
                <th className="app-table-col-label">Parse fail</th>
              </tr>
            </thead>
            <tbody>
              {job.per_prompt_metrics.map((m) => (
                <tr key={m.prompt_version_id}>
                  <td className="font-medium">{m.label}</td>
                  <td className="tabular-nums">{fmtPct(m.metrics.precision)}</td>
                  <td className="tabular-nums">{fmtPct(m.metrics.recall)}</td>
                  <td className="tabular-nums">{fmtPct(m.metrics.f1)}</td>
                  <td className="tabular-nums">{m.tp}/{m.fp}/{m.fn}/{m.tn}</td>
                  <td className="tabular-nums">{m.parse_fail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {analysis.per_prompt.map((p) => (
            <div key={p.prompt_version_id} className="rounded border border-[var(--app-border)] p-3 space-y-2">
              <div className="text-xs font-medium">{p.label}</div>
              {p.strengths.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-green-400">Strengths</div>
                  <ul className="text-xs text-[var(--app-text)] list-disc pl-4 space-y-0.5">
                    {p.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {p.weaknesses.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-red-400">Weaknesses</div>
                  <ul className="text-xs text-[var(--app-text)] list-disc pl-4 space-y-0.5">
                    {p.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {analysis?.synthesis && (
        <div className="rounded border border-[var(--app-border)] p-3 space-y-3">
          <div className="text-xs font-medium">
            Synthesized prompt{job.result_prompt_version_id ? " (saved)" : ""}
          </div>
          {analysis.synthesis.rationale && (
            <div className="text-xs text-[var(--app-text-muted)]">
              <span className="font-medium text-[var(--app-text)]">Rationale:</span> {analysis.synthesis.rationale}
            </div>
          )}
          <FieldBlock label="label_policy" value={analysis.synthesis.label_policy} />
          <FieldBlock label="decision_rubric" value={analysis.synthesis.decision_rubric} />
          <FieldBlock label="detection_guidance (addendum)" value={analysis.synthesis.detection_guidance} />
        </div>
      )}

      {job.eval_comparisons && job.eval_comparisons.length > 0 && (
        <div className="app-table-wrap overflow-x-auto">
          <div className="app-label mb-2">
            Evaluation vs sources on the disagreement set
            {job.eval_summary ? ` (${job.eval_summary.total} images)` : ""}
          </div>
          <table className="app-table app-table-fixed text-xs">
            <thead>
              <tr>
                <th className="app-table-col-label">Prompt</th>
                <th className="app-table-col-label">Source P/R/F1</th>
                <th className="app-table-col-label">Synthesized P/R/F1</th>
                <th className="app-table-col-label">ΔF1</th>
              </tr>
            </thead>
            <tbody>
              {job.eval_comparisons.map((c) => {
                const dF1 = c.synthesized_metrics.f1 - c.source_metrics.f1;
                const color = dF1 > 0 ? "text-green-400" : dF1 < 0 ? "text-red-400" : "text-[var(--app-text-muted)]";
                return (
                  <tr key={c.prompt_version_id}>
                    <td className="font-medium">{c.label}</td>
                    <td className="tabular-nums">
                      {fmtPct(c.source_metrics.precision)}/{fmtPct(c.source_metrics.recall)}/{fmtPct(c.source_metrics.f1)}
                    </td>
                    <td className="tabular-nums">
                      {fmtPct(c.synthesized_metrics.precision)}/{fmtPct(c.synthesized_metrics.recall)}/{fmtPct(c.synthesized_metrics.f1)}
                    </td>
                    <td className={`tabular-nums ${color}`}>{fmtDeltaPct(dF1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {job.status === "completed" && job.result_prompt_version_id && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={onTrash}
            disabled={busy}
            className="app-btn app-btn-danger app-btn-md text-sm"
          >
            Trash synthesized prompt
          </button>
          <span className="text-xs text-[var(--app-text-muted)]">
            {detectionCode} · saved as new PromptVersion
            {job.result_dataset_id ? " · disagreement dataset created" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, value }: { label: string; value: string }) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--app-text-subtle)] mb-1">{label}</div>
      <pre className="bg-black/20 rounded p-2 text-xs whitespace-pre-wrap break-words text-[var(--app-text)]">{clean}</pre>
    </div>
  );
}
