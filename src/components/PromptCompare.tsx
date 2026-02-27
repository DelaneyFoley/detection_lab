"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import type { Detection, PromptVersion, Dataset, MetricsSummary, Run, Prediction } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function PromptCompare({ detection }: { detection: Detection }) {
  const { apiKey, selectedModel, refreshCounter } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Map<string, { run: any; predictions: Prediction[] }>>(new Map());

  const loadData = useCallback(async () => {
    const [pRes, dRes] = await Promise.all([
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
      fetch(`/api/datasets?detection_id=${detection.detection_id}`),
    ]);
    const ps = await safeJsonArray<PromptVersion>(pRes, "prompts");
    const ds = await safeJsonArray<Dataset>(dRes, "datasets");
    setPrompts(ps);
    setDatasets(ds.filter((d: Dataset) => d.split_type === "GOLDEN" || d.split_type === "ITERATION" || d.split_type === "CUSTOM"));
  }, [detection.detection_id, refreshCounter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const togglePrompt = (id: string) => {
    setSelectedPromptIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const runComparison = async () => {
    if (!apiKey) {
      alert("Set your Gemini API key first");
      return;
    }
    if (selectedPromptIds.length < 1) {
      alert("Select at least 1 prompt version");
      return;
    }
    if (!selectedDatasetId) {
      alert("Select a dataset");
      return;
    }

    setRunning(true);
    setResults(new Map());

    for (let i = 0; i < selectedPromptIds.length; i++) {
      const promptId = selectedPromptIds[i];
      const prompt = prompts.find((p) => p.prompt_version_id === promptId);
      setProgress(`Running prompt ${i + 1}/${selectedPromptIds.length}: ${prompt?.version_label || promptId.slice(0, 8)}...`);

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            model_override: selectedModel,
            prompt_version_id: promptId,
            dataset_id: selectedDatasetId,
            detection_id: detection.detection_id,
          }),
        });
        const runData = await res.json();

        // Fetch full run with predictions
        const fullRes = await fetch(`/api/runs?run_id=${runData.run_id}`);
        const fullRun = await fullRes.json();

        setResults((prev) => {
          const next = new Map(prev);
          next.set(promptId, { run: fullRun, predictions: fullRun.predictions });
          return next;
        });
      } catch (err) {
        console.error("Run failed:", err);
      }
    }

    setRunning(false);
    setProgress("");
  };

  const resultEntries = Array.from(results.entries());

  // Find disagreement cases
  const disagreements: Map<string, Map<string, string | null>> = new Map();
  if (resultEntries.length >= 2) {
    const allImageIds = new Set<string>();
    for (const [, { predictions }] of resultEntries) {
      for (const p of predictions) allImageIds.add(p.image_id);
    }
    for (const imageId of allImageIds) {
      const decisions = new Map<string, string | null>();
      for (const [promptId, { predictions }] of resultEntries) {
        const pred = predictions.find((p) => p.image_id === imageId);
        decisions.set(promptId, pred?.predicted_decision || null);
      }
      const values = Array.from(decisions.values());
      if (new Set(values).size > 1) {
        disagreements.set(imageId, decisions);
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Prompt Compare</h2>

      {/* Config */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
        <div className="grid grid-cols-2 gap-6">
          {/* Prompt selection */}
          <div>
            <h3 className="text-xs text-gray-400 font-medium mb-2">Select 2–4 Prompt Versions</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {prompts.map((p) => (
                <label
                  key={p.prompt_version_id}
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selectedPromptIds.includes(p.prompt_version_id)
                      ? "border-blue-600 bg-blue-900/20"
                      : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedPromptIds.includes(p.prompt_version_id)}
                    onChange={() => togglePrompt(p.prompt_version_id)}
                    className="rounded"
                  />
                  <span>{p.version_label}</span>
                  <span className="text-xs text-gray-500">{p.model} | temp={p.temperature}</span>
                  {p.prompt_version_id === detection.approved_prompt_version && (
                    <span className="text-xs text-green-400 ml-auto">APPROVED</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Dataset selection */}
          <div>
            <h3 className="text-xs text-gray-400 font-medium mb-2">Select Dataset</h3>
            <div className="space-y-1.5">
              {datasets.map((d) => (
                <label
                  key={d.dataset_id}
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selectedDatasetId === d.dataset_id
                      ? "border-blue-600 bg-blue-900/20"
                      : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="dataset"
                    checked={selectedDatasetId === d.dataset_id}
                    onChange={() => setSelectedDatasetId(d.dataset_id)}
                  />
                  <span>{d.name}</span>
                  <span className="text-xs text-gray-500">{d.size} images</span>
                  <span className={`text-xs ml-auto px-1.5 py-0.5 rounded ${splitColor(d.split_type)}`}>
                    {splitTypeLabel(d.split_type)}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-3 p-2 bg-gray-900/50 rounded border border-gray-700 text-xs text-gray-400">
              <b>Locked params:</b> All prompts will run with the same dataset and images.
              Temperature/top_p stay per-prompt. Model uses the app-level selection.
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={runComparison}
            disabled={running || selectedPromptIds.length < 1 || !selectedDatasetId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
          >
            {running ? "Running..." : "Run Comparison"}
          </button>
          {progress && <span className="text-sm text-gray-400">{progress}</span>}
        </div>
      </div>

      {/* Results */}
      {resultEntries.length > 0 && (
        <div className="space-y-6">
          {/* Per-prompt metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {resultEntries.map(([promptId, { run }]) => {
              const prompt = prompts.find((p) => p.prompt_version_id === promptId);
              return (
                <MetricsDisplay
                  key={promptId}
                  metrics={run.metrics_summary}
                  label={`${prompt?.version_label || promptId.slice(0, 8)} — ${prompt?.model}`}
                />
              );
            })}
          </div>

          {/* Metric Deltas */}
          {resultEntries.length >= 2 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-medium mb-3">Metric Deltas (vs first prompt)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700">
                      <th className="text-left py-2 px-3">Prompt</th>
                      <th className="text-right py-2 px-3">Accuracy</th>
                      <th className="text-right py-2 px-3">Precision</th>
                      <th className="text-right py-2 px-3">Recall</th>
                      <th className="text-right py-2 px-3">F1</th>
                      <th className="text-right py-2 px-3">Prevalence</th>
                      <th className="text-right py-2 px-3">Parse Fail %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultEntries.map(([promptId, { run }], i) => {
                      const prompt = prompts.find((p) => p.prompt_version_id === promptId);
                      const m = run.metrics_summary as MetricsSummary;
                      const base = (resultEntries[0][1].run.metrics_summary as MetricsSummary);
                      const isBase = i === 0;

                      return (
                        <tr key={promptId} className="border-b border-gray-800">
                          <td className="py-2 px-3 font-medium">
                            {prompt?.version_label}
                            {isBase && <span className="text-xs text-gray-500 ml-1">(baseline)</span>}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.accuracy)}
                            {!isBase && <Delta value={m.accuracy - base.accuracy} />}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.precision)}
                            {!isBase && <Delta value={m.precision - base.precision} />}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.recall)}
                            {!isBase && <Delta value={m.recall - base.recall} />}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.f1)}
                            {!isBase && <Delta value={m.f1 - base.f1} />}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.prevalence)}
                            {!isBase && <Delta value={m.prevalence - base.prevalence} />}
                          </td>
                          <td className="text-right py-2 px-3">
                            {fmt(m.parse_failure_rate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Disagreements */}
          {disagreements.size > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-medium mb-3">
                Disagreement Cases ({disagreements.size} images)
              </h3>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-800">
                    <tr className="text-gray-500 border-b border-gray-700">
                      <th className="text-left py-2 px-3">Image ID</th>
                      {resultEntries.map(([promptId]) => {
                        const prompt = prompts.find((p) => p.prompt_version_id === promptId);
                        return (
                          <th key={promptId} className="text-center py-2 px-3">
                            {prompt?.version_label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(disagreements.entries()).map(([imageId, decisions]) => (
                      <tr key={imageId} className="border-b border-gray-800">
                        <td className="py-2 px-3 font-mono">{imageId}</td>
                        {resultEntries.map(([promptId]) => {
                          const decision = decisions.get(promptId);
                          return (
                            <td key={promptId} className="text-center py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs ${
                                  decision === "DETECTED"
                                    ? "bg-green-900/30 text-green-400"
                                    : decision === "NOT_DETECTED"
                                    ? "bg-gray-800 text-gray-400"
                                    : "bg-red-900/30 text-red-400"
                                }`}
                              >
                                {decision || "PARSE_FAIL"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Full outcomes table */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-medium mb-3">Full Outcomes</h3>
            {resultEntries.map(([promptId, { predictions }]) => {
              const prompt = prompts.find((p) => p.prompt_version_id === promptId);
              return (
                <details key={promptId} className="mb-3">
                  <summary className="cursor-pointer text-sm text-gray-300 hover:text-white">
                    {prompt?.version_label} — {predictions.length} predictions
                  </summary>
                  <div className="mt-2 overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-800">
                        <tr className="text-gray-500 border-b border-gray-700">
                          <th className="text-left py-1.5 px-2">Image</th>
                          <th className="text-center py-1.5 px-2">Ground Truth</th>
                          <th className="text-center py-1.5 px-2">Prediction</th>
                          <th className="text-center py-1.5 px-2">Correct</th>
                          <th className="text-right py-1.5 px-2">Confidence</th>
                          <th className="text-left py-1.5 px-2">Evidence</th>
                          <th className="text-center py-1.5 px-2">Parse</th>
                        </tr>
                      </thead>
                      <tbody>
                        {predictions.map((p: Prediction) => {
                          const correct =
                            p.ground_truth_label != null &&
                            p.parse_ok &&
                            p.predicted_decision === p.ground_truth_label;
                          return (
                            <tr key={p.prediction_id} className="border-b border-gray-800/50">
                              <td className="py-1.5 px-2 font-mono">{p.image_id}</td>
                              <td className="text-center py-1.5 px-2">
                                <DecisionBadge decision={p.ground_truth_label || null} />
                              </td>
                              <td className="text-center py-1.5 px-2">
                                <DecisionBadge decision={p.predicted_decision} />
                              </td>
                              <td className="text-center py-1.5 px-2">
                                {correct ? (
                                  <span className="text-green-400">✓</span>
                                ) : (
                                  <span className="text-red-400">✗</span>
                                )}
                              </td>
                              <td className="text-right py-1.5 px-2">
                                {p.confidence != null ? p.confidence.toFixed(2) : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-gray-400 max-w-[200px] truncate">
                                {p.evidence || "—"}
                              </td>
                              <td className="text-center py-1.5 px-2">
                                {p.parse_ok ? (
                                  <span className="text-green-400 text-xs">OK</span>
                                ) : (
                                  <span className="text-red-400 text-xs">FAIL</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        decision === "DETECTED"
          ? "bg-green-900/30 text-green-400"
          : "bg-gray-800 text-gray-400"
      }`}
    >
      {decision === "DETECTED" ? "DET" : "NOT"}
    </span>
  );
}

function Delta({ value }: { value: number }) {
  const pct = (value * 100).toFixed(1);
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-gray-500";
  return (
    <span className={`ml-1 text-xs ${color}`}>
      ({value > 0 ? "+" : ""}{pct})
    </span>
  );
}

function fmt(v: number) {
  return (v * 100).toFixed(1) + "%";
}

function splitColor(t: string) {
  switch (t) {
    case "GOLDEN": return "bg-yellow-900/30 text-yellow-400";
    case "ITERATION": return "bg-blue-900/30 text-blue-400";
    case "HELD_OUT_EVAL": return "bg-purple-900/30 text-purple-400";
    default: return "bg-gray-800 text-gray-400";
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
