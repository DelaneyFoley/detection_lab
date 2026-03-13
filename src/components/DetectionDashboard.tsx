"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { DecisionBadge } from "@/components/shared/DecisionBadge";
import type { Detection, Run, PromptVersion, Dataset, MetricsSummary } from "@/types";
import { splitTypeBadgeClass, splitTypeLabel } from "@/lib/splitType";

export function DetectionDashboard({ detections: initialDetections }: { detections: Detection[] }) {
  const { refreshCounter } = useAppStore();
  const { notify, confirm } = useAppFeedback();
  const [detections, setDetections] = useState<Detection[]>(initialDetections);
  const [detectionData, setDetectionData] = useState<
    Map<string, { prompts: PromptVersion[]; datasets: Dataset[]; runs: Run[] }>
  >(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<
    Map<string, { predictions: any[]; prompt_feedback_log?: any }>
  >(new Map());
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{ runId: string; imageIds: string[]; activeIndex: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const activePreviewPrediction =
    previewState && runDetails.get(previewState.runId)?.predictions
      ? runDetails.get(previewState.runId)?.predictions
          .find((p: any) => String(p.image_id || "") === previewState.imageIds[previewState.activeIndex]) || null
      : null;

  useEffect(() => {
    setDetections(initialDetections);
  }, [initialDetections]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    const map = new Map<string, { prompts: PromptVersion[]; datasets: Dataset[]; runs: Run[] }>();

    await Promise.all(
      detections.map(async (d) => {
        const [promptsRes, datasetsRes, runsRes] = await Promise.all([
          fetch(`/api/prompts?detection_id=${d.detection_id}`),
          fetch(`/api/datasets?detection_id=${d.detection_id}`),
          fetch(`/api/runs?detection_id=${d.detection_id}`),
        ]);
        map.set(d.detection_id, {
          prompts: await promptsRes.json(),
          datasets: await datasetsRes.json(),
          runs: (await runsRes.json()).filter((r: Run) => r.status === "completed"),
        });
      })
    );

    setDetectionData(map);
    setLoading(false);
  }, [detections]);

  const toggleRunDetails = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (runDetails.has(runId)) return;

    setLoadingRunId(runId);
    try {
      const res = await fetch(`/api/runs?run_id=${runId}`);
      const data = await res.json();
      const preds = Array.isArray(data?.predictions) ? data.predictions : [];
      setRunDetails((prev) => {
        const next = new Map(prev);
        next.set(runId, { predictions: preds, prompt_feedback_log: data?.prompt_feedback_log || {} });
        return next;
      });
    } finally {
      setLoadingRunId(null);
    }
  };

  useEffect(() => {
    if (detections.length > 0) loadAllData();
    else setLoading(false);
  }, [detections, loadAllData, refreshCounter]);

  useEffect(() => {
    if (!previewState) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewState(null);
        return;
      }
      if (previewState.imageIds.length === 0) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setPreviewState((prev) => {
          if (!prev) return prev;
          return { ...prev, activeIndex: Math.max(0, prev.activeIndex - 1) };
        });
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setPreviewState((prev) => {
          if (!prev) return prev;
          return { ...prev, activeIndex: Math.min(prev.imageIds.length - 1, prev.activeIndex + 1) };
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewState]);

  const deleteDetection = async (detectionId: string, displayName: string) => {
    if (
      !(await confirm({
        title: "Delete Detection",
        message: `Delete detection "${displayName}" and all related prompts, runs, and datasets? This cannot be undone.`,
        confirmLabel: "Delete Detection",
        tone: "danger",
      }))
    ) {
      return;
    }
    const res = await fetch("/api/detections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detection_id: detectionId }),
    });
    if (!res.ok) {
      const text = await res.text();
      notify({ message: `Failed to delete detection: ${text}`, tone: "error" });
      return;
    }

    setExpandedId((prev) => (prev === detectionId ? null : prev));
    const refreshed = await fetch("/api/detections");
    const rows = await refreshed.json();
    setDetections(Array.isArray(rows) ? rows : []);
  };

  const fetchDatasetDescriptionByImageId = async (datasetId: string) => {
    const res = await fetch(`/api/datasets?dataset_id=${datasetId}`);
    const payload = await res.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const map = new Map<string, string>();
    for (const item of items) {
      if (!item?.image_id) continue;
      map.set(String(item.image_id), String(item.image_description || ""));
    }
    return map;
  };

  const exportRunLogCsv = async (
    detection: Detection,
    run: Run,
    predictions: any[]
  ) => {
    const descByImageId = await fetchDatasetDescriptionByImageId(run.dataset_id);
    const metrics = (run.metrics_summary || {}) as MetricsSummary;
    const headers = [
      "run_id",
      "detection_code",
      "detection_name",
      "prompt_version_id",
      "model_used",
      "dataset_id",
      "split_type",
      "run_created_at",
      "metric_accuracy",
      "metric_precision",
      "metric_recall",
      "metric_f1",
      "metric_prevalence",
      "metric_parse_failure_rate",
      "image_id",
      "image_uri",
      "dataset_image_description",
      "ground_truth_label",
      "predicted_decision",
      "confidence",
      "ai_evidence",
      "parse_ok",
      "parse_error_reason",
      "parse_fix_suggestion",
      "inference_runtime_ms",
      "parse_retry_count",
      "error_tag",
      "reviewer_note",
      "corrected_label",
      "corrected_at",
    ];
    const rows = predictions.map((p) => [
      run.run_id,
      detection.detection_code,
      detection.display_name,
      run.prompt_version_id,
      run.model_used || "",
      run.dataset_id,
      run.split_type,
      run.created_at,
      metrics.accuracy ?? "",
      metrics.precision ?? "",
      metrics.recall ?? "",
      metrics.f1 ?? "",
      metrics.prevalence ?? "",
      metrics.parse_failure_rate ?? "",
      p.image_id ?? "",
      p.image_uri ?? "",
      descByImageId.get(String(p.image_id || "")) || "",
      p.ground_truth_label ?? "",
      p.predicted_decision ?? "PARSE_FAIL",
      p.confidence ?? "",
      p.evidence ?? "",
      p.parse_ok ?? "",
      p.parse_error_reason ?? "",
      p.parse_fix_suggestion ?? "",
      p.inference_runtime_ms ?? "",
      p.parse_retry_count ?? "",
      p.error_tag ?? "",
      p.reviewer_note ?? "",
      p.corrected_label ?? "",
      p.corrected_at ?? "",
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-log-${run.run_id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportRunLogJson = async (
    detection: Detection,
    run: Run,
    predictions: any[]
  ) => {
    const descByImageId = await fetchDatasetDescriptionByImageId(run.dataset_id);
    const enriched = predictions.map((p) => ({
      ...p,
      dataset_image_description: descByImageId.get(String(p.image_id || "")) || "",
    }));
    const payload = {
      run: {
        run_id: run.run_id,
        detection_id: run.detection_id,
        detection_code: detection.detection_code,
        detection_name: detection.display_name,
        prompt_version_id: run.prompt_version_id,
        model_used: run.model_used || "",
        dataset_id: run.dataset_id,
        split_type: run.split_type,
        created_at: run.created_at,
        metrics_summary: run.metrics_summary,
      },
      predictions: enriched,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-log-${run.run_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto py-12 text-center text-gray-500">
        <p className="text-sm">Loading detection data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Detection Dashboard</h2>
          <p className="app-page-copy">
            Review saved detections, latest approved performance, and detailed run history across prompts,
            datasets, and reviewer feedback.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total Detections"
          value={detections.length.toString()}
          color="text-white"
        />
        <SummaryCard
          label="With Approved Prompts"
          value={detections.filter((d) => d.approved_prompt_version).length.toString()}
          color="text-green-400"
        />
        <SummaryCard
          label="Total Runs"
          value={Array.from(detectionData.values())
            .reduce((acc, d) => acc + d.runs.length, 0)
            .toString()}
          color="text-blue-400"
        />
        <SummaryCard
          label="Total Datasets"
          value={Array.from(detectionData.values())
            .reduce((acc, d) => acc + d.datasets.length, 0)
            .toString()}
          color="text-purple-400"
        />
      </div>

      {/* Detection List */}
      <div className="space-y-3">
        {detections.map((d) => {
          const data = detectionData.get(d.detection_id);
          const approvedPrompt = data?.prompts.find(
            (p) => p.prompt_version_id === d.approved_prompt_version
          );
          const primaryMetric = d.metric_thresholds?.primary_metric || "f1";
          const approvedRuns = (data?.runs || []).filter((r: any) => r.prompt_version_id === d.approved_prompt_version);
          const candidateRuns = d.approved_prompt_version ? approvedRuns : data?.runs || [];
          const bestRun =
            [...candidateRuns].sort((left: any, right: any) => {
              const leftScore = Number(left?.metrics_summary?.[primaryMetric] ?? -1);
              const rightScore = Number(right?.metrics_summary?.[primaryMetric] ?? -1);
              if (rightScore !== leftScore) return rightScore - leftScore;
              return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            })[0] || null;
          const bestMetrics: MetricsSummary | null = bestRun?.metrics_summary || null;
          const isExpanded = expandedId === d.detection_id;

          return (
            <div
              key={d.detection_id}
              className="app-card-strong overflow-hidden"
            >
              {/* Detection Header Row */}
              <div
                className="cursor-pointer px-5 py-4 transition-colors hover:bg-white/5"
                onClick={() => setExpandedId(isExpanded ? null : d.detection_id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    {/* Expand arrow */}
                    <svg
                      className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-200 truncate">{d.display_name}</h3>
                        <code className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs text-gray-400">
                          {d.detection_code}
                        </code>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5" title={d.description}>
                        {d.description}
                      </p>
                    </div>
                  </div>

                  {/* Status indicators */}
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    {/* Approved status */}
                    {d.approved_prompt_version ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                        Approved: {approvedPrompt?.version_label || "?"}
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-gray-400">
                        No approved prompt
                      </span>
                    )}

                    {/* Quick metrics from best run */}
                    {bestMetrics && (
                      <div className="flex items-center gap-3 text-xs">
                        <span>
                          P:{" "}
                          <b className="text-[var(--app-text)]">
                            {(bestMetrics.precision * 100).toFixed(1)}%
                          </b>
                        </span>
                        <span>
                          R:{" "}
                          <b className="text-[var(--app-text)]">
                            {(bestMetrics.recall * 100).toFixed(1)}%
                          </b>
                        </span>
                        <span>
                          F1:{" "}
                          <b className="text-[var(--app-text)]">
                            {(bestMetrics.f1 * 100).toFixed(1)}%
                          </b>
                        </span>
                      </div>
                    )}
                    {!bestMetrics && (
                      <span className="text-xs text-gray-600">No runs yet</span>
                    )}

                    {/* Counts */}
                    <div className="flex gap-2 text-xs text-gray-500">
                      <span>{data?.prompts.length || 0} prompts</span>
                      <span className="text-gray-700">|</span>
                      <span>{data?.datasets.length || 0} datasets</span>
                      <span className="text-gray-700">|</span>
                      <span>{data?.runs.length || 0} runs</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDetection(d.detection_id, d.display_name);
                      }}
                      className="app-btn app-btn-danger px-3 py-1.5 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && data && (
                <div className="space-y-5 border-t border-white/10 bg-black/10 px-5 py-5">
                  {/* Thresholds */}
                  <div className="app-card p-4">
                    <h4 className="app-label mb-2">Metric Thresholds</h4>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="text-gray-400">
                        Primary: <b className="text-gray-200">{d.metric_thresholds.primary_metric}</b>
                      </span>
                      {d.metric_thresholds.min_precision != null && (
                        <ThresholdPill
                          label="Precision"
                          threshold={d.metric_thresholds.min_precision}
                          actual={bestMetrics?.precision}
                        />
                      )}
                      {d.metric_thresholds.min_recall != null && (
                        <ThresholdPill
                          label="Recall"
                          threshold={d.metric_thresholds.min_recall}
                          actual={bestMetrics?.recall}
                        />
                      )}
                      {d.metric_thresholds.min_f1 != null && (
                        <ThresholdPill
                          label="F1"
                          threshold={d.metric_thresholds.min_f1}
                          actual={bestMetrics?.f1}
                        />
                      )}
                    </div>
                  </div>

                  {/* Run Log */}
                  <div>
                    <h4 className="app-label mb-2">
                      Run Log ({data.runs.length})
                    </h4>
                    <div className="app-table-wrap overflow-x-auto">
                      <table className="app-table app-table-fixed text-xs">
                        <colgroup>
                          <col style={{ width: "7rem" }} />
                          <col style={{ width: "10rem" }} />
                          <col style={{ width: "9rem" }} />
                          <col style={{ width: "7rem" }} />
                          <col style={{ width: "6.5rem" }} />
                          <col style={{ width: "6.5rem" }} />
                          <col style={{ width: "6.5rem" }} />
                          <col style={{ width: "6rem" }} />
                          <col style={{ width: "7rem" }} />
                          <col style={{ width: "7rem" }} />
                          <col style={{ width: "5.5rem" }} />
                          <col style={{ width: "11rem" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="app-table-col-label">Run</th>
                            <th className="app-table-col-label">Prompt</th>
                            <th className="app-table-col-label">Model Used</th>
                            <th className="app-table-col-center">Split</th>
                            <th className="app-table-col-label">Accuracy</th>
                            <th className="app-table-col-label">Precision</th>
                            <th className="app-table-col-label">Recall</th>
                            <th className="app-table-col-label">F1</th>
                            <th className="app-table-col-label">Prevalence</th>
                            <th className="app-table-col-label">Parse Fail</th>
                            <th className="app-table-col-label">Images</th>
                            <th className="app-table-col-label">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.runs.slice(0, 20).map((r: any) => {
                            const m = r.metrics_summary as MetricsSummary;
                            const prompt = data.prompts.find(
                              (p) => p.prompt_version_id === r.prompt_version_id
                            );
                            const dataset = data.datasets.find((ds) => ds.dataset_id === r.dataset_id);
                            const details = runDetails.get(r.run_id);
                            const feedback = details?.prompt_feedback_log || r.prompt_feedback_log || {};
                            const accepted = Array.isArray(feedback.accepted) ? feedback.accepted : [];
                            const rejected = Array.isArray(feedback.rejected) ? feedback.rejected : [];
                            return (
                              <Fragment key={r.run_id}>
                                <tr>
                                  <td className="font-mono text-gray-400">
                                    <button
                                      onClick={() => toggleRunDetails(r.run_id)}
                                      className="text-left hover:text-blue-300"
                                    >
                                      {expandedRunId === r.run_id ? "▼ " : "▶ "}
                                      {r.run_id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td>
                                    <span className="text-gray-300">{prompt?.version_label || "?"}</span>
                                  </td>
                                  <td className="text-gray-400">
                                    {r.model_used || "—"}
                                  </td>
                                  <td className="app-table-col-center">
                                    <div className="app-table-center-slot">
                                      <span className={splitTypeBadgeClass(r.split_type)}>
                                        {splitTypeLabel(r.split_type)}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums text-gray-300">
                                    <div className="app-table-left-slot">
                                      <span>{(m.accuracy * 100).toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums text-white">
                                    <div className="app-table-left-slot">
                                      <span>{(m.precision * 100).toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums text-white">
                                    <div className="app-table-left-slot">
                                      <span>{(m.recall * 100).toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums font-medium text-white">
                                    <div className="app-table-left-slot">
                                      <span>{(m.f1 * 100).toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums text-white">
                                    <div className="app-table-left-slot">
                                      <span>{(m.prevalence * 100).toFixed(1)}%</span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums">
                                    <div className="app-table-left-slot">
                                      <span className={m.parse_failure_rate > 0 ? "text-[var(--app-danger)]" : "text-gray-500"}>
                                        {(m.parse_failure_rate * 100).toFixed(1)}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="app-table-col-label tabular-nums text-gray-400">
                                    <div className="app-table-left-slot">
                                      <span>{m.total}</span>
                                    </div>
                                  </td>
                                  <td className="text-gray-500">
                                    {new Date(r.created_at).toLocaleString()}
                                  </td>
                                </tr>
                                {expandedRunId === r.run_id && (
                                  <tr className="border-b border-gray-800/50 bg-gray-900/30">
                                    <td colSpan={12} className="px-3 py-3">
                                      {loadingRunId === r.run_id && (
                                        <p className="text-xs text-gray-500">Loading run items...</p>
                                      )}
                                      {loadingRunId !== r.run_id && (
                                        <div className="space-y-3">
                                          <div className="text-[11px] text-gray-500">
                                            Dataset used for this run:{" "}
                                            <span className="text-gray-300">
                                              {dataset?.name || r.dataset_id} ({splitTypeLabel(r.split_type)})
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => exportRunLogCsv(d, r, details?.predictions || [])}
                                              className="app-btn app-btn-secondary px-2.5 py-1 text-[11px]"
                                            >
                                              Export Run Log CSV
                                            </button>
                                            <button
                                              onClick={() => exportRunLogJson(d, r, details?.predictions || [])}
                                              className="app-btn app-btn-secondary px-2.5 py-1 text-[11px]"
                                            >
                                              Export Run Log JSON
                                            </button>
                                          </div>
                                          {(accepted.length > 0 || rejected.length > 0) && (
                                            <div className="app-card p-2">
                                              <div className="text-[11px] text-gray-500 mb-1">
                                                Prompt feedback log
                                              </div>
                                              <div className="text-xs text-gray-300">
                                                Accepted: <span className="text-green-400">{accepted.length}</span>
                                                {" · "}
                                                Rejected: <span className="text-gray-400">{rejected.length}</span>
                                                {feedback.created_prompt_version_id ? (
                                                  <>
                                                    {" · "}Created Version:{" "}
                                                    <span className="text-blue-300">{feedback.created_prompt_version_id.slice(0, 8)}</span>
                                                  </>
                                                ) : null}
                                              </div>
                                              <details className="mt-2">
                                                <summary className="cursor-pointer text-[11px] text-blue-300 hover:text-blue-200">
                                                  View accepted/rejected suggestions
                                                </summary>
                                                <div className="mt-2 grid grid-cols-2 gap-3">
                                                  <div>
                                                    <div className="text-[11px] text-green-400 mb-1">Accepted ({accepted.length})</div>
                                                    <div className="space-y-1 max-h-36 overflow-auto">
                                                      {accepted.map((s: any, idx: number) => (
                                                        <div key={`a_${idx}`} className="rounded-xl bg-black/20 px-2 py-1 text-[11px] text-gray-300">
                                                          <div className="text-gray-500">{s.section}</div>
                                                          <div className="truncate" title={s.rationale || ""}>{s.rationale || "—"}</div>
                                                        </div>
                                                      ))}
                                                      {accepted.length === 0 && (
                                                        <div className="text-[11px] text-gray-500">None</div>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <div>
                                                    <div className="text-[11px] text-gray-400 mb-1">Rejected ({rejected.length})</div>
                                                    <div className="space-y-1 max-h-36 overflow-auto">
                                                      {rejected.map((s: any, idx: number) => (
                                                        <div key={`r_${idx}`} className="rounded-xl bg-black/20 px-2 py-1 text-[11px] text-gray-300">
                                                          <div className="text-gray-500">{s.section}</div>
                                                          <div className="truncate" title={s.rationale || ""}>{s.rationale || "—"}</div>
                                                        </div>
                                                      ))}
                                                      {rejected.length === 0 && (
                                                        <div className="text-[11px] text-gray-500">None</div>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              </details>
                                            </div>
                                          )}
                                        {Object.keys((m.segment_metrics || {}) as Record<string, any>).length > 0 && (
                                          <details className="app-card p-2">
                                            <summary className="cursor-pointer text-[11px] text-blue-300 hover:text-blue-200">
                                              Attribute Breakdown
                                            </summary>
                                            <div className="mt-2 app-table-wrap overflow-x-auto">
                                              <table className="app-table app-table-fixed text-[11px]">
                                                <colgroup>
                                                  <col style={{ width: "10rem" }} />
                                                  <col style={{ width: "5rem" }} />
                                                  <col style={{ width: "6.5rem" }} />
                                                  <col style={{ width: "6.5rem" }} />
                                                  <col style={{ width: "6.5rem" }} />
                                                  <col style={{ width: "6.5rem" }} />
                                                </colgroup>
                                                <thead>
                                                  <tr>
                                                    <th className="app-table-col-label">Attribute</th>
                                                    <th className="app-table-col-center">Total</th>
                                                    <th className="app-table-col-center">Accuracy</th>
                                                    <th className="app-table-col-center">Precision</th>
                                                    <th className="app-table-col-center">Recall</th>
                                                    <th className="app-table-col-center">F1</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {Object.entries((m.segment_metrics || {}) as Record<string, any>)
                                                    .sort(([, a], [, b]) => Number(b?.total || 0) - Number(a?.total || 0))
                                                    .map(([segment, metric]) => (
                                                      <tr key={segment}>
                                                        <td className="text-gray-300">{segment}</td>
                                                        <td className="app-table-col-center text-gray-400">{metric.total ?? 0}</td>
                                                        <td className="app-table-col-center text-gray-300">{((metric.accuracy || 0) * 100).toFixed(1)}%</td>
                                                        <td className="app-table-col-center text-white">{((metric.precision || 0) * 100).toFixed(1)}%</td>
                                                        <td className="app-table-col-center text-white">{((metric.recall || 0) * 100).toFixed(1)}%</td>
                                                        <td className="app-table-col-center text-white">{((metric.f1 || 0) * 100).toFixed(1)}%</td>
                                                      </tr>
                                                    ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </details>
                                        )}
                                        <div className="app-table-wrap max-h-72 overflow-auto">
                                          <table className="app-table app-table-fixed text-xs">
                                            <colgroup>
                                              <col style={{ width: "7rem" }} />
                                              <col style={{ width: "10rem" }} />
                                              <col style={{ width: "9rem" }} />
                                              <col style={{ width: "6.5rem" }} />
                                              <col style={{ width: "7rem" }} />
                                              <col style={{ width: "18rem" }} />
                                              <col style={{ width: "10rem" }} />
                                              <col style={{ width: "14rem" }} />
                                              <col style={{ width: "14rem" }} />
                                              <col style={{ width: "10rem" }} />
                                              <col style={{ width: "14rem" }} />
                                            </colgroup>
                                            <thead className="sticky top-0">
                                              <tr>
                                                <th className="app-table-col-label">Preview</th>
                                                <th className="app-table-col-label">Image</th>
                                                <th className="app-table-col-center">AI Label</th>
                                                <th className="app-table-col-center">Confidence</th>
                                                <th className="app-table-col-center">Runtime (ms)</th>
                                                <th className="app-table-col-label">AI Description</th>
                                                <th className="app-table-col-center">Ground Truth (run snapshot)</th>
                                                <th className="app-table-col-label">Parse Reason</th>
                                                <th className="app-table-col-label">Fix Suggestion</th>
                                                <th className="app-table-col-label">Error Tag</th>
                                                <th className="app-table-col-label">Reviewer Note</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {(details?.predictions || []).map((p: any) => (
                                                <tr
                                                  key={p.prediction_id}
                                                  className={`${
                                                    p.ground_truth_label &&
                                                    p.predicted_decision &&
                                                    p.predicted_decision !== p.ground_truth_label
                                                      ? "app-table-row-alert"
                                                      : ""
                                                  }`}
                                                >
                                                  <td>
                                                    <img
                                                      src={p.image_uri}
                                                      alt={p.image_id}
                                                      className="w-12 h-9 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                                                      onClick={() => {
                                                        const imageIds = (details?.predictions || [])
                                                          .filter((row: any) => !!row?.image_uri)
                                                          .map((row: any) => String(row.image_id || ""));
                                                        const activeIndex = imageIds.findIndex((id: string) => id === String(p.image_id || ""));
                                                        if (imageIds.length === 0) return;
                                                        setPreviewState({
                                                          runId: r.run_id,
                                                          imageIds,
                                                          activeIndex: Math.max(0, activeIndex),
                                                        });
                                                      }}
                                                    />
                                                  </td>
                                                  <td className="font-mono text-gray-300">{p.image_id}</td>
                                                  <td className="app-table-col-center text-gray-300">
                                                    <div className="app-table-center-slot">
                                                      <DecisionBadge decision={p.predicted_decision || "PARSE_FAIL"} />
                                                    </div>
                                                  </td>
                                                  <td className="app-table-col-center text-gray-300">
                                                    <div className="app-table-center-slot">
                                                      <span>{p.confidence != null ? Number(p.confidence).toFixed(2) : "—"}</span>
                                                    </div>
                                                  </td>
                                                  <td className="app-table-col-center text-gray-300">
                                                    <div className="app-table-center-slot">
                                                      <span>{p.inference_runtime_ms != null ? Number(p.inference_runtime_ms) : "—"}</span>
                                                    </div>
                                                  </td>
                                                  <td className="text-gray-400 max-w-[420px] truncate" title={p.evidence || ""}>
                                                    {p.evidence || "—"}
                                                  </td>
                                                  <td className="app-table-col-center text-gray-300">
                                                    <div className="app-table-center-slot">
                                                      {p.ground_truth_label ? (
                                                        <DecisionBadge decision={p.ground_truth_label} />
                                                      ) : (
                                                        <span>UNSET</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="text-gray-300 max-w-[280px] truncate" title={p.parse_error_reason || ""}>
                                                    {!p.parse_ok ? p.parse_error_reason || "Parse failed" : "—"}
                                                  </td>
                                                  <td className="text-gray-400 max-w-[320px] truncate" title={p.parse_fix_suggestion || ""}>
                                                    {!p.parse_ok ? p.parse_fix_suggestion || "Return strict JSON only." : "—"}
                                                  </td>
                                                  <td className="text-gray-300">
                                                    {p.error_tag || "—"}
                                                  </td>
                                                  <td className="text-gray-400 max-w-[300px] truncate" title={p.reviewer_note || ""}>
                                                    {p.reviewer_note || "—"}
                                                  </td>
                                                </tr>
                                              ))}
                                              {(details?.predictions || []).length === 0 && (
                                                <tr>
                                                  <td colSpan={11} className="px-2 py-4 text-center text-gray-500">
                                                    No prediction rows.
                                                  </td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {data.runs.length === 0 && (
                      <p className="text-xs text-gray-600 text-center py-4">No completed runs</p>
                    )}
                  </div>

                  {/* Prompt Versions */}
                  <div>
                    <h4 className="text-xs text-gray-500 font-medium mb-2">
                      Prompt Versions ({data.prompts.length})
                    </h4>
                    <div className="space-y-1.5">
                      {data.prompts.map((p) => (
                        <div
                          key={p.prompt_version_id}
                          className={`flex items-center justify-between px-3 py-2 rounded border text-xs ${
                            p.prompt_version_id === d.approved_prompt_version
                              ? "border-green-800/50 bg-green-900/10"
                              : "border-gray-700 bg-gray-900/20"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-gray-300">{p.version_label}</span>
                            <span className="text-gray-500">{p.model} | temp={p.temperature}</span>
                            {p.prompt_version_id === d.approved_prompt_version && (
                              <span className="text-green-400 font-medium">APPROVED</span>
                            )}
                            {p.golden_set_regression_result && (
                              <span
                                className={
                                  p.golden_set_regression_result.passed ? "text-green-400" : "text-red-400"
                                }
                              >
                                Reg: {p.golden_set_regression_result.passed ? "PASS" : "FAIL"}
                              </span>
                            )}
                          </div>
                          <span className="text-gray-500">
                            {p.created_by} — {new Date(p.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detections.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">No detections found. Create one in the Detection Setup tab.</p>
        </div>
      )}

      {previewState && activePreviewPrediction && (
        <div
          className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start justify-center p-6"
          onClick={() => setPreviewState(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[calc(100vh-3rem)] bg-gray-900 border border-gray-700 rounded-lg p-4 grid gap-4 overflow-hidden my-auto"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center">
              <img
                src={activePreviewPrediction.image_uri}
                alt={activePreviewPrediction.image_id}
                className="max-h-[72vh] max-w-full rounded-lg border border-gray-700"
              />
            </div>
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="text-xs text-gray-500">
                {previewState.activeIndex + 1} / {previewState.imageIds.length} (Use arrow keys to navigate)
              </div>
              <div className="flex justify-between gap-2">
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
                  onClick={() =>
                    setPreviewState((prev) => (prev ? { ...prev, activeIndex: Math.max(0, prev.activeIndex - 1) } : prev))
                  }
                  disabled={previewState.activeIndex <= 0}
                >
                  Prev
                </button>
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-40"
                  onClick={() =>
                    setPreviewState((prev) =>
                      prev ? { ...prev, activeIndex: Math.min(prev.imageIds.length - 1, prev.activeIndex + 1) } : prev
                    )
                  }
                  disabled={previewState.activeIndex >= previewState.imageIds.length - 1}
                >
                  Next
                </button>
              </div>
              <div className="text-xs text-gray-500 font-mono">{activePreviewPrediction.image_id}</div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">AI Label</label>
                <div>
                  <DecisionBadge decision={activePreviewPrediction.predicted_decision || "PARSE_FAIL"} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Confidence</label>
                <div className="text-sm text-gray-300">
                  {activePreviewPrediction.confidence != null ? Number(activePreviewPrediction.confidence).toFixed(2) : "—"}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Runtime</label>
                <div className="text-sm text-gray-300">
                  {activePreviewPrediction.inference_runtime_ms != null
                    ? `${Number(activePreviewPrediction.inference_runtime_ms)} ms`
                    : "—"}
                  {activePreviewPrediction.parse_retry_count != null
                    ? ` (retries: ${Number(activePreviewPrediction.parse_retry_count)})`
                    : ""}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">AI Description</label>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{activePreviewPrediction.evidence || "—"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ground Truth (run snapshot)</label>
                <div>
                  {activePreviewPrediction.ground_truth_label ? (
                    <DecisionBadge decision={activePreviewPrediction.ground_truth_label} />
                  ) : (
                    <span className="text-sm text-gray-300">UNSET</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Error Tag</label>
                <div className="text-sm text-gray-300">{activePreviewPrediction.error_tag || "—"}</div>
              </div>
              {!activePreviewPrediction.parse_ok && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Parse Reason</label>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {activePreviewPrediction.parse_error_reason || "Response did not match expected schema."}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">How to Fix</label>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {activePreviewPrediction.parse_fix_suggestion || "Return strict JSON only with required keys."}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Reviewer Note</label>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{activePreviewPrediction.reviewer_note || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function ThresholdPill({
  label,
  threshold,
  actual,
}: {
  label: string;
  threshold: number;
  actual?: number;
}) {
  const passed = actual != null ? actual >= threshold : null;
  return (
    <span className="text-xs text-gray-400">
      {label} &ge; {(threshold * 100).toFixed(0)}%
      {passed != null && (
        <span className={`ml-1 ${passed ? "text-green-400" : "text-red-400"}`}>
          {passed ? "✓" : "✗"}
        </span>
      )}
    </span>
  );
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}
