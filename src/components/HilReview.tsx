"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Run, Prediction, ErrorTag, Decision } from "@/types";
import { computeMetricsWithSegments } from "@/lib/metrics";
import { formatMetricValue } from "@/lib/ui/metrics";
import { splitTypeLabel } from "@/lib/splitType";
import { DecisionBadge } from "@/components/shared/DecisionBadge";

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
  const selectedRunId = selectedRunByDetection[detection.detection_id] || "";
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
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Human-in-the-Loop Review</h2>
          <p className="app-page-copy">
            Review completed run outputs, correct labels, and inspect where prompt behavior is failing or ambiguous.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("table")}
            className={`app-toggle ${viewMode === "table" ? "app-toggle-active" : ""}`}
          >
            Table View
          </button>
          <button
            onClick={() => setViewMode("image")}
            className={`app-toggle ${viewMode === "image" ? "app-toggle-active" : ""}`}
          >
            Image Review
          </button>
        </div>
      </div>

      {/* Run Selection */}
      <div className="app-section">
        <div className="flex items-center gap-4">
          <label className="app-label">Select Run</label>
          <select
            className="app-select flex-1 px-3 py-2 text-sm"
            value={selectedRunId}
            onChange={(e) => {
              const nextRunId = e.target.value;
              setSelectedRunForDetection(detection.detection_id, nextRunId);
            }}
          >
            <option value="">Choose a run...</option>
            {runs.map((r: any) => (
              <option key={r.run_id} value={r.run_id}>
                {formatRunOptionLabel(r, promptLabelById[r.prompt_version_id])}
              </option>
            ))}
          </select>
        </div>

        {/* Filters */}
        {predictions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
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
                  className={`app-toggle ${filter === key ? "app-toggle-active" : ""}`}
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
          <div className="grid grid-cols-2 gap-3 px-1 md:grid-cols-4 xl:grid-cols-7">
            <MetricStat label="Labeled" value={`${labeledCount}/${predictions.length}`} valueClassName="text-white" />
            <MetricStat label="Accuracy" value={formatMetricValue(liveMetrics, "accuracy")} valueClassName="text-white" />
            <MetricStat label="Precision" value={formatMetricValue(liveMetrics, "precision")} valueClassName="text-white" />
            <MetricStat label="Recall" value={formatMetricValue(liveMetrics, "recall")} valueClassName="text-white" />
            <MetricStat label="F1 Score" value={formatMetricValue(liveMetrics, "f1")} valueClassName="text-white" />
            <MetricStat label="Prevalence" value={formatMetricValue(liveMetrics, "prevalence")} valueClassName="text-white" />
            <MetricStat
              label="Parse Fail Rate"
              value={formatMetricValue(liveMetrics, "parse_failure_rate")}
              valueClassName="text-white"
            />
          </div>
          {Object.keys(liveMetrics.segment_metrics || {}).length > 0 && (
            <details className="px-1 pt-1">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300">
                Attribute Breakdown
              </summary>
              <div className="app-metric-breakdown mt-2 text-xs">
                <div
                  className="app-metric-breakdown-row app-metric-breakdown-head"
                  style={{ gridTemplateColumns: "minmax(170px, 1.8fr) repeat(5, minmax(90px, 1fr))" }}
                >
                  <div className="app-metric-breakdown-cell app-metric-breakdown-label">Attribute</div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value">Total</div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value">Accuracy</div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value">Precision</div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value">Recall</div>
                  <div className="app-metric-breakdown-cell app-metric-breakdown-value">F1</div>
                </div>
                <div className="app-metric-breakdown-body">
                  {Object.entries(liveMetrics.segment_metrics || {})
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([segment, m]) => (
                      <div
                        key={segment}
                        className="app-metric-breakdown-row"
                        style={{ gridTemplateColumns: "minmax(170px, 1.8fr) repeat(5, minmax(90px, 1fr))" }}
                      >
                        <div className="app-metric-breakdown-cell app-metric-breakdown-label text-gray-300">{segment}</div>
                        <div className="app-metric-breakdown-cell app-metric-breakdown-value text-gray-400">{m.total}</div>
                        <div className="app-metric-breakdown-cell app-metric-breakdown-value text-gray-300">{formatMetricValue(m, "accuracy")}</div>
                        <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(m, "precision")}</div>
                        <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(m, "recall")}</div>
                        <div className="app-metric-breakdown-cell app-metric-breakdown-value text-[var(--app-text)]">{formatMetricValue(m, "f1")}</div>
                      </div>
                    ))}
                </div>
              </div>
            </details>
          )}
          <div className="app-card-strong overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="app-table app-table-fixed text-sm">
              <colgroup>
                <col style={{ width: "11rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "9rem" }} />
                <col style={{ width: "10rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "13rem" }} />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "7rem" }} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="app-table-col-label">Image</th>
                  <th className="app-table-col-label">Thumbnail</th>
                  <th className="app-table-col-label">Predicted</th>
                  <th className="app-table-col-label">Ground Truth</th>
                  <th className="app-table-col-label">Match</th>
                  <th className="app-table-col-label">Error Tag</th>
                  <th className="app-table-col-label">Confidence</th>
                  <th className="app-table-col-label">Parse</th>
                  <th className="app-table-col-label">Actions</th>
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
        <p className="app-card px-4 py-8 text-center text-[var(--app-text-muted)]">Loading run predictions...</p>
      )}

      {runError && (
        <p className="rounded-2xl border border-[rgba(255,123,136,0.22)] bg-[rgba(85,24,31,0.68)] px-4 py-8 text-center text-[var(--app-danger)]">Unable to load run: {runError}</p>
      )}

      {!loadingRun && !runError && selectedRunId && predictions.length === 0 && (
        <p className="app-card px-4 py-8 text-center text-[var(--app-text-muted)]">No predictions found for the selected run.</p>
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

    </div>
  );
}

function formatRunOptionLabel(run: Run, promptLabel?: string): string {
  const prompt = promptLabel || String(run.prompt_version_id || "").slice(0, 8) || "Unknown prompt";
  const split = splitTypeLabel(run.split_type);
  const createdAt = run.created_at ? new Date(run.created_at).toLocaleDateString() : "";
  const imageCount = Number(run.metrics_summary?.total ?? run.total_images ?? 0);
  const f1 = Number(run.metrics_summary?.f1 ?? 0);
  const countLabel = imageCount > 0 ? `${imageCount} imgs` : "No count";
  return `${prompt} · ${split} · ${countLabel} · F1 ${ (f1 * 100).toFixed(1)}% · ${createdAt}`;
}

function MetricStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="px-3 py-4 text-center">
      <div className={`text-2xl font-semibold ${valueClassName || "text-white"}`}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
        {label}
      </div>
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
    <tr className={!isCorrect ? "app-table-row-alert" : ""}>
      <td className="font-mono text-xs">{p.image_id}</td>
      <td>
        <img
          src={p.image_uri}
          alt={p.image_id}
          className="w-10 h-10 object-cover rounded cursor-pointer hover:opacity-80"
          onClick={onImageReview}
        />
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
          <DecisionBadge decision={p.predicted_decision || "PARSE_FAIL"} />
        </div>
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
          <select
            className="rounded-md border px-2 py-1 text-[11px] font-medium"
            style={
              p.ground_truth_label === "DETECTED"
                ? {
                    color: "var(--app-purple)",
                    backgroundColor: "var(--app-purple-soft)",
                    borderColor: "color-mix(in srgb, var(--app-purple) 36%, transparent)",
                  }
                : p.ground_truth_label === "NOT_DETECTED"
                  ? {
                      color: "var(--app-not-detected)",
                      backgroundColor: "var(--app-not-detected-soft)",
                      borderColor: "color-mix(in srgb, var(--app-not-detected) 36%, transparent)",
                    }
                  : {
                      color: "var(--app-text-subtle)",
                      backgroundColor: "var(--app-field-bg)",
                      borderColor: "var(--app-border-strong)",
                    }
            }
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
        </div>
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
          <span className={`text-xs font-medium ${isMatch ? "text-green-400" : "text-red-400"}`}>
            {isMatch ? "Yes" : "No"}
          </span>
        </div>
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
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
        </div>
      </td>
      <td className="app-table-col-label text-xs">
        <div className="app-table-left-slot">
          <span>{p.confidence != null ? p.confidence.toFixed(2) : "—"}</span>
        </div>
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
          {p.parse_ok ? (
            <span className="app-status-ok">OK</span>
          ) : isInferenceCallFailure(p) ? (
            <span
              className="app-status-api"
              title={`${p.parse_error_reason || "Inference/API call failed"}${p.parse_fix_suggestion ? `\nFix: ${p.parse_fix_suggestion}` : ""}`}
            >
              API_ERR
            </span>
          ) : (
            <span
              className="app-status-fail"
              title={`${p.parse_error_reason || "Parse failed"}${p.parse_fix_suggestion ? `\nFix: ${p.parse_fix_suggestion}` : ""}`}
            >
              FAIL
            </span>
          )}
        </div>
      </td>
      <td className="app-table-col-label">
        <div className="app-table-left-slot">
          <button
            onClick={onImageReview}
            className="app-btn app-btn-subtle app-btn-sm text-xs"
          >
            Review
          </button>
        </div>
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Image */}
      <div className="app-card-strong p-4">
        <div className="flex justify-between items-start gap-3 mb-3">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-xs text-gray-500 truncate" title={`${index + 1} / ${total} — ${p.image_id}`}>
              {index + 1} / {total} — {p.image_id}
            </span>
            <button
              onClick={copyImageId}
              className="app-btn app-btn-subtle app-btn-sm shrink-0 text-xs"
              title="Copy image ID"
            >
              {copiedImageId ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end max-w-[420px]">
            <button
              onClick={() => setImageZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              disabled={imageZoom >= 4}
            >
              Zoom +
            </button>
            <button
              onClick={() => setImageZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              disabled={imageZoom <= 1}
            >
              Zoom -
            </button>
            <button
              onClick={() => {
                setImageZoom(1);
                setImagePan({ x: 0, y: 0 });
              }}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              disabled={imageZoom === 1 && imagePan.x === 0 && imagePan.y === 0}
            >
              Reset
            </button>
            <button onClick={handlePrev} disabled={index === 0} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">
              ← Prev
            </button>
            <button onClick={handleNext} disabled={index === total - 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">
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
        <div className="app-card p-4">
          <div className="text-xs text-gray-300 space-y-2">
            <p>Confidence: {p.confidence != null ? p.confidence.toFixed(3) : "N/A"} (uncalibrated)</p>
            <p>Evidence: {p.evidence || "—"}</p>
            <p>
              Prediction:{" "}
              <DecisionBadge decision={p.predicted_decision || "PARSE_FAIL"} />
            </p>
          </div>
        </div>

        {/* Decision Toggle */}
        <div className="app-card p-4">
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
                  ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)] border-[color:color-mix(in_srgb,var(--app-purple)_36%,transparent)]"
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
                  ? "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)] border-[color:color-mix(in_srgb,var(--app-not-detected)_36%,transparent)]"
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

        <div className="app-card p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Attributes</h4>
          <SegmentTagsEditor value={segmentTags} options={segmentOptions} onChange={onUpdateSegmentTags} />
        </div>

        {/* Error Tag */}
        <div className="app-card p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Error Tag</h4>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs"
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
        <div className="app-card p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Reviewer Note</h4>
          <textarea
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs h-20"
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
        <div className="app-card p-4">
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
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() =>
                onChange(selected ? value.filter((v) => v !== option) : [...value, option])
              }
              className={`px-2.5 py-1 text-[11px] transition ${
                selected
                  ? "rounded-md border border-sky-400/50 bg-sky-500/12 text-sky-100"
                  : "rounded-md border border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]"
              }`}
            >
              {option}
            </button>
          );
        })}
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
