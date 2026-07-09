"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Prediction } from "@/types";
import type { IterationJob, RoundSummary } from "@/lib/promptIteration/types";
import { toReviewedRows, summarizeReviewedRows } from "@/lib/promptIteration/packaging";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";

interface PromptDetail {
  prompt_version_id: string;
  version_label: string;
  system_prompt: string;
  user_prompt_template: string;
  label_policy: string;
  decision_rubric: string;
  fixed_guidance: string;
  version_notes: string;
  model: string;
}

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing reviewed dataset",
  baseline: "Computing baseline metrics",
  analysis: "Analyzing failure modes",
  generation: "Generating candidate prompt variants",
  evaluation: "Evaluating candidates",
  selection: "Selecting best prompt",
  saving: "Saving prompt version",
  reporting: "Writing final report",
  done: "Done",
};

const ACTIVE_STATUSES = new Set(["queued", "running"]);

const pct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "—" : `${(n * 100).toFixed(1)}%`;

export function PromptIterationPanel({
  runId,
  finalized,
  promptVersionLabel,
  promptVersionId,
  predictions,
  apiKey,
}: {
  runId: string;
  finalized: boolean;
  promptVersionLabel: string;
  promptVersionId?: string;
  predictions: Prediction[];
  apiKey?: string;
}) {
  const { notify } = useAppFeedback();
  const [job, setJob] = useState<IterationJob | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [goalF1, setGoalF1] = useState("");
  const [maxRounds, setMaxRounds] = useState("5");
  const [precisionFloor, setPrecisionFloor] = useState("");
  const [leanPreference, setLeanPreference] = useState("1");
  const [objectiveKind, setObjectiveKind] = useState("f1");
  const [objectivePrecision, setObjectivePrecision] = useState("85");
  const [fixedGuidance, setFixedGuidance] = useState("");
  const [fixedGuidanceLoaded, setFixedGuidanceLoaded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [detailRound, setDetailRound] = useState<RoundSummary | null>(null);
  const [detail, setDetail] = useState<{ prompt: PromptDetail; predictions: Prediction[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trashingId, setTrashingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const summary = useMemo(() => summarizeReviewedRows(toReviewedRows(predictions)), [predictions]);

  const fetchLatest = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/hil/prompt-iteration?run_id=${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job ?? null);
    } catch {
      /* ignore */
    }
  }, [runId]);

  const fetchJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/hil/prompt-iteration?job_id=${encodeURIComponent(jobId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  // Restore any existing job for this run on mount / run change.
  useEffect(() => {
    setJob(null);
    setShowReport(false);
    fetchLatest();
  }, [fetchLatest]);

  // Poll while a job is active.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (job && ACTIVE_STATUSES.has(job.status)) {
      pollRef.current = setInterval(() => fetchJob(job.job_id), 2000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job, fetchJob]);

  // Pre-fill the fixed guidance from the source prompt when the modal opens.
  useEffect(() => {
    if (!showModal || fixedGuidanceLoaded || !promptVersionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hil/prompt-iteration?prompt_version_id=${encodeURIComponent(promptVersionId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.prompt?.fixed_guidance === "string") {
          setFixedGuidance(data.prompt.fixed_guidance);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setFixedGuidanceLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [showModal, fixedGuidanceLoaded, promptVersionId]);

  const startJob = async () => {
    if (!runId || starting) return;
    setStarting(true);
    try {
      const objective = (() => {
        switch (objectiveKind) {
          case "f2":
            return { kind: "fbeta", beta: 2 };
          case "f05":
            return { kind: "fbeta", beta: 0.5 };
          case "recall_at_precision":
            return { kind: "recall_at_precision", precisionFloor: (Number(objectivePrecision) || 80) / 100 };
          case "balanced_accuracy":
            return { kind: "balanced_accuracy" };
          default:
            return { kind: "f1" };
        }
      })();
      const res = await fetch("/api/hil/prompt-iteration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runId,
          goal_f1: goalF1.trim() === "" ? null : goalF1.trim(),
          max_rounds: maxRounds.trim() === "" ? undefined : maxRounds.trim(),
          precision_floor: precisionFloor.trim() === "" ? null : precisionFloor.trim(),
          lean_preference: leanPreference.trim() === "" ? null : leanPreference.trim(),
          fixed_guidance: fixedGuidance,
          objective,
          api_key: apiKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 202) {
        setJob(data.job ?? null);
        setShowModal(false);
        notify({ tone: "success", message: "AI prompt iteration started." });
      } else {
        notify({ tone: "error", message: data?.error || "Failed to start prompt iteration" });
      }
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Failed to start" });
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    try {
      await fetch("/api/hil/prompt-iteration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", job_id: job.job_id }),
      });
      fetchJob(job.job_id);
    } catch {
      /* ignore */
    }
  };

  const openRound = async (round: RoundSummary) => {
    if (!round.prompt_version_id) return;
    setDetailRound(round);
    setDetail(null);
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ prompt_version_id: round.prompt_version_id });
      if (round.run_id) params.set("review_run_id", round.run_id);
      const res = await fetch(`/api/hil/prompt-iteration?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data?.prompt) {
        setDetail({ prompt: data.prompt, predictions: data.predictions || [] });
      } else {
        notify({ tone: "error", message: data?.error || "Failed to load prompt" });
      }
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Failed to load prompt" });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailRound(null);
    setDetail(null);
  };

  const trashRound = async (round: RoundSummary) => {
    if (!job || !round.prompt_version_id) return;
    if (!window.confirm(`Trash prompt "${round.label}"? This permanently deletes the version and its run.`)) return;
    setTrashingId(round.prompt_version_id);
    try {
      const res = await fetch("/api/hil/prompt-iteration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard_round", job_id: job.job_id, prompt_version_id: round.prompt_version_id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.job) {
        setJob(data.job);
        if (detailRound?.prompt_version_id === round.prompt_version_id) closeDetail();
        notify({ tone: "success", message: `Trashed ${round.label}.` });
      } else {
        notify({ tone: "error", message: data?.error || "Failed to trash prompt" });
      }
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Failed to trash prompt" });
    } finally {
      setTrashingId(null);
    }
  };

  const isActive = job != null && ACTIVE_STATUSES.has(job.status);
  const statusBadgeClass =
    job?.status === "completed"
      ? "bg-emerald-500/15 text-emerald-300"
      : job?.status === "failed"
        ? "bg-red-500/15 text-red-300"
        : job?.status === "canceled"
          ? "bg-gray-500/15 text-gray-300"
          : "bg-sky-500/15 text-sky-300";

  return (
    <>
      <div className="app-card p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--app-text)]">AI Prompt Iteration</span>
            {job && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${statusBadgeClass}`}>{job.status}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isActive ? (
              <button onClick={cancelJob} className="app-btn app-btn-danger app-btn-sm text-xs">
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setShowModal(true)}
                disabled={!finalized}
                title={!finalized ? "Finalize the HIL review first" : "Tune the prompt automatically from this review"}
                className="app-btn app-btn-primary app-btn-sm text-xs disabled:opacity-40"
              >
                {job ? "Run Again" : "Run AI Prompt Iteration"}
              </button>
            )}
          </div>
        </div>

        {/* Idle helper */}
        {!job && (
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--app-text-muted)]">
            Automatically tune this prompt from the finalized review — generate candidate prompts, evaluate them on a
            held-out slice, and promote the best safe version across multiple rounds.
            {!finalized && " Finalize the review above to enable."}
          </p>
        )}

        {/* Progress + results */}
        {job && (
          <div className="mt-3 space-y-3">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--app-text-muted)]">
                <span>
                  {job.max_rounds > 1 && job.current_round > 0 ? `Round ${job.current_round}/${job.max_rounds} · ` : ""}
                  {PHASE_LABELS[job.phase || "preparing"] || job.phase}
                </span>
                <span className="tabular-nums">{Math.round(job.progress)}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full transition-all ${job.status === "failed" ? "bg-red-500" : job.status === "completed" ? "bg-emerald-500" : "bg-sky-500"}`}
                  style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                />
              </div>
            </div>

            {/* Live stats */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Candidates generated" value={String(job.candidates_generated)} />
              <Stat label="Candidates evaluated" value={String(job.candidates_evaluated)} />
              <Stat label="Best F1" value={pct(job.best_f1)} />
              <Stat label="Best P / R" value={`${pct(job.best_precision)} / ${pct(job.best_recall)}`} />
            </div>

            {/* Per-round outcomes — each promoted round is its own prompt version + run */}
            {job.rounds.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-[var(--app-border)]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--app-border)] bg-white/[0.02] text-[10px] uppercase tracking-[0.1em] text-[var(--app-text-subtle)]">
                      <th className="px-3 py-2 text-left font-medium">Round</th>
                      <th className="px-3 py-2 text-left font-medium">Version</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">P</th>
                      <th className="px-3 py-2 text-right font-medium">R</th>
                      <th className="px-3 py-2 text-right font-medium">F1</th>
                      <th className="px-3 py-2 text-right font-medium">Parse</th>
                      <th className="px-3 py-2 text-left font-medium">Outcome</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.rounds.map((r) => (
                      <tr
                        key={r.round}
                        onClick={() => r.promoted && r.prompt_version_id && openRound(r)}
                        className={`border-b border-[var(--app-border)] last:border-0 ${r.promoted && r.prompt_version_id ? "cursor-pointer hover:bg-white/[0.03]" : ""} ${r.is_best ? "bg-emerald-500/[0.06]" : ""}`}
                      >
                        <td className="px-3 py-1.5 align-top text-[var(--app-text-muted)]">{r.round}</td>
                        <td className="px-3 py-1.5 align-top">
                          <div className="font-mono text-[var(--app-text)]">{r.promoted ? r.label : "—"}</div>
                          {r.blurb && (
                            <div className="mt-0.5 max-w-[22rem] truncate text-[10px] text-[var(--app-text-subtle)]" title={r.blurb}>
                              {r.blurb}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 align-top text-right tabular-nums text-[var(--app-text-subtle)]">
                          {r.prompt_tokens != null ? `${r.prompt_tokens} tok` : "—"}
                        </td>
                        <td className="px-3 py-1.5 align-top text-right tabular-nums text-[var(--app-text-muted)]">{pct(r.precision)}</td>
                        <td className="px-3 py-1.5 align-top text-right tabular-nums text-[var(--app-text-muted)]">{pct(r.recall)}</td>
                        <td className="px-3 py-1.5 align-top text-right font-medium tabular-nums text-[var(--app-text)]">{pct(r.f1)}</td>
                        <td className={`px-3 py-1.5 align-top text-right tabular-nums ${r.parse_errors > 0 ? "text-red-300" : "text-[var(--app-text-subtle)]"}`}>
                          {r.parse_errors}
                        </td>
                        <td className="px-3 py-1.5 align-top">
                          {!r.promoted ? (
                            <span className="text-[var(--app-text-subtle)]">no promotion</span>
                          ) : r.is_best ? (
                            <span className="font-medium text-emerald-300">★ best</span>
                          ) : (
                            <span className="text-[var(--app-text-muted)]">promoted</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 align-top text-right">
                          {r.promoted && r.prompt_version_id && !isActive && (
                            <button
                              onClick={(e) => { e.stopPropagation(); trashRound(r); }}
                              disabled={trashingId === r.prompt_version_id}
                              title="Delete this prompt version and its run"
                              className="app-btn app-btn-danger app-btn-sm text-[11px] disabled:opacity-40"
                            >
                              {trashingId === r.prompt_version_id ? "…" : "Trash"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {job.error && <p className="text-xs text-red-300">Error: {job.error}</p>}

            {job.status === "completed" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--app-border)] bg-white/[0.02] px-3 py-2">
                <p className="text-xs text-[var(--app-text)]">
                  {job.result_prompt_version_id
                    ? "New prompt version promoted and saved with a full report in Version Notes."
                    : "No candidate safely improved — current prompt kept. Report saved for auditability."}
                </p>
                {job.report && (
                  <button onClick={() => setShowReport((v) => !v)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                    {showReport ? "Hide report" : "View report"}
                  </button>
                )}
              </div>
            )}

            {/* Recent logs */}
            {job.logs.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[11px] text-blue-300 hover:text-blue-200">
                  Activity log ({job.logs.length})
                </summary>
                <div className="mt-1 max-h-40 space-y-0.5 overflow-auto rounded-lg border border-[var(--app-border)] bg-black/20 p-2 text-[11px] text-[var(--app-text-muted)]">
                  {job.logs.slice(-40).map((l, i) => (
                    <div key={i}>
                      <span className="text-[var(--app-text-subtle)]">{new Date(l.ts).toLocaleTimeString()} · </span>
                      {l.message}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {showReport && job.report && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--app-border)] bg-[#09111a]/80 p-3 text-[11px] leading-relaxed text-gray-300">
                {job.report}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="app-card-strong w-full max-w-lg space-y-4 p-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">Run AI Prompt Iteration</h3>
              <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                This starts a long-running, potentially expensive background job that analyzes this review,
                generates candidate prompts, evaluates them on a held-out slice, and promotes the best safe one.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <Stat label="Reviewed rows" value={String(summary.total)} />
              <Stat label="Positives" value={String(summary.positives)} />
              <Stat label="Negatives" value={String(summary.negatives)} />
              <Stat label="False positives" value={String(summary.fp)} />
              <Stat label="False negatives" value={String(summary.fn)} />
              <Stat label="Reviewer fixes" value={String(summary.reviewer_corrections)} />
            </div>

            <div className="rounded-lg border border-[var(--app-border)] bg-white/[0.02] p-3 text-xs">
              <span className="text-[var(--app-text-muted)]">Prompt version being tuned: </span>
              <span className="font-medium text-gray-200">{promptVersionLabel || "current version"}</span>
            </div>

            <div>
              <label className="app-label mb-1 block text-xs">Optimization objective</label>
              <select
                value={objectiveKind}
                onChange={(e) => setObjectiveKind(e.target.value)}
                className="app-input w-full px-3 py-2 text-sm"
              >
                <option value="f1">Balanced (F1)</option>
                <option value="f2">Favor recall (F2) — catch more, tolerate some false positives</option>
                <option value="f05">Favor precision (F0.5) — fewer false positives</option>
                <option value="recall_at_precision">Max recall at a precision floor</option>
                <option value="balanced_accuracy">Balanced accuracy (equal weight to both classes)</option>
              </select>
              <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                Candidates are ranked, gated, and confidence-tested on this objective — not just F1. For recall-limited detections, F2 or “max recall at a precision floor” usually wins.
              </p>
              {objectiveKind === "recall_at_precision" && (
                <div className="mt-2">
                  <label className="app-label mb-1 block text-xs">Precision floor (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={objectivePrecision}
                    onChange={(e) => setObjectivePrecision(e.target.value)}
                    placeholder="e.g. 85"
                    className="app-input w-full px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                    Maximize recall while keeping precision at or above this floor.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="app-label mb-1 block text-xs">Goal F1 (optional)</label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={goalF1}
                onChange={(e) => setGoalF1(e.target.value)}
                placeholder="e.g. 0.85 — stop early once a round reaches this F1"
                className="app-input w-full px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                The best safe candidate is always saved; the goal ends the loop early once reached.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="app-label mb-1 block text-xs">Max rounds (1–10)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(e.target.value)}
                  className="app-input w-full px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                  Each round learns from the last; stops early if a round can&apos;t safely improve.
                </p>
              </div>
              <div>
                <label className="app-label mb-1 block text-xs">Precision floor (optional)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={precisionFloor}
                  onChange={(e) => setPrecisionFloor(e.target.value)}
                  placeholder="e.g. 0.85"
                  className="app-input w-full px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                  Accept candidates down to this precision (lets you trade precision for recall).
                </p>
              </div>
            </div>

            <div>
              <label className="app-label mb-1 block text-xs">Lean preference: max F1 % to trade for a shorter prompt</label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.5"
                value={leanPreference}
                onChange={(e) => setLeanPreference(e.target.value)}
                placeholder="e.g. 1 = accept a leaner prompt up to 1% lower F1"
                className="app-input w-full px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                Higher = leaner prompts win over a larger F1 gap. 0 = always pick the highest F1. Default 1%.
              </p>
            </div>

            <div>
              <label className="app-label mb-1 block text-xs">
                Fixed guidance <span className="text-[var(--app-text-subtle)]">(always applied every round — never rewritten by the AI)</span>
              </label>
              <textarea
                value={fixedGuidance}
                onChange={(e) => setFixedGuidance(e.target.value)}
                rows={6}
                placeholder="e.g. the Severity 0–4 scale and shared detection-spec guidelines the AI must keep intact."
                className="app-input w-full px-3 py-2 font-mono text-[11px] leading-relaxed"
              />
              <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                Pre-filled from the current prompt. Every tuned round keeps this block verbatim; edits here apply to this run only.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                Cancel
              </button>
              <button
                onClick={startJob}
                disabled={starting || summary.labeled === 0}
                className="app-btn app-btn-primary app-btn-sm text-xs disabled:opacity-40"
              >
                {starting ? "Starting…" : "Start Iteration"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt detail / review modal */}
      {detailRound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeDetail}>
          <div
            className="app-card-strong flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--app-border)] p-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-mono text-base font-semibold text-gray-100">{detailRound.label}</h3>
                  {detailRound.is_best && <span className="text-xs font-medium text-emerald-300">★ best</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--app-text-muted)]">
                  <span>Round {detailRound.round}</span>
                  <span>F1 {pct(detailRound.f1)}</span>
                  <span>P {pct(detailRound.precision)}</span>
                  <span>R {pct(detailRound.recall)}</span>
                  <span className={detailRound.parse_errors > 0 ? "text-red-300" : ""}>
                    Parse errors {detailRound.parse_errors}
                  </span>
                  {detailRound.prompt_tokens != null && <span>~{detailRound.prompt_tokens} tokens</span>}
                </div>
                {detailRound.blurb && (
                  <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--app-text)]">{detailRound.blurb}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isActive && (
                  <button
                    onClick={() => trashRound(detailRound)}
                    disabled={trashingId === detailRound.prompt_version_id}
                    className="app-btn app-btn-danger app-btn-sm text-xs disabled:opacity-40"
                  >
                    {trashingId === detailRound.prompt_version_id ? "Trashing…" : "Trash"}
                  </button>
                )}
                <button onClick={closeDetail} className="app-btn app-btn-subtle app-btn-sm text-xs">
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-4">
              {detailLoading && <p className="text-xs text-[var(--app-text-muted)]">Loading prompt…</p>}
              {detail && (
                <>
                  <PromptSection title="System Prompt" body={detail.prompt.system_prompt} />
                  <PromptSection title="Fixed Guidance (always applied, not tuned)" body={detail.prompt.fixed_guidance} />
                  <PromptSection title="Label Policy" body={detail.prompt.label_policy} />
                  <PromptSection title="Decision Rubric" body={detail.prompt.decision_rubric} />
                  <PromptSection title="User Prompt Template" body={detail.prompt.user_prompt_template} />

                  <ReviewRows
                    title="False Positives"
                    tone="text-amber-300"
                    rows={detail.predictions.filter((p) => {
                      const gt = p.corrected_label || p.ground_truth_label;
                      return p.parse_ok && p.predicted_decision === "DETECTED" && gt === "NOT_DETECTED";
                    })}
                  />
                  <ReviewRows
                    title="False Negatives"
                    tone="text-sky-300"
                    rows={detail.predictions.filter((p) => {
                      const gt = p.corrected_label || p.ground_truth_label;
                      return p.parse_ok && p.predicted_decision === "NOT_DETECTED" && gt === "DETECTED";
                    })}
                  />
                  <ReviewRows
                    title="Parse Errors"
                    tone="text-red-300"
                    rows={detail.predictions.filter((p) => !p.parse_ok)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PromptSection({ title, body }: { title: string; body: string }) {
  const text = (body || "").trim();
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-[var(--app-text-subtle)]">{title}</div>
      {text ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--app-border)] bg-black/20 p-2.5 text-[11px] leading-relaxed text-gray-300">
          {text}
        </pre>
      ) : (
        <p className="text-[11px] italic text-[var(--app-text-subtle)]">(empty)</p>
      )}
    </div>
  );
}

function ReviewRows({ title, tone, rows }: { title: string; tone: string; rows: Prediction[] }) {
  return (
    <div>
      <div className={`mb-1 text-[10px] font-medium uppercase tracking-[0.12em] ${tone}`}>
        {title} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] italic text-[var(--app-text-subtle)]">None on the held-out slice.</p>
      ) : (
        <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-[var(--app-border)] bg-white/[0.02] p-2">
          {rows.map((p) => (
            <div key={p.prediction_id} className="flex items-start gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-[var(--app-text-muted)]">{p.image_id}</span>
              <span className="text-[var(--app-text-subtle)]">
                {p.parse_ok ? p.evidence || "—" : p.parse_error_reason || "parse failure"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--app-border)] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--app-text-subtle)]">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-gray-100">{value}</div>
    </div>
  );
}
