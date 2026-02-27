"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import type { Detection, PromptVersion, Dataset, MetricsSummary, Run, Prediction } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function PromptCompare({ detection }: { detection: Detection }) {
  const { refreshCounter } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Map<string, { run: any; predictions: Prediction[] }>>(new Map());
  const [previewState, setPreviewState] = useState<
    { promptId: string; imageId: string; source: "disagreement" | "full" } | null
  >(null);
  const runningRef = useRef(false);

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
    if (runningRef.current) return;
    if (selectedPromptIds.length < 1) {
      alert("Select at least 1 prompt version");
      return;
    }
    if (!selectedDatasetId) {
      alert("Select a dataset");
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setResults(new Map());
    try {
      const runsRes = await fetch(`/api/runs?detection_id=${detection.detection_id}`);
      const runs = await safeJsonArray<Run>(runsRes, "runs");

      const nextResults = new Map<string, { run: any; predictions: Prediction[] }>();

      for (let i = 0; i < selectedPromptIds.length; i++) {
        const promptId = selectedPromptIds[i];
        const prompt = prompts.find((p) => p.prompt_version_id === promptId);
        setProgress(
          `Loading latest run ${i + 1}/${selectedPromptIds.length}: ${prompt?.version_label || promptId.slice(0, 8)}...`
        );

        const latest = runs.find(
          (r) =>
            r.status === "completed" &&
            r.dataset_id === selectedDatasetId &&
            r.prompt_version_id === promptId
        );
        if (!latest) continue;

        const fullRes = await fetch(`/api/runs?run_id=${latest.run_id}`);
        const fullRun = await fullRes.json();
        if (!fullRes.ok) continue;
        nextResults.set(promptId, {
          run: fullRun,
          predictions: Array.isArray(fullRun?.predictions) ? fullRun.predictions : [],
        });
      }

      setResults(nextResults);
      if (nextResults.size === 0) {
        alert("No completed runs found for the selected prompt(s) + dataset. Run them first in Detection Setup or Build Dataset.");
      }
    } catch (err) {
      console.error("Failed to load comparison runs:", err);
      alert("Failed to load comparison runs.");
    } finally {
      setRunning(false);
      setProgress("");
      runningRef.current = false;
    }
  };

  const resultEntries = Array.from(results.entries());
  const promptLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of prompts) map.set(p.prompt_version_id, p.version_label);
    return map;
  }, [prompts]);

  // Find disagreement cases
  const disagreements: Map<string, { decisions: Map<string, string | null>; sample: Prediction | null; groundTruth: string | null }> = new Map();
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
        const sample =
          resultEntries
            .map(([, { predictions }]) => predictions.find((p) => p.image_id === imageId) || null)
            .find((p) => !!p) || null;
        disagreements.set(imageId, {
          decisions,
          sample,
          groundTruth: sample ? getResolvedGroundTruth(sample) : null,
        });
      }
    }
  }

  const getPredictionForImage = useCallback(
    (promptId: string, imageId: string): Prediction | null => {
      const entry = results.get(promptId);
      if (!entry) return null;
      return entry.predictions.find((p) => p.image_id === imageId) || null;
    },
    [results]
  );

  const activePreviewImageIds = useMemo(() => {
    if (!previewState) return [] as string[];
    if (previewState.source === "disagreement") {
      return Array.from(disagreements.entries())
        .filter(([, disagreement]) => !!disagreement.sample?.image_uri)
        .map(([imageId]) => imageId);
    }
    const entry = results.get(previewState.promptId);
    return (entry?.predictions || []).filter((p) => !!p.image_uri).map((p) => p.image_id);
  }, [previewState, disagreements, results]);

  const activePreviewIndex = useMemo(() => {
    if (!previewState) return -1;
    return activePreviewImageIds.findIndex((imageId) => imageId === previewState.imageId);
  }, [previewState, activePreviewImageIds]);

  const activePreviewPrediction = useMemo(() => {
    if (!previewState || activePreviewIndex < 0) return null;
    const activeImageId = activePreviewImageIds[activePreviewIndex];
    const preferred = getPredictionForImage(previewState.promptId, activeImageId);
    if (preferred?.image_uri) return preferred;
    for (const [promptId] of resultEntries) {
      const candidate = getPredictionForImage(promptId, activeImageId);
      if (candidate?.image_uri) return candidate;
    }
    return null;
  }, [previewState, activePreviewIndex, activePreviewImageIds, getPredictionForImage, resultEntries]);

  const activePromptOutcomes = useMemo(() => {
    if (!previewState || activePreviewIndex < 0) return [];
    const activeImageId = activePreviewImageIds[activePreviewIndex];
    return resultEntries.map(([promptId]) => {
      const prediction = getPredictionForImage(promptId, activeImageId);
      return { promptId, prediction };
    });
  }, [previewState, activePreviewIndex, activePreviewImageIds, resultEntries, getPredictionForImage]);

  const activeGroundTruth = useMemo(() => {
    for (const row of activePromptOutcomes) {
      if (row.prediction) {
        const gt = getResolvedGroundTruth(row.prediction);
        if (gt) return gt;
      }
    }
    return null;
  }, [activePromptOutcomes]);

  useEffect(() => {
    if (!previewState) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewState(null);
        return;
      }
      if (activePreviewImageIds.length === 0) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setPreviewState((prev) => {
          if (!prev) return prev;
          const currentIndex = activePreviewImageIds.findIndex((imageId) => imageId === prev.imageId);
          const nextIndex = Math.min(activePreviewImageIds.length - 1, Math.max(0, currentIndex + 1));
          return { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId };
        });
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setPreviewState((prev) => {
          if (!prev) return prev;
          const currentIndex = activePreviewImageIds.findIndex((imageId) => imageId === prev.imageId);
          const nextIndex = Math.max(0, Math.max(0, currentIndex) - 1);
          return { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewState, activePreviewImageIds]);

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
              <b>Comparison mode:</b> Uses the latest existing completed run for each selected prompt + dataset.
              Prompt Compare does not create new runs.
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={runComparison}
            disabled={running || selectedPromptIds.length < 1 || !selectedDatasetId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium"
          >
            {running ? "Loading..." : "Compare Latest Runs"}
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
                      <th className="text-left py-2 px-3">Preview</th>
                      <th className="text-left py-2 px-3">Image ID</th>
                      <th className="text-center py-2 px-3">Ground Truth</th>
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
                    {Array.from(disagreements.entries()).map(([imageId, disagreement]) => (
                      <tr key={imageId} className="border-b border-gray-800">
                        <td className="py-2 px-3">
                          {disagreement.sample?.image_uri ? (
                            <img
                              src={disagreement.sample.image_uri}
                              alt={imageId}
                              className="w-12 h-9 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                              onClick={() =>
                                setPreviewState({
                                  promptId:
                                    resultEntries.find(([, { predictions }]) =>
                                      predictions.some((p) => p.image_id === imageId && !!p.image_uri)
                                    )?.[0] || resultEntries[0][0],
                                  imageId,
                                  source: "disagreement",
                                })
                              }
                            />
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono">{imageId}</td>
                        <td className="text-center py-2 px-3">
                          <DecisionBadge decision={disagreement.groundTruth} />
                        </td>
                        {resultEntries.map(([promptId]) => {
                          const decision = disagreement.decisions.get(promptId) ?? null;
                          return (
                            <td key={promptId} className="text-center py-2 px-3">
                              <DecisionBadge decision={decision || "PARSE_FAIL"} />
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
                      <th className="text-left py-1.5 px-2">Preview</th>
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
                          const resolvedGroundTruth = getResolvedGroundTruth(p);
                          const correct =
                            resolvedGroundTruth != null &&
                            p.parse_ok &&
                            p.predicted_decision === resolvedGroundTruth;
                          return (
                            <tr key={p.prediction_id} className="border-b border-gray-800/50">
                              <td className="py-1.5 px-2 font-mono">{p.image_id}</td>
                              <td className="py-1.5 px-2">
                                {p.image_uri ? (
                                  <img
                                    src={p.image_uri}
                                    alt={p.image_id}
                                    className="w-12 h-9 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-80"
                                    onClick={() => setPreviewState({ promptId, imageId: p.image_id, source: "full" })}
                                  />
                                ) : (
                                  <span className="text-gray-600">—</span>
                                )}
                              </td>
                              <td className="text-center py-1.5 px-2">
                                <DecisionBadge decision={resolvedGroundTruth} />
                              </td>
                              <td className="text-center py-1.5 px-2">
                                <DecisionBadge decision={p.predicted_decision || "PARSE_FAIL"} />
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
                              <td className="py-1.5 px-2 text-gray-400">
                                <div className="max-w-[320px] max-h-16 overflow-y-auto whitespace-pre-wrap break-words">
                                  {p.evidence || "—"}
                                </div>
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

      {previewState && activePreviewImageIds.length > 0 && activePreviewPrediction && (
        <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto flex items-start justify-center p-6">
          <button className="absolute inset-0" onClick={() => setPreviewState(null)} aria-label="Close preview" />
          <div className="relative z-10 w-full max-w-7xl max-h-[calc(100vh-3rem)] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-4 my-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-gray-400">
                {previewState.source === "disagreement" ? "Disagreement Cases" : promptLabelById.get(previewState.promptId) || previewState.promptId.slice(0, 8)} ·{" "}
                {Math.max(activePreviewIndex, 0) + 1}/{activePreviewImageIds.length} · {activePreviewPrediction.image_id}
              </div>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded"
                  onClick={() => {
                    if (activePreviewIndex < 0) return;
                    const nextIndex = Math.max(0, activePreviewIndex - 1);
                    setPreviewState((prev) =>
                      prev ? { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId } : prev
                    );
                  }}
                  disabled={activePreviewIndex <= 0}
                >
                  Prev
                </button>
                <button
                  className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded"
                  onClick={() => {
                    if (activePreviewIndex < 0) return;
                    const nextIndex = Math.min(activePreviewImageIds.length - 1, activePreviewIndex + 1);
                    setPreviewState((prev) =>
                      prev ? { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId } : prev
                    );
                  }}
                  disabled={activePreviewIndex >= activePreviewImageIds.length - 1}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4 min-w-[980px]">
              <div className="space-y-2 max-h-[70vh] overflow-y-auto w-80 shrink-0">
                {activePreviewImageIds.map((imageId, idx) => {
                  const row = getPredictionForImage(previewState.promptId, imageId);
                  const firstWithImage =
                    row ||
                    resultEntries
                      .map(([promptId]) => getPredictionForImage(promptId, imageId))
                      .find((p) => !!p?.image_uri) ||
                    null;
                  return (
                  <button
                    key={`${imageId}-${idx}`}
                    className={`w-full text-left p-2 rounded border ${
                      idx === activePreviewIndex
                        ? "border-blue-500 bg-blue-900/20"
                        : "border-gray-700 bg-gray-900/40 hover:border-gray-600"
                    }`}
                    onClick={() => setPreviewState((prev) => (prev ? { ...prev, imageId } : prev))}
                  >
                    <div className="text-[11px] font-mono text-gray-300 truncate">{imageId}</div>
                    {firstWithImage?.image_uri ? (
                      <img
                        src={firstWithImage.image_uri}
                        alt={imageId}
                        className="mt-1 w-full h-16 object-cover rounded border border-gray-700"
                      />
                    ) : null}
                    <div className="mt-1 space-y-1">
                      {resultEntries.map(([promptId]) => {
                        const prediction = getPredictionForImage(promptId, imageId);
                        return (
                          <div key={`${imageId}-${promptId}`} className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 min-w-0 truncate">
                              {promptLabelById.get(promptId) || promptId.slice(0, 8)}:
                            </span>
                            <DecisionBadge decision={prediction?.predicted_decision || "PARSE_FAIL"} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      GT: {(firstWithImage ? getResolvedGroundTruth(firstWithImage) : null) || "UNSET"}
                    </div>
                  </button>
                  );
                })}
              </div>
              <div className="space-y-3 min-w-0">
                <div className="bg-gray-950 rounded border border-gray-800 p-2">
                  <img
                    src={activePreviewPrediction.image_uri}
                    alt={activePreviewPrediction.image_id}
                    className="w-full max-h-[56vh] object-contain rounded"
                  />
                </div>
                <div className="bg-gray-950 rounded border border-gray-800 p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Ground Truth:</span>
                    <DecisionBadge decision={activeGroundTruth} />
                  </div>
                  <div className="space-y-2">
                    <div className="text-gray-500 mb-1">Outcomes by Version</div>
                    {activePromptOutcomes.map(({ promptId, prediction }) => (
                      <div key={promptId} className="border border-gray-800 rounded p-2 space-y-2">
                        <div className="text-gray-400">{promptLabelById.get(promptId) || promptId.slice(0, 8)}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Prediction:</span>
                          <DecisionBadge decision={prediction?.predicted_decision || "PARSE_FAIL"} />
                          <span className="text-gray-500">
                            {prediction?.confidence != null ? Number(prediction.confidence).toFixed(2) : "—"}
                          </span>
                          <span className={`${prediction?.parse_ok ? "text-green-400" : "text-red-400"}`}>
                            {prediction?.parse_ok ? "OK" : "FAIL"}
                          </span>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Evidence</div>
                          <div className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-gray-300">
                            {prediction?.evidence || "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Model Output</div>
                          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-black/20 rounded p-2 text-gray-300">
                            {formatModelOutput(prediction?.raw_response || "")}
                          </pre>
                        </div>
                        <div className="space-y-1 text-gray-300">
                          <div><span className="text-gray-500">Parse:</span> {prediction?.parse_ok ? "OK" : "FAIL"}</div>
                          {!prediction?.parse_ok && (
                            <>
                              <div><span className="text-gray-500">Parse Reason:</span> {prediction?.parse_error_reason || "Parse failed"}</div>
                              <div><span className="text-gray-500">Fix Suggestion:</span> {prediction?.parse_fix_suggestion || "Return strict JSON only."}</div>
                            </>
                          )}
                        </div>
                        <div className="space-y-1 text-gray-300">
                          <div className="text-gray-500">HIL Review</div>
                          <div>Error tag: {prediction?.error_tag || "—"}</div>
                          <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words">
                            Reviewer note: {prediction?.reviewer_note || "—"}
                          </div>
                          <div>Corrected at: {prediction?.corrected_at ? new Date(prediction.corrected_at).toLocaleString() : "—"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!activePromptOutcomes.some((x) => x.prediction) && (
                    <div className="text-gray-500">No prompt outcomes available for this image.</div>
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
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

function getResolvedGroundTruth(prediction: Prediction): string | null {
  return prediction.corrected_label || prediction.ground_truth_label || null;
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
