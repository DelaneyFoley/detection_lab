"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { ConfusionMatrixPanel } from "@/components/MetricsDisplay";
import { DecisionBadge } from "@/components/shared/DecisionBadge";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import type { Detection, PromptVersion, Dataset, MetricsSummary, Run, Prediction } from "@/types";
import { splitTypeBadgeClass, splitTypeLabel } from "@/lib/splitType";
import { fmtMetric, formatModelOutput, getResolvedGroundTruth, safeJsonArray } from "@/lib/ui/review";

export function PromptCompare({ detection }: { detection: Detection }) {
  const { refreshCounter } = useAppStore();
  const { notify } = useAppFeedback();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Map<string, { run: any; predictions: Prediction[] }>>(new Map());
  const [previewState, setPreviewState] = useState<
    { promptId: string; imageId: string; source: "disagreement" | "full" } | null
  >(null);
  const runningRef = useRef(false);
  const loadDataKeyRef = useRef("");

  const loadData = useCallback(async () => {
    if (!detection?.detection_id) return;
    const [pRes, dRes, rRes] = await Promise.all([
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
      fetch(`/api/datasets?detection_id=${detection.detection_id}&include_unassigned=1`),
      fetch(`/api/runs?detection_id=${detection.detection_id}`),
    ]);
    const ps = await safeJsonArray<PromptVersion>(pRes, "prompts");
    const ds = await safeJsonArray<Dataset>(dRes, "datasets");
    const rs = await safeJsonArray<Run>(rRes, "runs");
    const nextDatasets = ds.filter(
      (d: Dataset) =>
        d.split_type === "GOLDEN" ||
        d.split_type === "ITERATION" ||
        d.split_type === "HELD_OUT_EVAL" ||
        d.split_type === "CUSTOM"
    );
    const nextRuns = rs.filter((r: Run) => r.status === "completed");
    const nextKey = JSON.stringify({
      prompts: ps.map((p) => p.prompt_version_id),
      datasets: nextDatasets.map((d) => `${d.dataset_id}:${d.updated_at}`),
      runs: nextRuns.map((r) => `${r.run_id}:${r.status}:${r.processed_images}`),
    });
    if (loadDataKeyRef.current === nextKey) return;
    loadDataKeyRef.current = nextKey;

    setPrompts(ps);
    setDatasets(nextDatasets);
    setRuns(nextRuns);
  }, [detection.detection_id]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshCounter]);

  const togglePrompt = (id: string) => {
    setSelectedPromptIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const comparableDatasetIds = useMemo(() => {
    if (selectedPromptIds.length === 0) return new Set<string>();
    const datasetSets = selectedPromptIds.map((promptId) => {
      const ids = new Set<string>();
      for (const run of runs) {
        if (run.prompt_version_id === promptId && run.dataset_id) {
          ids.add(run.dataset_id);
        }
      }
      return ids;
    });
    const intersection = new Set<string>(datasetSets[0] || []);
    for (const id of Array.from(intersection)) {
      if (datasetSets.some((s) => !s.has(id))) {
        intersection.delete(id);
      }
    }
    return intersection;
  }, [runs, selectedPromptIds]);

  const comparableDatasets = useMemo(() => {
    return datasets.filter((d) => comparableDatasetIds.has(d.dataset_id));
  }, [datasets, comparableDatasetIds]);

  useEffect(() => {
    if (!selectedDatasetId) return;
    const stillVisible = comparableDatasets.some((d) => d.dataset_id === selectedDatasetId);
    if (!stillVisible) setSelectedDatasetId("");
  }, [selectedDatasetId, comparableDatasets]);

  const runComparison = async () => {
    if (runningRef.current) return;
    if (selectedPromptIds.length < 1) {
      notify({ message: "Select at least 1 prompt version.", tone: "warning" });
      return;
    }
    if (!selectedDatasetId) {
      notify({ message: "Select a dataset.", tone: "warning" });
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setResults(new Map());
    try {
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
        notify({
          message:
            "No completed runs found for the selected prompt(s) and dataset. Run them first in Detection Setup or Build & Run Datasets.",
          tone: "warning",
        });
      }
    } catch (err) {
      console.error("Failed to load comparison runs:", err);
      notify({ message: "Failed to load comparison runs.", tone: "error" });
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
  const disagreements = useMemo(() => {
    const next = new Map<
      string,
      { decisions: Map<string, string | null>; sample: Prediction | null; groundTruth: string | null }
    >();
    if (resultEntries.length < 2) return next;

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
        next.set(imageId, {
          decisions,
          sample,
          groundTruth: sample ? getResolvedGroundTruth(sample) : null,
        });
      }
    }
    return next;
  }, [resultEntries]);

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
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Prompt Compare</h2>
          <p className="app-page-copy">
            Compare the latest existing completed runs across prompt versions on the same dataset to understand performance tradeoffs.
            Prompt Compare does not create new runs.
          </p>
        </div>
      </div>

      {/* Config */}
      <div className="app-section">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Prompt selection */}
          <div>
            <h3 className="app-label mb-2">Select 2–4 Prompt Versions</h3>
            <div className="max-h-48 overflow-y-auto border-y border-[var(--app-border)]">
              {prompts.map((p) => (
                <label
                  key={p.prompt_version_id}
                  className={`flex cursor-pointer items-center gap-2 border-b border-[var(--app-border)] px-2 py-3 text-sm last:border-b-0 ${
                    selectedPromptIds.includes(p.prompt_version_id)
                      ? "bg-[rgba(18,42,68,0.62)]"
                      : "hover:bg-[rgba(255,255,255,0.02)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedPromptIds.includes(p.prompt_version_id)}
                    onChange={() => togglePrompt(p.prompt_version_id)}
                    className="rounded"
                  />
                  <span>{p.version_label}</span>
                  <span className="text-xs text-[var(--app-text-subtle)]">{p.model} | temp={p.temperature}</span>
                  {p.prompt_version_id === detection.approved_prompt_version && (
                    <span className="ml-auto text-xs text-[var(--app-success)]">APPROVED</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Dataset selection */}
          <div>
            <h3 className="app-label mb-2">Select Dataset</h3>
            <div className="border-y border-[var(--app-border)]">
              {comparableDatasets.map((d) => (
                <label
                  key={d.dataset_id}
                  className={`flex cursor-pointer items-center gap-2 border-b border-[var(--app-border)] px-2 py-3 text-sm last:border-b-0 ${
                    selectedDatasetId === d.dataset_id
                      ? "bg-[rgba(18,42,68,0.62)]"
                      : "hover:bg-[rgba(255,255,255,0.02)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="dataset"
                    checked={selectedDatasetId === d.dataset_id}
                    onChange={() => setSelectedDatasetId(d.dataset_id)}
                  />
                  <span>{d.name}</span>
                  <span className="text-xs text-[var(--app-text-subtle)]">{d.size} images</span>
                  <span className={`ml-auto ${splitTypeBadgeClass(d.split_type)}`}>
                    {splitTypeLabel(d.split_type)}
                  </span>
                </label>
              ))}
              {selectedPromptIds.length > 0 && comparableDatasets.length === 0 && (
                <p className="py-3 text-xs text-[var(--app-text-muted)]">
                  No shared datasets with completed runs for the selected prompt versions.
                </p>
              )}
            </div>

          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={runComparison}
            disabled={running || selectedPromptIds.length < 1 || !selectedDatasetId}
            className="app-btn app-btn-success app-btn-md text-sm"
          >
            {running ? "Loading..." : "Compare Latest Runs"}
          </button>
          {progress && <span className="text-sm text-[var(--app-text-muted)]">{progress}</span>}
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
                <CompareResultSheet
                  key={promptId}
                  metrics={run.metrics_summary}
                  title={prompt?.version_label || promptId.slice(0, 8)}
                  subtitle={run?.model_used || prompt?.model || "unknown-model"}
                />
              );
            })}
          </div>

          {/* Metric Deltas */}
          {resultEntries.length >= 2 && (
            <div className="app-card-strong p-5">
              <h3 className="text-sm font-medium mb-3">Metric Deltas (vs first prompt)</h3>
              <div className="app-table-wrap overflow-x-auto">
                <table className="app-table app-table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: "12rem" }} />
                    <col style={{ width: "7rem" }} />
                    <col style={{ width: "7rem" }} />
                    <col style={{ width: "7rem" }} />
                    <col style={{ width: "7rem" }} />
                    <col style={{ width: "8rem" }} />
                    <col style={{ width: "8rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="app-table-col-label">Prompt</th>
                      <th className="app-table-col-label">Accuracy</th>
                      <th className="app-table-col-label">Precision</th>
                      <th className="app-table-col-label">Recall</th>
                      <th className="app-table-col-label">F1</th>
                      <th className="app-table-col-label">Prevalence</th>
                      <th className="app-table-col-label">Parse Fail %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultEntries.map(([promptId, { run }], i) => {
                      const prompt = prompts.find((p) => p.prompt_version_id === promptId);
                      const m = run.metrics_summary as MetricsSummary;
                      const base = (resultEntries[0][1].run.metrics_summary as MetricsSummary);
                      const isBase = i === 0;

                      return (
                        <tr key={promptId}>
                          <td className="font-medium">
                            {prompt?.version_label}
                            {isBase && <span className="text-xs text-gray-500 ml-1">(baseline)</span>}
                          </td>
                          <td className="app-table-col-label">
                            <div className="space-y-0.5 tabular-nums">
                              <div>{fmtMetric(m, "accuracy")}</div>
                              {!isBase && fmtMetric(m, "accuracy") !== "N/A" && fmtMetric(base, "accuracy") !== "N/A" && (
                                <div><Delta value={m.accuracy - base.accuracy} /></div>
                              )}
                            </div>
                          </td>
                          <td className="app-table-col-label">
                            <div className="space-y-0.5 tabular-nums">
                              <div>{fmtMetric(m, "precision")}</div>
                              {!isBase && fmtMetric(m, "precision") !== "N/A" && fmtMetric(base, "precision") !== "N/A" && (
                                <div><Delta value={m.precision - base.precision} /></div>
                              )}
                            </div>
                          </td>
                          <td className="app-table-col-label">
                            <div className="space-y-0.5 tabular-nums">
                              <div>{fmtMetric(m, "recall")}</div>
                              {!isBase && fmtMetric(m, "recall") !== "N/A" && fmtMetric(base, "recall") !== "N/A" && (
                                <div><Delta value={m.recall - base.recall} /></div>
                              )}
                            </div>
                          </td>
                          <td className="app-table-col-label">
                            <div className="space-y-0.5 tabular-nums">
                              <div>{fmtMetric(m, "f1")}</div>
                              {!isBase && fmtMetric(m, "f1") !== "N/A" && fmtMetric(base, "f1") !== "N/A" && (
                                <div><Delta value={m.f1 - base.f1} /></div>
                              )}
                            </div>
                          </td>
                          <td className="app-table-col-label">
                            <div className="space-y-0.5 tabular-nums">
                              <div>{fmtMetric(m, "prevalence")}</div>
                              {!isBase && fmtMetric(m, "prevalence") !== "N/A" && fmtMetric(base, "prevalence") !== "N/A" && (
                                <div><Delta value={m.prevalence - base.prevalence} /></div>
                              )}
                            </div>
                          </td>
                          <td className="app-table-col-label">
                            <div className="tabular-nums">{fmtMetric(m, "parse_failure_rate")}</div>
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
            <div className="app-card-strong p-5">
              <h3 className="text-sm font-medium mb-3">
                Disagreement Cases ({disagreements.size} images)
              </h3>
              <div className="app-table-wrap max-h-96 overflow-x-auto overflow-y-auto">
                <table className="app-table app-table-fixed text-xs">
                  <colgroup>
                    <col style={{ width: "8rem" }} />
                    <col style={{ width: "14rem" }} />
                    <col style={{ width: "10rem" }} />
                    {resultEntries.map(([promptId]) => (
                      <col key={promptId} style={{ width: "10rem" }} />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0">
                    <tr>
                      <th className="app-table-col-label">Preview</th>
                      <th className="app-table-col-label">Image ID</th>
                      <th className="app-table-col-label">Ground Truth</th>
                      {resultEntries.map(([promptId]) => {
                        const prompt = prompts.find((p) => p.prompt_version_id === promptId);
                        return (
                          <th key={promptId} className="app-table-col-label">
                            {prompt?.version_label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(disagreements.entries()).map(([imageId, disagreement]) => (
                      <tr key={imageId}>
                        <td>
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
                        <td className="font-mono">{imageId}</td>
                        <td className="app-table-col-label">
                          <DecisionBadge decision={disagreement.groundTruth} />
                        </td>
                        {resultEntries.map(([promptId]) => {
                          const decision = disagreement.decisions.get(promptId) ?? null;
                          return (
                            <td key={promptId} className="app-table-col-label">
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
          <div className="app-card-strong p-5">
            <h3 className="text-sm font-medium mb-3">Full Outcomes</h3>
            {resultEntries.map(([promptId, { predictions }]) => {
              const prompt = prompts.find((p) => p.prompt_version_id === promptId);
              return (
                <details key={promptId} className="mb-3">
                  <summary className="cursor-pointer text-sm text-gray-300 hover:text-white">
                    {prompt?.version_label} — {predictions.length} predictions
                  </summary>
                  <div className="mt-2 app-table-wrap max-h-72 overflow-x-auto overflow-y-auto">
                    <table className="app-table app-table-fixed text-xs">
                      <colgroup>
                        <col style={{ width: "8rem" }} />
                        <col style={{ width: "12rem" }} />
                        <col style={{ width: "10rem" }} />
                        <col style={{ width: "10rem" }} />
                        <col style={{ width: "5.5rem" }} />
                        <col style={{ width: "6.5rem" }} />
                        <col />
                        <col style={{ width: "5.5rem" }} />
                      </colgroup>
                      <thead className="sticky top-0">
                        <tr>
                          <th className="app-table-col-label">Preview</th>
                          <th className="app-table-col-label">Image ID</th>
                          <th className="app-table-col-label">Ground Truth</th>
                          <th className="app-table-col-label">Prediction</th>
                          <th className="app-table-col-label">Correct</th>
                          <th className="app-table-col-label">Confidence</th>
                          <th className="app-table-col-label">Evidence</th>
                          <th className="app-table-col-label">Parse</th>
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
                            <tr key={p.prediction_id} className={!correct ? "app-table-row-alert" : ""}>
                              <td>
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
                              <td className="font-mono">{p.image_id}</td>
                              <td className="app-table-col-label">
                                <DecisionBadge decision={resolvedGroundTruth} />
                              </td>
                              <td className="app-table-col-label">
                                <DecisionBadge decision={p.predicted_decision || "PARSE_FAIL"} />
                              </td>
                              <td className="app-table-col-label">
                                {correct ? (
                                  <span className="text-green-400">✓</span>
                                ) : (
                                  <span className="text-red-400">✗</span>
                                )}
                              </td>
                              <td className="app-table-col-label tabular-nums">
                                {p.confidence != null ? p.confidence.toFixed(2) : "—"}
                              </td>
                              <td className="text-gray-400">
                                <div className="max-w-[320px] max-h-16 overflow-y-auto whitespace-pre-wrap break-words">
                                  {p.evidence || "—"}
                                </div>
                              </td>
                              <td className="app-table-col-label">
                                {p.parse_ok ? (
                                  <span className="app-status-ok">OK</span>
                                ) : (
                                  <span className="app-status-fail">FAIL</span>
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

      <ImagePreviewModal
        isOpen={!!previewState && activePreviewImageIds.length > 0 && !!activePreviewPrediction}
        imageUrl={activePreviewPrediction?.image_uri || ""}
        imageAlt={activePreviewPrediction?.image_id || "Preview"}
        title={
          previewState
            ? previewState.source === "disagreement"
              ? "Disagreement Cases"
              : promptLabelById.get(previewState.promptId) || previewState.promptId.slice(0, 8)
            : "Prompt Compare"
        }
        subtitle={activePreviewPrediction?.image_id || ""}
        index={Math.max(activePreviewIndex, 0)}
        total={activePreviewImageIds.length}
        onClose={() => setPreviewState(null)}
        onPrev={() => {
          if (activePreviewIndex < 0) return;
          const nextIndex = Math.max(0, activePreviewIndex - 1);
          setPreviewState((prev) => (prev ? { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId } : prev));
        }}
        onNext={() => {
          if (activePreviewIndex < 0) return;
          const nextIndex = Math.min(activePreviewImageIds.length - 1, activePreviewIndex + 1);
          setPreviewState((prev) => (prev ? { ...prev, imageId: activePreviewImageIds[nextIndex] || prev.imageId } : prev));
        }}
        details={
          <div className="space-y-2">
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
                    <span className="text-gray-500">{prediction?.confidence != null ? Number(prediction.confidence).toFixed(2) : "—"}</span>
                    <span className={prediction?.parse_ok ? "app-status-ok" : "app-status-fail"}>{prediction?.parse_ok ? "OK" : "FAIL"}</span>
                  </div>
                  <div>
                    <div className="text-gray-500 mb-1">Evidence</div>
                    <div className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-gray-300">{prediction?.evidence || "—"}</div>
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
                    <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words">Reviewer note: {prediction?.reviewer_note || "—"}</div>
                    <div>Corrected at: {prediction?.corrected_at ? new Date(prediction.corrected_at).toLocaleString() : "—"}</div>
                  </div>
                </div>
              ))}
            </div>
            {!activePromptOutcomes.some((x) => x.prediction) && <div className="text-gray-500">No prompt outcomes available for this image.</div>}
          </div>
        }
      />
    </div>
  );
}

function Delta({ value }: { value: number }) {
  const pct = (value * 100).toFixed(1);
  const color = value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-gray-500";
  return (
    <span className={`text-xs ${color}`}>
      ({value > 0 ? "+" : ""}{pct})
    </span>
  );
}

function CompareResultSheet({
  metrics,
  title,
  subtitle,
}: {
  metrics: MetricsSummary;
  title: string;
  subtitle: string;
}) {
  const attributeEntries = Object.entries(metrics.segment_metrics || {}).sort(([, a], [, b]) => b.total - a.total);

  return (
    <div className="app-section space-y-4">
      <div className="space-y-1">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="text-sm text-[var(--app-text-muted)]">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-white/8 pt-4 sm:grid-cols-5">
        <SheetMetric label="Accuracy" value={fmtMetric(metrics, "accuracy")} tone="text-white" />
        <SheetMetric label="Precision" value={fmtMetric(metrics, "precision")} tone="text-white" />
        <SheetMetric label="Recall" value={fmtMetric(metrics, "recall")} tone="text-white" />
        <SheetMetric label="F1 Score" value={fmtMetric(metrics, "f1")} tone="text-white" />
        <SheetMetric label="Prevalence" value={fmtMetric(metrics, "prevalence")} tone="text-white" />
      </div>

      <div className="space-y-3 border-t border-white/8 pt-4">
        <ConfusionMatrixPanel metrics={metrics} embedded />
      </div>

      <div className="space-y-3 border-t border-white/8 pt-4">
        <div>
          <div className="app-label mb-1">Attribute Breakdown</div>
          <p className="text-[11px] text-[var(--app-text-subtle)]">
            Images with multiple attributes are counted in each attribute.
          </p>
        </div>

        {attributeEntries.length > 0 ? (
          <div className="app-metric-breakdown text-[11px]">
            <div
              className="app-metric-breakdown-row app-metric-breakdown-head"
              style={{ gridTemplateColumns: "minmax(130px, 1.6fr) repeat(5, minmax(0, 1fr)) minmax(92px, 1.05fr)" }}
            >
              <div className="app-metric-breakdown-cell app-metric-breakdown-label">Attribute</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">Total</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">Accuracy</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">Precision</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">Recall</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">F1</div>
              <div className="app-metric-breakdown-cell app-metric-breakdown-value whitespace-nowrap">Parse Fail</div>
            </div>
            <div className="app-metric-breakdown-body">
              {attributeEntries.map(([attribute, value]) => (
                <div
                  key={attribute}
                  className="app-metric-breakdown-row"
                  style={{ gridTemplateColumns: "minmax(130px, 1.6fr) repeat(5, minmax(0, 1fr)) minmax(92px, 1.05fr)" }}
                >
                  <div className="app-metric-breakdown-cell app-metric-breakdown-label break-words text-[var(--app-text)]">
                    {attribute}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text-muted)]">
                    {value.total}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-gray-200">
                    {fmtMetric(value, "accuracy")}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">
                    {fmtMetric(value, "precision")}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">
                    {fmtMetric(value, "recall")}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">
                    {fmtMetric(value, "f1")}
                  </div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">
                    {fmtMetric(value, "parse_failure_rate")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--app-text-muted)]">No attribute breakdown available for this run.</div>
        )}
      </div>
    </div>
  );
}

function SheetMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="space-y-1">
      <div className={`text-[1.5rem] font-semibold tracking-tight ${tone}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--app-text-subtle)]">{label}</div>
    </div>
  );
}
