"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Run, Prediction, ErrorTag, Decision } from "@/types";
import { computeMetricsWithSegments } from "@/lib/metrics";
import { splitTypeLabel } from "@/lib/splitType";

const ERROR_TAGS: ErrorTag[] = [
  "MISSED_DETECTION",
  "FALSE_POSITIVE",
  "INFERENCE_CALL_FAILED",
  "AMBIGUOUS_IMAGE",
  "LABEL_POLICY_GAP",
  "PROMPT_INSTRUCTION_GAP",
  "SCHEMA_VIOLATION",
];
const AUTO_ERROR_TAGS = new Set<ErrorTag>([
  "MISSED_DETECTION",
  "FALSE_POSITIVE",
  "SCHEMA_VIOLATION",
  "INFERENCE_CALL_FAILED",
]);

type FilterType = "all" | "fp" | "fn" | "parse_fail" | "correct" | "corrected";

export function HilReview({ detection }: { detection: Detection }) {
  const { selectedRunByDetection, setSelectedRunForDetection, triggerRefresh, refreshCounter } = useAppStore();
  const [runs, setRuns] = useState<Run[]>([]);
  const [promptLabelById, setPromptLabelById] = useState<Record<string, string>>({});
  const persistedRunId = selectedRunByDetection[detection.detection_id] || "";
  const [selectedRunId, setSelectedRunId] = useState(persistedRunId);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<"table" | "image">("table");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runData, setRunData] = useState<any>(null);
  const [datasetItemByImageId, setDatasetItemByImageId] = useState<Record<string, { item_id: string; segment_tags: string[] }>>({});
  const [loadingRun, setLoadingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const liveMetrics = useMemo(() => {
    const segmentMap = new Map<string, string[]>();
    for (const [imageId, item] of Object.entries(datasetItemByImageId || {})) {
      segmentMap.set(imageId, normalizeSegmentTags(item.segment_tags));
    }
    return computeMetricsWithSegments(predictions, segmentMap);
  }, [predictions, datasetItemByImageId]);
  const labeledCount = useMemo(
    () =>
      predictions.filter(
        (p) =>
          (p.corrected_label || p.ground_truth_label) === "DETECTED" ||
          (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
      ).length,
    [predictions]
  );

  const loadRuns = useCallback(async () => {
    const [runsRes, promptsRes] = await Promise.all([
      fetch(`/api/runs?detection_id=${detection.detection_id}`),
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
    ]);
    const data = await runsRes.json();
    const prompts = await promptsRes.json();
    setRuns(data.filter((r: Run) => r.status === "completed"));
    const next: Record<string, string> = {};
    if (Array.isArray(prompts)) {
      for (const p of prompts) {
        if (p?.prompt_version_id && p?.version_label) next[p.prompt_version_id] = p.version_label;
      }
    }
    setPromptLabelById(next);
  }, [detection.detection_id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns, refreshCounter]);

  useEffect(() => {
    setSelectedRunId(persistedRunId);
  }, [persistedRunId]);

  const loadRun = useCallback(async () => {
    if (!selectedRunId) {
      setRunData(null);
      setPredictions([]);
      setDatasetItemByImageId({});
      setRunError(null);
      return;
    }

    setLoadingRun(true);
    setRunError(null);
    try {
      const res = await fetch(`/api/runs?run_id=${selectedRunId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load run");
      }
      setRunData(data);
      setPredictions(
        Array.isArray(data.predictions)
          ? data.predictions.map((p: Prediction) => withAutoErrorTag(p))
          : []
      );
      if (data?.dataset_id) {
        const datasetRes = await fetch(`/api/datasets?dataset_id=${data.dataset_id}`);
        const datasetPayload = await datasetRes.json();
        const items = Array.isArray(datasetPayload?.items) ? datasetPayload.items : [];
        const nextByImageId: Record<string, { item_id: string; segment_tags: string[] }> = {};
        for (const item of items) {
          const imageId = String(item?.image_id || "");
          if (!imageId) continue;
          nextByImageId[imageId] = {
            item_id: String(item?.item_id || ""),
            segment_tags: normalizeSegmentTags(item?.segment_tags),
          };
        }
        setDatasetItemByImageId(nextByImageId);
      } else {
        setDatasetItemByImageId({});
      }
      setCurrentIndex(0);
    } catch (error) {
      setRunData(null);
      setPredictions([]);
      setDatasetItemByImageId({});
      setRunError(error instanceof Error ? error.message : "Failed to load run");
    } finally {
      setLoadingRun(false);
    }
  }, [selectedRunId]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (selectedRunId) {
      setSelectedRunForDetection(detection.detection_id, selectedRunId);
    }
  }, [selectedRunId, detection.detection_id, setSelectedRunForDetection]);

  const filteredPredictions = predictions.filter((p) => {
    const gt = p.corrected_label || p.ground_truth_label;
    switch (filter) {
      case "fp": return p.parse_ok && p.predicted_decision === "DETECTED" && gt === "NOT_DETECTED";
      case "fn": return p.parse_ok && p.predicted_decision === "NOT_DETECTED" && gt === "DETECTED";
      case "parse_fail": return !p.parse_ok && !isInferenceCallFailure(p);
      case "correct": return p.parse_ok && p.predicted_decision === gt;
      case "corrected": return p.corrected_label !== null;
      default: return true;
    }
  });

  const updatePrediction = async (predictionId: string, updates: Partial<{
    corrected_label: Decision | null;
    ground_truth_label: Decision | null;
    error_tag: ErrorTag | null;
    reviewer_note: string | null;
    update_ground_truth: boolean;
  }>) => {
    const res = await fetch("/api/hil", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prediction_id: predictionId,
        ...updates,
        update_ground_truth:
          updates.update_ground_truth ??
          (Object.prototype.hasOwnProperty.call(updates, "ground_truth_label")
            ? true
            : runData?.split_type === "ITERATION"),
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("Failed to update prediction", payload);
      return;
    }

    // Refresh predictions
    setPredictions((prev) =>
      prev.map((p) => {
        if (p.prediction_id !== predictionId) return p;
        const next: Prediction = {
          ...p,
          corrected_label: updates.corrected_label !== undefined ? updates.corrected_label : p.corrected_label,
          ground_truth_label:
            updates.ground_truth_label !== undefined ? updates.ground_truth_label : p.ground_truth_label,
          error_tag: updates.error_tag !== undefined ? updates.error_tag : p.error_tag,
          reviewer_note: updates.reviewer_note !== undefined ? updates.reviewer_note : p.reviewer_note,
          corrected_at: new Date().toISOString(),
        };

        // Keep manual tags; auto-populate/refresh only when tag is empty or currently auto-generated.
        if (updates.error_tag === undefined && (!next.error_tag || AUTO_ERROR_TAGS.has(next.error_tag))) {
          const auto = deriveAutoErrorTag(next);
          next.error_tag = auto;
        }
        return next;
      })
    );

    if (payload?.run_id && payload?.metrics) {
      setRunData((prev: any) =>
        prev && prev.run_id === payload.run_id
          ? { ...prev, metrics_summary: payload.metrics }
          : prev
      );
    }

    const metricsImpactingUpdate =
      Object.prototype.hasOwnProperty.call(updates, "ground_truth_label") ||
      Object.prototype.hasOwnProperty.call(updates, "corrected_label");
    if (metricsImpactingUpdate) {
      loadRuns();
      triggerRefresh();
    }
  };

  const currentPrediction = filteredPredictions[currentIndex];
  const currentDatasetItem = currentPrediction ? datasetItemByImageId[currentPrediction.image_id] : null;

  const updateSegmentTagsForImage = async (imageId: string, nextTags: string[]) => {
    const item = datasetItemByImageId[imageId];
    if (!item?.item_id) return;
    const normalized = normalizeSegmentTags(nextTags);
    const res = await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: item.item_id,
        segment_tags: normalized,
      }),
    });
    if (!res.ok) return;
    setDatasetItemByImageId((prev) => ({
      ...prev,
      [imageId]: {
        ...prev[imageId],
        segment_tags: normalized,
      },
    }));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Human-in-the-Loop Review</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("table")}
            className={`px-3 py-1.5 text-sm rounded ${viewMode === "table" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"}`}
          >
            Table View
          </button>
          <button
            onClick={() => setViewMode("image")}
            className={`px-3 py-1.5 text-sm rounded ${viewMode === "image" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"}`}
          >
            Image Review
          </button>
        </div>
      </div>

      {/* Run Selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <label className="text-xs text-gray-400">Select Run:</label>
          <select
            className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm flex-1"
            value={selectedRunId}
            onChange={(e) => {
              const nextRunId = e.target.value;
              setSelectedRunId(nextRunId);
              if (nextRunId) {
                setSelectedRunForDetection(detection.detection_id, nextRunId);
              }
            }}
          >
            <option value="">Choose a run...</option>
            {runs.map((r: any) => (
              <option key={r.run_id} value={r.run_id}>
                {(promptLabelById[r.prompt_version_id] || r.prompt_version_id?.slice(0, 8) || "Unknown prompt")} — {r.run_id.slice(0, 8)} — {splitTypeLabel(r.split_type)} — F1: {((r.metrics_summary?.f1 || 0) * 100).toFixed(1)}% — {new Date(r.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        {/* Filters */}
        {predictions.length > 0 && (
          <div className="flex gap-2 mt-3">
            {([
              ["all", "All"],
              ["fp", "False Positives"],
              ["fn", "False Negatives"],
              ["parse_fail", "Parse Failures"],
              ["correct", "Correct"],
              ["corrected", "Corrected"],
            ] as [FilterType, string][]).map(([key, label]) => {
              const count = predictions.filter((p) => {
                const gt = p.corrected_label || p.ground_truth_label;
                switch (key) {
                  case "fp": return p.parse_ok && p.predicted_decision === "DETECTED" && gt === "NOT_DETECTED";
                  case "fn": return p.parse_ok && p.predicted_decision === "NOT_DETECTED" && gt === "DETECTED";
                  case "parse_fail": return !p.parse_ok && !isInferenceCallFailure(p);
                  case "correct": return p.parse_ok && p.predicted_decision === gt;
                  case "corrected": return p.corrected_label !== null;
                  default: return true;
                }
              }).length;

              return (
                <button
                  key={key}
                  onClick={() => { setFilter(key); setCurrentIndex(0); }}
                  className={`px-3 py-1 text-xs rounded-full ${
                    filter === key
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Table View */}
      {viewMode === "table" && predictions.length > 0 && (
        <div className="space-y-3">
          <div className="p-1">
            <div className="grid grid-cols-7 gap-3">
              <div className="text-center">
                <div className="text-2xl font-semibold text-white">{labeledCount}/{predictions.length}</div>
                <div className="text-xs text-gray-500">Labeled</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-gray-200">{(liveMetrics.accuracy * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-blue-400">{(liveMetrics.precision * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Precision</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-green-400">{(liveMetrics.recall * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Recall</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-yellow-400">{(liveMetrics.f1 * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">F1 Score</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-purple-300">{(liveMetrics.prevalence * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500">Prevalence</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-semibold ${liveMetrics.parse_failure_rate > 0 ? "text-orange-300" : "text-gray-200"}`}>
                  {(liveMetrics.parse_failure_rate * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Parse Fail Rate</div>
              </div>
            </div>
            {Object.keys(liveMetrics.segment_metrics || {}).length > 0 && (
              <details className="mt-3 bg-gray-900/40 border border-gray-800 rounded p-2">
                <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300">
                  Segment Breakdown
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500 border-b border-gray-800">
                      <tr>
                        <th className="text-left py-1.5 px-2">Segment</th>
                        <th className="text-right py-1.5 px-2">Total</th>
                        <th className="text-right py-1.5 px-2">Accuracy</th>
                        <th className="text-right py-1.5 px-2">Precision</th>
                        <th className="text-right py-1.5 px-2">Recall</th>
                        <th className="text-right py-1.5 px-2">F1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(liveMetrics.segment_metrics || {})
                        .sort(([, a], [, b]) => b.total - a.total)
                        .map(([segment, m]) => (
                          <tr key={segment} className="border-b border-gray-900/60">
                            <td className="py-1.5 px-2 text-gray-300">{segment}</td>
                            <td className="py-1.5 px-2 text-right text-gray-400">{m.total}</td>
                            <td className="py-1.5 px-2 text-right text-gray-300">{(m.accuracy * 100).toFixed(1)}%</td>
                            <td className="py-1.5 px-2 text-right text-blue-400">{(m.precision * 100).toFixed(1)}%</td>
                            <td className="py-1.5 px-2 text-right text-green-400">{(m.recall * 100).toFixed(1)}%</td>
                            <td className="py-1.5 px-2 text-right text-yellow-400">{(m.f1 * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800 z-10">
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2.5 px-3">Image</th>
                  <th className="text-left py-2.5 px-3">Thumbnail</th>
                  <th className="text-center py-2.5 px-3">Predicted</th>
                  <th className="text-center py-2.5 px-3">Ground Truth</th>
                  <th className="text-center py-2.5 px-3">Match</th>
                  <th className="text-center py-2.5 px-3">Error Tag</th>
                  <th className="text-right py-2.5 px-3">Confidence</th>
                  <th className="text-center py-2.5 px-3">Parse</th>
                  <th className="text-center py-2.5 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPredictions.map((p, i) => (
                  <PredictionRow
                    key={p.prediction_id}
                    prediction={p}
                    onUpdate={updatePrediction}
                    onImageReview={() => {
                      setCurrentIndex(i);
                      setViewMode("image");
                    }}
                    isIteration={runData?.split_type === "ITERATION"}
                  />
                ))}
                {filteredPredictions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      No predictions match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {loadingRun && selectedRunId && (
        <p className="text-center text-gray-500 py-8">Loading run predictions...</p>
      )}

      {runError && (
        <p className="text-center text-red-400 py-8">Unable to load run: {runError}</p>
      )}

      {!loadingRun && !runError && selectedRunId && predictions.length === 0 && (
        <p className="text-center text-gray-500 py-8">No predictions found for the selected run.</p>
      )}

      {/* Image Review Mode */}
      {viewMode === "image" && currentPrediction && (
        <ImageReviewMode
          prediction={currentPrediction}
          index={currentIndex}
          total={filteredPredictions.length}
          onNext={() => setCurrentIndex((i) => Math.min(i + 1, filteredPredictions.length - 1))}
          onPrev={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
          onUpdate={updatePrediction}
          isIteration={runData?.split_type === "ITERATION"}
          segmentTags={currentDatasetItem?.segment_tags || []}
          segmentOptions={Array.isArray(detection.segment_taxonomy) ? detection.segment_taxonomy : []}
          onUpdateSegmentTags={(nextTags) => updateSegmentTagsForImage(currentPrediction.image_id, nextTags)}
        />
      )}

      {!selectedRunId && (
        <p className="text-center text-gray-500 py-8">Select a completed run to begin review.</p>
      )}
    </div>
  );
}

function PredictionRow({
  prediction: p,
  onUpdate,
  onImageReview,
  isIteration,
}: {
  prediction: Prediction;
  onUpdate: (id: string, updates: any) => void;
  onImageReview: () => void;
  isIteration: boolean;
}) {
  const gt = p.corrected_label || p.ground_truth_label;
  const isCorrect = p.parse_ok && p.predicted_decision === gt;
  const isMatch = p.parse_ok && !!p.ground_truth_label && p.predicted_decision === p.ground_truth_label;

  return (
    <tr className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${!isCorrect ? "bg-red-900/5" : ""}`}>
      <td className="py-2 px-3 font-mono text-xs">{p.image_id}</td>
      <td className="py-2 px-3">
        <img
          src={p.image_uri}
          alt={p.image_id}
          className="w-10 h-10 object-cover rounded cursor-pointer hover:opacity-80"
          onClick={onImageReview}
        />
      </td>
      <td className="text-center py-2 px-3">
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          p.predicted_decision === "DETECTED" ? "bg-purple-900/30 text-purple-300" :
          p.predicted_decision === "NOT_DETECTED" ? "bg-emerald-900/30 text-emerald-300" :
          "bg-red-900/30 text-red-400"
        }`}>
          {p.predicted_decision || "PARSE_FAIL"}
        </span>
      </td>
      <td className="text-center py-2 px-3">
        <select
          className={`bg-gray-900 border border-gray-700 rounded text-xs px-1 py-0.5 ${
            p.ground_truth_label === "DETECTED"
              ? "text-purple-300"
              : p.ground_truth_label === "NOT_DETECTED"
                ? "text-emerald-300"
                : "text-gray-400"
          }`}
          value={p.ground_truth_label || ""}
          onChange={(e) =>
            onUpdate(p.prediction_id, {
              ground_truth_label: (e.target.value || null) as Decision | null,
              corrected_label: null,
            })
          }
        >
          <option value="">UNSET</option>
          <option value="DETECTED">DETECTED</option>
          <option value="NOT_DETECTED">NOT_DETECTED</option>
        </select>
      </td>
      <td className="text-center py-2 px-3">
        <span className={`text-xs font-medium ${isMatch ? "text-green-400" : "text-red-400"}`}>
          {isMatch ? "Yes" : "No"}
        </span>
      </td>
      <td className="text-center py-2 px-3">
        <select
          className="bg-gray-900 border border-gray-700 rounded text-xs px-1 py-0.5"
          value={p.error_tag || ""}
          onChange={(e) => onUpdate(p.prediction_id, { error_tag: e.target.value || null })}
        >
          <option value="">—</option>
          {ERROR_TAGS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="text-right py-2 px-3 text-xs">
        {p.confidence != null ? p.confidence.toFixed(2) : "—"}
      </td>
      <td className="text-center py-2 px-3">
        {p.parse_ok ? (
          <span className="text-green-400 text-xs">OK</span>
        ) : isInferenceCallFailure(p) ? (
          <span
            className="text-orange-300 text-xs"
            title={`${p.parse_error_reason || "Inference/API call failed"}${p.parse_fix_suggestion ? `\nFix: ${p.parse_fix_suggestion}` : ""}`}
          >
            API_ERR
          </span>
        ) : (
          <span
            className="text-red-400 text-xs"
            title={`${p.parse_error_reason || "Parse failed"}${p.parse_fix_suggestion ? `\nFix: ${p.parse_fix_suggestion}` : ""}`}
          >
            FAIL
          </span>
        )}
      </td>
      <td className="text-center py-2 px-3">
        <button
          onClick={onImageReview}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Review
        </button>
      </td>
    </tr>
  );
}

function ImageReviewMode({
  prediction: p,
  index,
  total,
  onNext,
  onPrev,
  onUpdate,
  isIteration,
  segmentTags,
  segmentOptions,
  onUpdateSegmentTags,
}: {
  prediction: Prediction;
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onUpdate: (id: string, updates: any) => void;
  isIteration: boolean;
  segmentTags: string[];
  segmentOptions: string[];
  onUpdateSegmentTags: (nextTags: string[]) => void;
}) {
  const [note, setNote] = useState(p.reviewer_note || "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [draggingImage, setDraggingImage] = useState(false);
  const [imageNatural, setImageNatural] = useState({ width: 0, height: 0 });
  const [copiedImageId, setCopiedImageId] = useState(false);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const lastPredictionIdRef = useRef(p.prediction_id);
  const lastNoteRef = useRef(note);
  const noteDirtyRef = useRef(noteDirty);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    // Persist pending note for previous image before switching images.
    if (noteDirtyRef.current && lastPredictionIdRef.current) {
      onUpdateRef.current(lastPredictionIdRef.current, { reviewer_note: (lastNoteRef.current || "").trim() || null });
    }
    setNote(p.reviewer_note || "");
    setNoteDirty(false);
    lastPredictionIdRef.current = p.prediction_id;
    lastNoteRef.current = p.reviewer_note || "";
  }, [p.prediction_id, p.reviewer_note]);

  useEffect(() => {
    lastNoteRef.current = note;
  }, [note]);

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
    setImageNatural({ width: 0, height: 0 });
    setDraggingImage(false);
    dragStartRef.current = null;
  }, [p.prediction_id]);

  const clampedImagePan = useMemo(() => {
    const viewport = imageViewportRef.current;
    if (!viewport || imageNatural.width <= 0 || imageNatural.height <= 0) return { x: 0, y: 0 };
    const viewportW = viewport.clientWidth;
    const viewportH = viewport.clientHeight;
    if (viewportW <= 0 || viewportH <= 0) return { x: 0, y: 0 };
    const imageRatio = imageNatural.width / imageNatural.height;
    const viewportRatio = viewportW / viewportH;
    let baseW = viewportW;
    let baseH = viewportH;
    if (imageRatio > viewportRatio) {
      baseH = viewportW / imageRatio;
    } else {
      baseW = viewportH * imageRatio;
    }
    const scaledW = baseW * imageZoom;
    const scaledH = baseH * imageZoom;
    const maxX = Math.max(0, (scaledW - viewportW) / 2);
    const maxY = Math.max(0, (scaledH - viewportH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, imagePan.x)),
      y: Math.max(-maxY, Math.min(maxY, imagePan.y)),
    };
  }, [imageNatural.height, imageNatural.width, imagePan.x, imagePan.y, imageZoom]);

  useEffect(() => {
    // Persist pending note when leaving image review (switching mode/tab/unmount).
    return () => {
      if (noteDirtyRef.current && lastPredictionIdRef.current) {
        onUpdateRef.current(lastPredictionIdRef.current, { reviewer_note: (lastNoteRef.current || "").trim() || null });
      }
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isTypingTarget =
      !!target &&
      (target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
    if (isTypingTarget) return;
    if (e.key === "ArrowRight") handleNext();
    if (e.key === "ArrowLeft") handlePrev();
  };

  const handlePrev = () => {
    if (noteDirty) {
      onUpdate(p.prediction_id, { reviewer_note: (note || "").trim() || null });
      setNoteDirty(false);
    }
    onPrev();
  };

  const handleNext = () => {
    if (noteDirty) {
      onUpdate(p.prediction_id, { reviewer_note: (note || "").trim() || null });
      setNoteDirty(false);
    }
    onNext();
  };

  const startImageDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (imageZoom <= 1) return;
    e.preventDefault();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: imagePan.x,
      panY: imagePan.y,
    };
    setDraggingImage(true);
  };

  const moveImageDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !draggingImage) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setImagePan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const endImageDrag = () => {
    setDraggingImage(false);
    dragStartRef.current = null;
  };

  const copyImageId = async () => {
    try {
      await navigator.clipboard.writeText(p.image_id);
      setCopiedImageId(true);
      setTimeout(() => setCopiedImageId(false), 1200);
    } catch {
      // no-op
    }
  };

  return (
    <div className="grid grid-cols-2 gap-6" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Image */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex justify-between items-start gap-3 mb-3">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-xs text-gray-500 truncate" title={`${index + 1} / ${total} — ${p.image_id}`}>
              {index + 1} / {total} — {p.image_id}
            </span>
            <button
              onClick={copyImageId}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs shrink-0"
              title="Copy image ID"
            >
              {copiedImageId ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end max-w-[420px]">
            <button
              onClick={() => setImageZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              disabled={imageZoom >= 4}
            >
              Zoom +
            </button>
            <button
              onClick={() => setImageZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              disabled={imageZoom <= 1}
            >
              Zoom -
            </button>
            <button
              onClick={() => {
                setImageZoom(1);
                setImagePan({ x: 0, y: 0 });
              }}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              disabled={imageZoom === 1 && imagePan.x === 0 && imagePan.y === 0}
            >
              Reset
            </button>
            <button onClick={handlePrev} disabled={index === 0} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-xs">
              ← Prev
            </button>
            <button onClick={handleNext} disabled={index === total - 1} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-xs">
              Next →
            </button>
          </div>
        </div>
        <div
          ref={imageViewportRef}
          className="w-full h-[500px] overflow-hidden rounded bg-gray-900 flex items-center justify-center"
          onMouseDown={startImageDrag}
          onMouseMove={moveImageDrag}
          onMouseUp={endImageDrag}
          onMouseLeave={endImageDrag}
          style={{ cursor: imageZoom > 1 ? (draggingImage ? "grabbing" : "grab") : "default" }}
        >
          <img
            src={p.image_uri}
            alt={p.image_id}
            className="max-h-[500px] max-w-full object-contain rounded select-none"
            style={{
              transform: `translate(${clampedImagePan.x}px, ${clampedImagePan.y}px) scale(${imageZoom})`,
              transformOrigin: "center center",
              willChange: "transform",
              backfaceVisibility: "hidden",
            }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onLoad={(event) =>
              setImageNatural({
                width: event.currentTarget.naturalWidth || 0,
                height: event.currentTarget.naturalHeight || 0,
              })
            }
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">Zoom: {(imageZoom * 100).toFixed(0)}%</p>
      </div>

      {/* Review Panel */}
      <div className="space-y-4">
        {/* Prediction Summary */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <div className="text-xs text-gray-300 space-y-2">
            <p>Confidence: {p.confidence != null ? p.confidence.toFixed(3) : "N/A"} (uncalibrated)</p>
            <p>Evidence: {p.evidence || "—"}</p>
            <p>
              Prediction:{" "}
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
            </p>
          </div>
        </div>

        {/* Decision Toggle */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Label Correction</h4>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-400">Ground truth:</span>
            <button
              onClick={() =>
                onUpdate(p.prediction_id, {
                  ground_truth_label: "DETECTED",
                  corrected_label: null,
                })
              }
              className={`px-3 py-1.5 rounded text-xs border ${
                p.ground_truth_label === "DETECTED"
                  ? "bg-purple-900/30 text-purple-200 border-purple-500"
                  : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
              }`}
            >
              DETECTED
            </button>
            <button
              onClick={() =>
                onUpdate(p.prediction_id, {
                  ground_truth_label: "NOT_DETECTED",
                  corrected_label: null,
                })
              }
              className={`px-3 py-1.5 rounded text-xs border ${
                p.ground_truth_label === "NOT_DETECTED"
                  ? "bg-emerald-900/30 text-emerald-200 border-emerald-600/50"
                  : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
              }`}
            >
              NOT_DETECTED
            </button>
            <button
              onClick={() =>
                onUpdate(p.prediction_id, {
                  ground_truth_label: null,
                  corrected_label: null,
                })
              }
              className={`px-3 py-1.5 rounded text-xs border ${
                !p.ground_truth_label
                  ? "bg-gray-800 text-gray-100 border-gray-500"
                  : "bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800"
              }`}
            >
              UNSET
            </button>
          </div>
          {p.corrected_label && (
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-400">Corrected to:</span>
              <span
                className={`text-sm font-medium ${
                  p.corrected_label === "DETECTED" ? "text-purple-300" : "text-emerald-300"
                }`}
              >
                {p.corrected_label}
              </span>
            </div>
          )}
          {isIteration && (
            <p className="text-xs text-gray-500 mt-1">Corrections will update ground truth for TRAIN datasets.</p>
          )}
          {p.corrected_label && (
            <button
              onClick={() => onUpdate(p.prediction_id, { corrected_label: null })}
              className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
            >
              Reset correction
            </button>
          )}
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Segments</h4>
          <SegmentTagsEditor value={segmentTags} options={segmentOptions} onChange={onUpdateSegmentTags} />
        </div>

        {/* Error Tag */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Error Tag</h4>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
            value={p.error_tag || ""}
            onChange={(e) => onUpdate(p.prediction_id, { error_tag: e.target.value || null })}
          >
            <option value="">No tag</option>
            {ERROR_TAGS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Reviewer Note */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Reviewer Note</h4>
          <textarea
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-20"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteDirty(true);
            }}
            onBlur={() => {
              if (!noteDirty) return;
              onUpdate(p.prediction_id, { reviewer_note: (note || "").trim() || null });
              setNoteDirty(false);
            }}
            placeholder="Add observations..."
          />
          <p className="mt-2 text-[11px] text-gray-500">Auto-saves when you leave this field or move to another image.</p>
        </div>

        {/* Model JSON Response */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Model Response</h4>
          <pre className="text-xs font-mono bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap text-gray-300">
            {p.raw_response}
          </pre>
          {!p.parse_ok && (
            <div className="mt-2 space-y-2">
              <p className={`text-xs ${isInferenceCallFailure(p) ? "text-orange-300" : "text-red-400"}`}>
                {isInferenceCallFailure(p) ? "Inference/API call failed." : "Parse failed."}
              </p>
              <div className="text-xs text-gray-300">
                <span className="text-gray-500">Why:</span>{" "}
                {p.parse_error_reason ||
                  (isInferenceCallFailure(p) ? "Model/API request failed before image could be reviewed." : "Response did not match expected schema.")}
              </div>
              <div className="text-xs text-gray-300">
                <span className="text-gray-500">How to fix:</span>{" "}
                {p.parse_fix_suggestion || "Return strict JSON only with detection_code, decision, confidence, evidence."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeSegmentTags(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value)
    ? value.map((v) => String(v || ""))
    : String(value)
        .split(/[;,|]/g)
        .map((v) => String(v || ""));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw) {
    const clean = part.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(clean);
  }
  return tags;
}

function SegmentTagsEditor({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <select
        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs"
        value=""
        onChange={(e) => {
          const next = e.target.value;
          if (!next) return;
          if (!value.includes(next)) onChange([...value, next]);
        }}
      >
        <option value="">Add tag...</option>
        {options.filter((option) => !value.includes(option)).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1 min-h-5">
        {value.length === 0 && <span className="text-[11px] text-gray-500">No segments</span>}
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-gray-200 text-[11px]">
            {tag}
            <button type="button" className="text-gray-400 hover:text-red-300" onClick={() => onChange(value.filter((v) => v !== tag))}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function deriveAutoErrorTag(prediction: Prediction): ErrorTag | null {
  const resolvedGt = prediction.corrected_label || prediction.ground_truth_label;
  if (isInferenceCallFailure(prediction)) return "INFERENCE_CALL_FAILED";
  if (!prediction.parse_ok) return "SCHEMA_VIOLATION";
  if (!resolvedGt || !prediction.predicted_decision) return null;
  if (resolvedGt === "DETECTED" && prediction.predicted_decision === "NOT_DETECTED") return "MISSED_DETECTION";
  if (resolvedGt === "NOT_DETECTED" && prediction.predicted_decision === "DETECTED") return "FALSE_POSITIVE";
  return null;
}

function withAutoErrorTag(prediction: Prediction): Prediction {
  if (prediction.error_tag) return prediction;
  const auto = deriveAutoErrorTag(prediction);
  return auto ? { ...prediction, error_tag: auto } : prediction;
}

function isInferenceCallFailure(prediction: Prediction): boolean {
  if (prediction.error_tag === "INFERENCE_CALL_FAILED") return true;
  const reason = String(prediction.parse_error_reason || "");
  const raw = String(prediction.raw_response || "");
  return reason.startsWith("Model/API error:") || raw.startsWith("ERROR:");
}
