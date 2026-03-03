"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import type { Detection, PromptVersion, Dataset, Run } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function HeldOutEval({ detection }: { detection: Detection }) {
  const { apiKey, selectedModel, refreshCounter } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [latestResult, setLatestResult] = useState<any>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelingRun, setCancelingRun] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [pRes, dRes, rRes] = await Promise.all([
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
      fetch(`/api/datasets?detection_id=${detection.detection_id}`),
      fetch(`/api/runs?detection_id=${detection.detection_id}`),
    ]);
    setPrompts(await safeJsonArray<PromptVersion>(pRes, "prompts"));
    const allDatasets = await safeJsonArray<Dataset>(dRes, "datasets");
    setDatasets(allDatasets.filter((d: Dataset) => d.split_type === "HELD_OUT_EVAL"));
    setRuns(
      (await safeJsonArray<Run>(rRes, "runs")).filter(
        (r: any) => r.status === "completed" && r.split_type === "HELD_OUT_EVAL"
      )
    );
  }, [detection.detection_id, refreshCounter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runEval = async () => {
    if (!selectedPromptId || !selectedDatasetId) {
      alert("Select a prompt version and dataset");
      return;
    }

    // Prevent iteration on held-out
    const dataset = datasets.find((d) => d.dataset_id === selectedDatasetId);
    if (dataset && dataset.split_type !== "HELD_OUT_EVAL") {
      alert("Only EVALUATE datasets can be used here");
      return;
    }

    setRunning(true);
    setProgress("Starting held-out evaluation...");
    setLatestResult(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          prompt_version_id: selectedPromptId,
          dataset_id: selectedDatasetId,
          detection_id: detection.detection_id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.run_id) {
        throw new Error(data?.error || "Failed to start evaluation run");
      }
      setActiveRunId(data.run_id);

      const fullRun = await pollRunToTerminalState(data.run_id, (snapshot) => {
        const total = Number(snapshot?.total_images || 0);
        const processed = Number(snapshot?.processed_images || 0);
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        const stateLabel = String(snapshot?.status || "running").toUpperCase();
        setProgress(`Held-out ${stateLabel}: ${processed}/${total} images (${pct}%)`);
      });
      setLatestResult(fullRun);
      loadData();
      const processed = Number(fullRun?.processed_images || 0);
      const total = Number(fullRun?.total_images || 0);
      if (fullRun?.status === "cancelled") {
        setProgress(`Held-out run cancelled. Saved ${processed}/${total} processed images.`);
      } else if (fullRun?.status === "failed") {
        setProgress("Held-out run failed. Partial outputs (if any) were saved.");
      } else {
        setProgress(`Held-out run complete: ${processed}/${total} images.`);
      }
    } catch (err) {
      console.error(err);
      alert("Evaluation failed");
      setProgress("");
    }
    setRunning(false);
    setActiveRunId(null);
    setCancelingRun(false);
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    setCancelingRun(true);
    setProgress("Cancel requested. Finishing in-flight images...");
    await fetch("/api/runs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: activeRunId, action: "cancel" }),
    });
  };

  const exportCSV = async () => {
    if (!latestResult?.predictions) return;
    const descriptionByImageId = await fetchDatasetDescriptions(latestResult.dataset_id);
    const m = latestResult.metrics_summary || {};
    const headers: unknown[] = [
      "run_id",
      "dataset_id",
      "prompt_version_id",
      "created_at",
      "metric_accuracy",
      "metric_precision",
      "metric_recall",
      "metric_f1",
      "metric_prevalence",
      "metric_parse_failure_rate",
      "image_id",
      "image_uri",
      "dataset_image_description",
      "ground_truth",
      "prediction",
      "confidence",
      "evidence",
      "parse_ok",
      "parse_error_reason",
      "parse_fix_suggestion",
      "inference_runtime_ms",
      "parse_retry_count",
    ];
    const rows: unknown[][] = latestResult.predictions.map((p: any) => [
      latestResult.run_id,
      latestResult.dataset_id,
      latestResult.prompt_version_id,
      latestResult.created_at,
      m.accuracy ?? "",
      m.precision ?? "",
      m.recall ?? "",
      m.f1 ?? "",
      m.prevalence ?? "",
      m.parse_failure_rate ?? "",
      p.image_id,
      p.image_uri,
      descriptionByImageId.get(String(p.image_id || "")) || "",
      p.ground_truth_label,
      p.predicted_decision || "PARSE_FAIL",
      p.confidence ?? "",
      p.evidence || "",
      p.parse_ok,
      p.parse_error_reason || "",
      p.parse_fix_suggestion || "",
      p.inference_runtime_ms ?? "",
      p.parse_retry_count ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((row: unknown[]) => row.map((cell: unknown) => csvEscape(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `held-out-eval-${latestResult.run_id.slice(0, 8)}.csv`;
    a.click();
  };

  const exportJSON = async () => {
    if (!latestResult) return;
    const descriptionByImageId = await fetchDatasetDescriptions(latestResult.dataset_id);
    const payload = {
      ...latestResult,
      predictions: (latestResult.predictions || []).map((p: any) => ({
        ...p,
        dataset_image_description: descriptionByImageId.get(String(p.image_id || "")) || "",
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `held-out-eval-${latestResult.run_id.slice(0, 8)}.json`;
    a.click();
  };

  const predictions = useMemo(() => (Array.isArray(latestResult?.predictions) ? latestResult.predictions : []), [latestResult]);

  const disagreementCases = useMemo(() => {
    return predictions.filter((p: any) => {
      const gt = getResolvedGroundTruth(p);
      if (!gt) return false;
      if (!p?.image_uri) return false;
      if (!p.parse_ok) return true;
      return p.predicted_decision !== gt;
    });
  }, [predictions]);

  const previewImageIds: string[] = useMemo(
    () => disagreementCases.filter((p: any) => !!p?.image_uri).map((p: any) => String(p.image_id || "")),
    [disagreementCases]
  );

  const previewIndex = useMemo(
    () => (previewImageId ? previewImageIds.findIndex((id: string) => id === previewImageId) : -1),
    [previewImageId, previewImageIds]
  );

  const activePreviewPrediction = useMemo(() => {
    if (previewIndex < 0) return null;
    const imageId = previewImageIds[previewIndex];
    return disagreementCases.find((p: any) => String(p.image_id || "") === imageId) || null;
  }, [previewIndex, previewImageIds, disagreementCases]);

  useEffect(() => {
    if (!previewImageId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImageId(null);
        return;
      }
      if (previewImageIds.length === 0) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setPreviewImageId((prev) => {
          if (!prev) return prev;
          const i = previewImageIds.findIndex((id: string) => id === prev);
          const next = Math.min(previewImageIds.length - 1, Math.max(0, i) + 1);
          return previewImageIds[next] || prev;
        });
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setPreviewImageId((prev) => {
          if (!prev) return prev;
          const i = previewImageIds.findIndex((id: string) => id === prev);
          const next = Math.max(0, i <= 0 ? 0 : i - 1);
          return previewImageIds[next] || prev;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewImageId, previewImageIds]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Held-Out Evaluation</h2>

      <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-4 text-sm text-yellow-400">
        This tab is for final evaluation only. EVALUATE datasets cannot be used for prompt iteration.
        Results are stored permanently as run artifacts.
      </div>

      {/* Config */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs text-gray-400 font-medium mb-2">Prompt Version</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {prompts.map((p) => (
                <label
                  key={p.prompt_version_id}
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selectedPromptId === p.prompt_version_id
                      ? "border-blue-600 bg-blue-900/20"
                      : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="prompt"
                    checked={selectedPromptId === p.prompt_version_id}
                    onChange={() => setSelectedPromptId(p.prompt_version_id)}
                  />
                  <span>{p.version_label}</span>
                  <span className="text-xs text-gray-500">{p.model}</span>
                  {p.prompt_version_id === detection.approved_prompt_version && (
                    <span className="text-xs text-green-400 ml-auto">APPROVED</span>
                  )}
                  {p.golden_set_regression_result && (
                    <span className={`text-xs ml-1 ${p.golden_set_regression_result.passed ? "text-green-400" : "text-red-400"}`}>
                      Reg: {p.golden_set_regression_result.passed ? "PASS" : "FAIL"}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs text-gray-400 font-medium mb-2">EVALUATE Dataset</h3>
            <div className="space-y-1.5">
              {datasets.map((d) => (
                <label
                  key={d.dataset_id}
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selectedDatasetId === d.dataset_id
                      ? "border-purple-600 bg-purple-900/20"
                      : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="ho-dataset"
                    checked={selectedDatasetId === d.dataset_id}
                    onChange={() => setSelectedDatasetId(d.dataset_id)}
                  />
                  <span>{d.name}</span>
                  <span className="text-xs text-gray-500">{d.size} images</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 ml-auto">
                    HELD_OUT
                  </span>
                </label>
              ))}
              {datasets.length === 0 && (
                <p className="text-xs text-gray-500 py-3">
                  No EVALUATE datasets. Upload one in the Detection Setup tab.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={runEval}
            disabled={running || !selectedPromptId || !selectedDatasetId}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
          >
            {running ? "Running..." : "Run Held-Out Evaluation"}
          </button>
          {running && activeRunId && (
            <button
              onClick={cancelRun}
              disabled={cancelingRun}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
            >
              {cancelingRun ? "Cancelling..." : "Cancel Run"}
            </button>
          )}
          {progress && <span className="text-sm text-gray-400">{progress}</span>}
        </div>
      </div>

      {/* Results */}
      {latestResult && (
        <div className="space-y-6">
          <MetricsDisplay
            metrics={latestResult.metrics_summary}
            label="Held-Out Evaluation Results"
          />

          {/* Threshold check */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-medium mb-3">Threshold Check</h3>
            <div className="space-y-2 text-sm">
              {detection.metric_thresholds.min_precision != null && (
                <ThresholdRow
                  label="Precision"
                  value={latestResult.metrics_summary.precision}
                  threshold={detection.metric_thresholds.min_precision}
                />
              )}
              {detection.metric_thresholds.min_recall != null && (
                <ThresholdRow
                  label="Recall"
                  value={latestResult.metrics_summary.recall}
                  threshold={detection.metric_thresholds.min_recall}
                />
              )}
              {detection.metric_thresholds.min_f1 != null && (
                <ThresholdRow
                  label="F1"
                  value={latestResult.metrics_summary.f1}
                  threshold={detection.metric_thresholds.min_f1}
                />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 items-center">
            <div className="text-xs text-gray-400 px-2">
              Approval is managed manually in the Detection Setup tab after thresholds are met.
            </div>
            <button onClick={exportCSV} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Export CSV
            </button>
            <button onClick={exportJSON} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Export JSON
            </button>
          </div>

          {/* Predictions table */}
          {disagreementCases.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-medium mb-3">
                Disagreement Cases ({disagreementCases.length})
              </h3>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-800">
                    <tr className="text-gray-500 border-b border-gray-700">
                      <th className="text-left py-2 px-3">Preview</th>
                      <th className="text-left py-2 px-3">Image ID</th>
                      <th className="text-center py-2 px-3">Ground Truth</th>
                      <th className="text-center py-2 px-3">Prediction</th>
                      <th className="text-right py-2 px-3">Confidence</th>
                      <th className="text-center py-2 px-3">Parse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disagreementCases.map((p: any) => (
                      <tr key={p.prediction_id} className="border-b border-gray-800">
                        <td className="py-2 px-3">
                          <img
                            src={p.image_uri}
                            alt={p.image_id}
                            className="w-14 h-10 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                            onClick={() => setPreviewImageId(String(p.image_id || ""))}
                          />
                        </td>
                        <td className="py-2 px-3 font-mono max-w-[260px] truncate" title={String(p.image_id || "")}>
                          {p.image_id}
                        </td>
                        <td className="text-center py-2 px-3">
                          <DecisionBadge decision={getResolvedGroundTruth(p)} />
                        </td>
                        <td className="text-center py-2 px-3">
                          <DecisionBadge decision={p.parse_ok ? p.predicted_decision : "PARSE_FAIL"} />
                        </td>
                        <td className="text-right py-2 px-3">{p.confidence != null ? Number(p.confidence).toFixed(2) : "—"}</td>
                        <td className="text-center py-2 px-3">
                          {p.parse_ok ? <span className="text-green-400">OK</span> : <span className="text-red-400">FAIL</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-medium mb-3">Image-Level Results ({latestResult.predictions?.length || 0})</h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-800">
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 px-3">Image</th>
                    <th className="text-center py-2 px-3">Ground Truth</th>
                    <th className="text-center py-2 px-3">Prediction</th>
                    <th className="text-center py-2 px-3">Correct</th>
                    <th className="text-right py-2 px-3">Confidence</th>
                    <th className="text-left py-2 px-3">Evidence</th>
                    <th className="text-center py-2 px-3">Parse</th>
                  </tr>
                </thead>
                <tbody>
                  {(latestResult.predictions || []).map((p: any) => {
                    const correct = p.parse_ok && p.predicted_decision === p.ground_truth_label;
                    return (
                      <tr key={p.prediction_id} className={`border-b border-gray-800/50 ${!correct ? "bg-red-900/5" : ""}`}>
                        <td className="py-1.5 px-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {p.image_uri ? (
                              <img
                                src={p.image_uri}
                                alt={p.image_id}
                                className="w-10 h-8 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                                onClick={() => setPreviewImageId(String(p.image_id || ""))}
                              />
                            ) : null}
                            <span className="font-mono truncate max-w-[220px]" title={String(p.image_id || "")}>
                              {p.image_id}
                            </span>
                          </div>
                        </td>
                        <td className="text-center py-1.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            p.ground_truth_label === "DETECTED" ? "bg-purple-900/30 text-purple-300" : "bg-emerald-900/30 text-emerald-300"
                          }`}>
                            {p.ground_truth_label === "DETECTED" ? "DET" : "NOT"}
                          </span>
                        </td>
                        <td className="text-center py-1.5 px-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            p.predicted_decision === "DETECTED" ? "bg-purple-900/30 text-purple-300" :
                            p.predicted_decision === "NOT_DETECTED" ? "bg-emerald-900/30 text-emerald-300" :
                            "bg-red-900/30 text-red-400"
                          }`}>
                            {p.predicted_decision || "FAIL"}
                          </span>
                        </td>
                        <td className="text-center py-1.5 px-3">
                          {correct ? <span className="text-green-400">✓</span> : <span className="text-red-400">✗</span>}
                        </td>
                        <td className="text-right py-1.5 px-3">{p.confidence != null ? p.confidence.toFixed(2) : "—"}</td>
                        <td className="py-1.5 px-3 text-gray-400 max-w-[200px] truncate">{p.evidence || "—"}</td>
                        <td className="text-center py-1.5 px-3">
                          {p.parse_ok ? <span className="text-green-400">OK</span> : <span className="text-red-400">FAIL</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {previewImageId && previewImageIds.length > 0 && activePreviewPrediction && (
        <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto flex items-start justify-center p-6">
          <button className="absolute inset-0" onClick={() => setPreviewImageId(null)} aria-label="Close preview" />
          <div className="relative z-10 w-full max-w-7xl max-h-[calc(100vh-3rem)] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-4 my-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-400">
                Disagreement Cases · {Math.max(previewIndex, 0) + 1}/{previewImageIds.length} · {activePreviewPrediction.image_id}
              </div>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded"
                  onClick={() => {
                    if (previewIndex < 0) return;
                    const nextIndex = Math.max(0, previewIndex - 1);
                    setPreviewImageId(previewImageIds[nextIndex] || previewImageId);
                  }}
                  disabled={previewIndex <= 0}
                >
                  Prev
                </button>
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded"
                  onClick={() => {
                    if (previewIndex < 0) return;
                    const nextIndex = Math.min(previewImageIds.length - 1, previewIndex + 1);
                    setPreviewImageId(previewImageIds[nextIndex] || previewImageId);
                  }}
                  disabled={previewIndex >= previewImageIds.length - 1}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 min-w-[980px]">
                <div className="space-y-3 min-w-0">
                  <div className="bg-gray-950 rounded border border-gray-800 p-2">
                    <img
                      src={activePreviewPrediction.image_uri}
                      alt={activePreviewPrediction.image_id}
                      className="w-full max-h-[56vh] object-contain rounded"
                    />
                  </div>
                  <div className="bg-gray-950 rounded border border-gray-800 p-3 text-xs space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Ground Truth:</span>
                      <DecisionBadge decision={getResolvedGroundTruth(activePreviewPrediction)} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-gray-500">Model Outcome</div>
                      <div className="border border-gray-800 rounded p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Prediction:</span>
                          <DecisionBadge
                            decision={activePreviewPrediction.parse_ok ? activePreviewPrediction.predicted_decision : "PARSE_FAIL"}
                          />
                          <span className="text-gray-500">
                            {activePreviewPrediction.confidence != null
                              ? Number(activePreviewPrediction.confidence).toFixed(2)
                              : "—"}
                          </span>
                          <span className={`${activePreviewPrediction.parse_ok ? "text-green-400" : "text-red-400"}`}>
                            {activePreviewPrediction.parse_ok ? "OK" : "FAIL"}
                          </span>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Evidence</div>
                          <div className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-gray-300">
                            {activePreviewPrediction.evidence || "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Model Output</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-black/20 rounded p-2 text-gray-300">
                            {formatModelOutput(activePreviewPrediction.raw_response || "")}
                          </pre>
                        </div>
                        {!activePreviewPrediction.parse_ok && (
                          <div className="space-y-1 text-gray-300">
                            <div><span className="text-gray-500">Parse Reason:</span> {activePreviewPrediction.parse_error_reason || "Parse failed"}</div>
                            <div><span className="text-gray-500">Fix Suggestion:</span> {activePreviewPrediction.parse_fix_suggestion || "Return strict JSON only."}</div>
                          </div>
                        )}
                        <div className="space-y-1 text-gray-300">
                          <div className="text-gray-500">HIL Review</div>
                          <div>Error tag: {activePreviewPrediction.error_tag || "—"}</div>
                          <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words">
                            Reviewer note: {activePreviewPrediction.reviewer_note || "—"}
                          </div>
                          <div>Corrected at: {activePreviewPrediction.corrected_at ? new Date(activePreviewPrediction.corrected_at).toLocaleString() : "—"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto w-80 shrink-0">
                  {previewImageIds.map((imageId: string, idx: number) => {
                    const row = disagreementCases.find((p: any) => String(p.image_id || "") === imageId);
                    if (!row) return null;
                    return (
                      <button
                        key={`${imageId}-${idx}`}
                        className={`w-full text-left p-2 rounded border ${
                          idx === previewIndex
                            ? "border-blue-500 bg-blue-900/20"
                            : "border-gray-700 bg-gray-900/40 hover:border-gray-600"
                        }`}
                        onClick={() => setPreviewImageId(imageId)}
                      >
                        <div className="text-[11px] font-mono text-gray-300 truncate" title={imageId}>{imageId}</div>
                        <img
                          src={row.image_uri}
                          alt={imageId}
                          className="mt-1 w-full h-16 object-cover rounded border border-gray-700"
                        />
                        <div className="mt-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500">GT:</span>
                            <DecisionBadge decision={getResolvedGroundTruth(row)} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500">Model:</span>
                            <DecisionBadge decision={row.parse_ok ? row.predicted_decision : "PARSE_FAIL"} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical runs */}
      {runs.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <h3 className="text-sm font-medium mb-3">Held-Out Run History</h3>
          <div className="space-y-2">
            {runs.map((r: any) => {
              const prompt = prompts.find((p) => p.prompt_version_id === r.prompt_version_id);
              return (
                <div key={r.run_id} className="border border-gray-700 bg-gray-900/30 rounded p-3 text-sm">
                  <div className="flex justify-between">
                    <div className="flex gap-3 items-center">
                      <span className="font-mono text-xs text-gray-400">{r.run_id.slice(0, 8)}</span>
                      <span className="text-xs">{prompt?.version_label || "?"}</span>
                    </div>
                    <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span>Accuracy: <b className="text-gray-300">{((r.metrics_summary?.accuracy || 0) * 100).toFixed(1)}%</b></span>
                    <span>Precision: <b className="text-blue-400">{((r.metrics_summary?.precision || 0) * 100).toFixed(1)}%</b></span>
                    <span>Recall: <b className="text-green-400">{((r.metrics_summary?.recall || 0) * 100).toFixed(1)}%</b></span>
                    <span>F1: <b className="text-yellow-400">{((r.metrics_summary?.f1 || 0) * 100).toFixed(1)}%</b></span>
                    <span>Prevalence: <b className="text-purple-300">{((r.metrics_summary?.prevalence || 0) * 100).toFixed(1)}%</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

async function fetchDatasetDescriptions(datasetId: string): Promise<Map<string, string>> {
  if (!datasetId) return new Map();
  try {
    const res = await fetch(`/api/datasets?dataset_id=${datasetId}`);
    const payload = await res.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const map = new Map<string, string>();
    for (const item of items) {
      if (!item?.image_id) continue;
      map.set(String(item.image_id), String(item.image_description || ""));
    }
    return map;
  } catch {
    return new Map();
  }
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

async function pollRunToTerminalState(
  runId: string,
  onProgress?: (snapshot: any) => void
): Promise<any> {
  while (true) {
    const res = await fetch(`/api/runs?run_id=${runId}`);
    const snapshot = await res.json();
    if (!res.ok) {
      throw new Error(snapshot?.error || "Failed to fetch run status");
    }
    onProgress?.(snapshot);
    if (snapshot?.status === "completed" || snapshot?.status === "cancelled" || snapshot?.status === "failed") {
      return snapshot;
    }
    await delay(1000);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ThresholdRow({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const passed = value >= threshold;
  return (
    <div className="flex items-center gap-3">
      <span className={`text-lg ${passed ? "text-green-400" : "text-red-400"}`}>
        {passed ? "✓" : "✗"}
      </span>
      <span className="text-gray-300 w-20">{label}</span>
      <span className="font-mono">{(value * 100).toFixed(1)}%</span>
      <span className="text-gray-500">≥</span>
      <span className="font-mono text-gray-400">{(threshold * 100).toFixed(1)}%</span>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-gray-600 text-xs">—</span>;
  if (decision !== "DETECTED" && decision !== "NOT_DETECTED") {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{decision}</span>;
  }
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        decision === "DETECTED"
          ? "bg-purple-900/30 text-purple-300"
          : "bg-emerald-900/30 text-emerald-300"
      }`}
    >
      {decision}
    </span>
  );
}

function getResolvedGroundTruth(prediction: any): string | null {
  return prediction?.corrected_label || prediction?.ground_truth_label || null;
}

function formatModelOutput(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "—";
  let cleaned = text;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

async function safeJsonArray<T>(res: Response, label: string): Promise<T[]> {
  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed to load ${label}:`, res.status, text.slice(0, 200));
    return [];
  }
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    console.error(`Invalid JSON for ${label}:`, text.slice(0, 200));
    return [];
  }
}
