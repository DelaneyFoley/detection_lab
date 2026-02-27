"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Run, PromptVersion, Dataset, MetricsSummary } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function DetectionDashboard({ detections: initialDetections }: { detections: Detection[] }) {
  const { refreshCounter } = useAppStore();
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
  const [previewPrediction, setPreviewPrediction] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

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

  const deleteDetection = async (detectionId: string, displayName: string) => {
    if (!confirm(`Delete detection "${displayName}" and all related prompts/runs/datasets? This cannot be undone.`)) {
      return;
    }
    const res = await fetch("/api/detections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detection_id: detectionId }),
    });
    if (!res.ok) {
      const text = await res.text();
      alert(`Failed to delete detection: ${text}`);
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
      <div>
        <h2 className="text-xl font-semibold">Detection Dashboard</h2>
        <p className="text-sm text-gray-500 mt-1">
          Overview of all saved detections with latest run outcomes
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
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
          const latestRun = data?.runs[0] as any;
          const latestMetrics: MetricsSummary | null = latestRun?.metrics_summary || null;
          const approvedPrompt = data?.prompts.find(
            (p) => p.prompt_version_id === d.approved_prompt_version
          );
          const isExpanded = expandedId === d.detection_id;

          return (
            <div
              key={d.detection_id}
              className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden"
            >
              {/* Detection Header Row */}
              <div
                className="px-5 py-4 cursor-pointer hover:bg-gray-800/70 transition-colors"
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
                        <code className="text-xs text-gray-500 bg-gray-900 px-1.5 py-0.5 rounded shrink-0">
                          {d.detection_code}
                        </code>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{d.description}</p>
                    </div>
                  </div>

                  {/* Status indicators */}
                  <div className="flex items-center gap-4 shrink-0 ml-4">
                    {/* Approved status */}
                    {d.approved_prompt_version ? (
                      <span className="text-xs bg-green-900/25 text-green-400 border border-green-800/40 px-2.5 py-1 rounded-full">
                        Approved: {approvedPrompt?.version_label || "?"}
                      </span>
                    ) : (
                      <span className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-2.5 py-1 rounded-full">
                        No approved prompt
                      </span>
                    )}

                    {/* Quick metrics from latest run */}
                    {latestMetrics && (
                      <div className="flex gap-3 text-xs">
                        <span>
                          P:{" "}
                          <b className="text-blue-400">
                            {(latestMetrics.precision * 100).toFixed(1)}%
                          </b>
                        </span>
                        <span>
                          R:{" "}
                          <b className="text-green-400">
                            {(latestMetrics.recall * 100).toFixed(1)}%
                          </b>
                        </span>
                        <span>
                          F1:{" "}
                          <b className="text-yellow-400">
                            {(latestMetrics.f1 * 100).toFixed(1)}%
                          </b>
                        </span>
                      </div>
                    )}
                    {!latestMetrics && (
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
                      className="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && data && (
                <div className="border-t border-gray-700 px-5 py-5 space-y-5 bg-gray-900/20">
                  {/* Thresholds */}
                  <div className="bg-gray-800/40 rounded-lg p-4">
                    <h4 className="text-xs text-gray-500 font-medium mb-2">Metric Thresholds</h4>
                    <div className="flex gap-6 text-sm">
                      <span className="text-gray-400">
                        Primary: <b className="text-gray-200">{d.metric_thresholds.primary_metric}</b>
                      </span>
                      {d.metric_thresholds.min_precision != null && (
                        <ThresholdPill
                          label="Precision"
                          threshold={d.metric_thresholds.min_precision}
                          actual={latestMetrics?.precision}
                        />
                      )}
                      {d.metric_thresholds.min_recall != null && (
                        <ThresholdPill
                          label="Recall"
                          threshold={d.metric_thresholds.min_recall}
                          actual={latestMetrics?.recall}
                        />
                      )}
                      {d.metric_thresholds.min_f1 != null && (
                        <ThresholdPill
                          label="F1"
                          threshold={d.metric_thresholds.min_f1}
                          actual={latestMetrics?.f1}
                        />
                      )}
                    </div>
                  </div>

                  {/* Run Log */}
                  <div>
                    <h4 className="text-xs text-gray-500 font-medium mb-2">
                      Run Log ({data.runs.length})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-700">
                            <th className="text-left py-2 px-3">Run</th>
                            <th className="text-left py-2 px-3">Prompt</th>
                            <th className="text-center py-2 px-3">Split</th>
                            <th className="text-right py-2 px-3">Accuracy</th>
                            <th className="text-right py-2 px-3">Precision</th>
                            <th className="text-right py-2 px-3">Recall</th>
                            <th className="text-right py-2 px-3">F1</th>
                            <th className="text-right py-2 px-3">Prevalence</th>
                            <th className="text-right py-2 px-3">Parse Fail</th>
                            <th className="text-right py-2 px-3">Images</th>
                            <th className="text-left py-2 px-3">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.runs.slice(0, 20).map((r: any) => {
                            const m = r.metrics_summary as MetricsSummary;
                            const prompt = data.prompts.find(
                              (p) => p.prompt_version_id === r.prompt_version_id
                            );
                            const details = runDetails.get(r.run_id);
                            const feedback = details?.prompt_feedback_log || r.prompt_feedback_log || {};
                            const accepted = Array.isArray(feedback.accepted) ? feedback.accepted : [];
                            const rejected = Array.isArray(feedback.rejected) ? feedback.rejected : [];
                            return (
                              <Fragment key={r.run_id}>
                                <tr className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                  <td className="py-2 px-3 font-mono text-gray-400">
                                    <button
                                      onClick={() => toggleRunDetails(r.run_id)}
                                      className="text-left hover:text-blue-300"
                                    >
                                      {expandedRunId === r.run_id ? "▼ " : "▶ "}
                                      {r.run_id.slice(0, 8)}
                                    </button>
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className="text-gray-300">{prompt?.version_label || "?"}</span>
                                  </td>
                                  <td className="text-center py-2 px-3">
                                    <span className={`px-1.5 py-0.5 rounded ${splitColor(r.split_type)}`}>
                                      {splitTypeLabel(r.split_type)}
                                    </span>
                                  </td>
                                  <td className="text-right py-2 px-3 text-gray-300">
                                    {(m.accuracy * 100).toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-3 text-blue-400">
                                    {(m.precision * 100).toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-3 text-green-400">
                                    {(m.recall * 100).toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-3 text-yellow-400 font-medium">
                                    {(m.f1 * 100).toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-3 text-purple-300">
                                    {(m.prevalence * 100).toFixed(1)}%
                                  </td>
                                  <td className="text-right py-2 px-3">
                                    <span className={m.parse_failure_rate > 0 ? "text-yellow-400" : "text-gray-500"}>
                                      {(m.parse_failure_rate * 100).toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="text-right py-2 px-3 text-gray-400">{m.total}</td>
                                  <td className="py-2 px-3 text-gray-500">
                                    {new Date(r.created_at).toLocaleString()}
                                  </td>
                                </tr>
                                {expandedRunId === r.run_id && (
                                  <tr className="border-b border-gray-800/50 bg-gray-900/30">
                                    <td colSpan={11} className="px-3 py-3">
                                      {loadingRunId === r.run_id && (
                                        <p className="text-xs text-gray-500">Loading run items...</p>
                                      )}
                                      {loadingRunId !== r.run_id && (
                                        <div className="space-y-3">
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => exportRunLogCsv(d, r, details?.predictions || [])}
                                              className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                                            >
                                              Export Run Log CSV
                                            </button>
                                            <button
                                              onClick={() => exportRunLogJson(d, r, details?.predictions || [])}
                                              className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                                            >
                                              Export Run Log JSON
                                            </button>
                                          </div>
                                          {(accepted.length > 0 || rejected.length > 0) && (
                                            <div className="bg-gray-950/40 border border-gray-800 rounded p-2">
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
                                                        <div key={`a_${idx}`} className="text-[11px] text-gray-300 bg-gray-900/60 rounded px-2 py-1">
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
                                                        <div key={`r_${idx}`} className="text-[11px] text-gray-300 bg-gray-900/60 rounded px-2 py-1">
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
                                        <div className="max-h-72 overflow-auto border border-gray-800 rounded">
                                          <table className="w-full text-xs">
                                            <thead className="sticky top-0 bg-gray-900/90">
                                              <tr className="text-gray-500 border-b border-gray-800">
                                                <th className="text-left px-2 py-1.5">Preview</th>
                                                <th className="text-left px-2 py-1.5">Image</th>
                                                <th className="text-center px-2 py-1.5">AI Label</th>
                                                <th className="text-right px-2 py-1.5">Confidence</th>
                                                <th className="text-right px-2 py-1.5">Runtime (ms)</th>
                                                <th className="text-left px-2 py-1.5">AI Description</th>
                                                <th className="text-center px-2 py-1.5">Ground Truth (run snapshot)</th>
                                                <th className="text-left px-2 py-1.5">Parse Reason</th>
                                                <th className="text-left px-2 py-1.5">Fix Suggestion</th>
                                                <th className="text-left px-2 py-1.5">Error Tag</th>
                                                <th className="text-left px-2 py-1.5">Reviewer Note</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {(details?.predictions || []).map((p: any) => (
                                                <tr
                                                  key={p.prediction_id}
                                                  className={`border-b border-gray-900/70 ${
                                                    p.ground_truth_label &&
                                                    p.predicted_decision &&
                                                    p.predicted_decision !== p.ground_truth_label
                                                      ? "bg-red-900/15"
                                                      : ""
                                                  }`}
                                                >
                                                  <td className="px-2 py-1.5">
                                                    <img
                                                      src={p.image_uri}
                                                      alt={p.image_id}
                                                      className="w-12 h-9 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                                                      onClick={() => setPreviewPrediction(p)}
                                                    />
                                                  </td>
                                                  <td className="px-2 py-1.5 font-mono text-gray-300">{p.image_id}</td>
                                                  <td className="px-2 py-1.5 text-center text-gray-300">
                                                    <span
                                                      className={`px-1.5 py-0.5 rounded ${
                                                        p.predicted_decision === "DETECTED"
                                                          ? "bg-purple-900/30 text-purple-300"
                                                          : p.predicted_decision === "NOT_DETECTED"
                                                          ? "bg-emerald-900/30 text-emerald-300"
                                                          : "bg-red-900/30 text-red-400"
                                                      }`}
                                                    >
                                                      {p.predicted_decision || "PARSE_FAIL"}
                                                    </span>
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right text-gray-300">
                                                    {p.confidence != null ? Number(p.confidence).toFixed(2) : "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-right text-gray-300">
                                                    {p.inference_runtime_ms != null ? Number(p.inference_runtime_ms) : "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-400 max-w-[420px] truncate" title={p.evidence || ""}>
                                                    {p.evidence || "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-center text-gray-300">
                                                    {p.ground_truth_label ? (
                                                      <span
                                                        className={`px-1.5 py-0.5 rounded ${
                                                          p.ground_truth_label === "DETECTED"
                                                            ? "bg-purple-900/30 text-purple-300"
                                                            : "bg-emerald-900/30 text-emerald-300"
                                                        }`}
                                                      >
                                                        {p.ground_truth_label}
                                                      </span>
                                                    ) : (
                                                      "UNSET"
                                                    )}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-300 max-w-[280px] truncate" title={p.parse_error_reason || ""}>
                                                    {!p.parse_ok ? p.parse_error_reason || "Parse failed" : "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-400 max-w-[320px] truncate" title={p.parse_fix_suggestion || ""}>
                                                    {!p.parse_ok ? p.parse_fix_suggestion || "Return strict JSON only." : "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-300">
                                                    {p.error_tag || "—"}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-gray-400 max-w-[300px] truncate" title={p.reviewer_note || ""}>
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

      {previewPrediction && (
        <div
          className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start justify-center p-6"
          onClick={() => setPreviewPrediction(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[calc(100vh-3rem)] bg-gray-900 border border-gray-700 rounded-lg p-4 grid gap-4 overflow-hidden my-auto"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center">
              <img
                src={previewPrediction.image_uri}
                alt={previewPrediction.image_id}
                className="max-h-[72vh] max-w-full rounded-lg border border-gray-700"
              />
            </div>
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="text-xs text-gray-500 font-mono">{previewPrediction.image_id}</div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">AI Label</label>
                <div>
                  <span
                    className={`text-sm px-1.5 py-0.5 rounded ${
                      previewPrediction.predicted_decision === "DETECTED"
                        ? "bg-purple-900/30 text-purple-300"
                        : previewPrediction.predicted_decision === "NOT_DETECTED"
                        ? "bg-emerald-900/30 text-emerald-300"
                        : "bg-red-900/30 text-red-400"
                    }`}
                  >
                    {previewPrediction.predicted_decision || "PARSE_FAIL"}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Confidence (0-1)</label>
                <div className="text-sm text-gray-300">
                  {previewPrediction.confidence != null ? Number(previewPrediction.confidence).toFixed(2) : "—"}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Runtime</label>
                <div className="text-sm text-gray-300">
                  {previewPrediction.inference_runtime_ms != null
                    ? `${Number(previewPrediction.inference_runtime_ms)} ms`
                    : "—"}
                  {previewPrediction.parse_retry_count != null
                    ? ` (retries: ${Number(previewPrediction.parse_retry_count)})`
                    : ""}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">AI Description</label>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{previewPrediction.evidence || "—"}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ground Truth (run snapshot)</label>
                <div>
                  {previewPrediction.ground_truth_label ? (
                    <span
                      className={`text-sm px-1.5 py-0.5 rounded ${
                        previewPrediction.ground_truth_label === "DETECTED"
                          ? "bg-purple-900/30 text-purple-300"
                          : "bg-emerald-900/30 text-emerald-300"
                      }`}
                    >
                      {previewPrediction.ground_truth_label}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-300">UNSET</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Error Tag</label>
                <div className="text-sm text-gray-300">{previewPrediction.error_tag || "—"}</div>
              </div>
              {!previewPrediction.parse_ok && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Parse Reason</label>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {previewPrediction.parse_error_reason || "Response did not match expected schema."}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">How to Fix</label>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {previewPrediction.parse_fix_suggestion || "Return strict JSON only with required keys."}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Reviewer Note</label>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{previewPrediction.reviewer_note || "—"}</div>
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

function splitColor(t: string) {
  switch (t) {
    case "GOLDEN": return "bg-yellow-900/30 text-yellow-400";
    case "ITERATION": return "bg-blue-900/30 text-blue-400";
    case "HELD_OUT_EVAL": return "bg-purple-900/30 text-purple-400";
    default: return "bg-gray-800 text-gray-400";
  }
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}
