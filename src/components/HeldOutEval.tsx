"use client";

import { useState, useEffect, useCallback } from "react";
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
  const [approving, setApproving] = useState(false);

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
    setProgress("Running held-out evaluation...");
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

      // Fetch full run
      const fullRes = await fetch(`/api/runs?run_id=${data.run_id}`);
      const fullRun = await fullRes.json();
      setLatestResult(fullRun);
      loadData();
    } catch (err) {
      console.error(err);
      alert("Evaluation failed");
    }
    setRunning(false);
    setProgress("");
  };

  const approvePrompt = async () => {
    if (!latestResult) return;

    const thresholds = detection.metric_thresholds;
    const m = latestResult.metrics_summary;

    // Check thresholds
    const failures: string[] = [];
    if (thresholds.min_precision != null && m.precision < thresholds.min_precision) {
      failures.push(`Precision ${(m.precision * 100).toFixed(1)}% < ${(thresholds.min_precision * 100).toFixed(1)}%`);
    }
    if (thresholds.min_recall != null && m.recall < thresholds.min_recall) {
      failures.push(`Recall ${(m.recall * 100).toFixed(1)}% < ${(thresholds.min_recall * 100).toFixed(1)}%`);
    }
    if (thresholds.min_f1 != null && m.f1 < thresholds.min_f1) {
      failures.push(`F1 ${(m.f1 * 100).toFixed(1)}% < ${(thresholds.min_f1 * 100).toFixed(1)}%`);
    }

    if (failures.length > 0) {
      alert(`Cannot approve: thresholds not met.\n\n${failures.join("\n")}`);
      return;
    }

    setApproving(true);

    // First, run golden regression
    const datasetsRes = await fetch(`/api/datasets?detection_id=${detection.detection_id}`);
    const allDatasets = await datasetsRes.json();
    const goldenDataset = allDatasets.find((d: any) => d.split_type === "GOLDEN");

    if (goldenDataset) {
      const regRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          prompt_version_id: latestResult.prompt_version_id,
          dataset_id: goldenDataset.dataset_id,
          detection_id: detection.detection_id,
        }),
      });
      const regRun = await regRes.json();

      // Check regression against previous approved
      let previousMetrics = null;
      if (detection.approved_prompt_version) {
        const prevRuns = runs.filter(
          (r: any) => r.prompt_version_id === detection.approved_prompt_version
        );
        if (prevRuns.length > 0) {
          previousMetrics = (prevRuns[0] as any).metrics_summary;
        }
      }

      const regressionPassed = checkRegression(regRun.metrics, thresholds, previousMetrics);

      if (!regressionPassed) {
        alert("Golden regression FAILED. Cannot approve this prompt version.");
        setApproving(false);
        return;
      }

      // Save regression result
      await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_version_id: latestResult.prompt_version_id,
          golden_set_regression_result: {
            passed: true,
            run_id: regRun.run_id,
            metrics: regRun.metrics,
            previous_metrics: previousMetrics,
            evaluated_at: new Date().toISOString(),
          },
        }),
      });
    }

    // Mark as approved
    await fetch("/api/detections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detection_id: detection.detection_id,
        display_name: detection.display_name,
        description: detection.description,
        label_policy: detection.label_policy,
        decision_rubric: detection.decision_rubric,
        metric_thresholds: detection.metric_thresholds,
        approved_prompt_version: latestResult.prompt_version_id,
      }),
    });

    alert("Prompt version APPROVED!");
    setApproving(false);
    loadData();
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
          <div className="flex gap-3">
            <button
              onClick={approvePrompt}
              disabled={approving}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium"
            >
              {approving ? "Approving..." : "Approve Prompt Version"}
            </button>
            <button onClick={exportCSV} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Export CSV
            </button>
            <button onClick={exportJSON} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Export JSON
            </button>
          </div>

          {/* Predictions table */}
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
                        <td className="py-1.5 px-3 font-mono">{p.image_id}</td>
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

function checkRegression(
  metrics: any,
  thresholds: any,
  previousMetrics: any
): boolean {
  // Check thresholds
  if (thresholds.min_precision != null && metrics.precision < thresholds.min_precision) return false;
  if (thresholds.min_recall != null && metrics.recall < thresholds.min_recall) return false;
  if (thresholds.min_f1 != null && metrics.f1 < thresholds.min_f1) return false;

  // Check regression against previous
  if (previousMetrics) {
    const primaryMetric = thresholds.primary_metric || "f1";
    if (metrics[primaryMetric] < previousMetrics[primaryMetric]) return false;
  }

  return true;
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
