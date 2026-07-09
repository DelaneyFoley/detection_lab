"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Run, Prediction, ErrorTag, Decision, ReviewFlag, ResolutionAction, GroundtruthCorrection } from "@/types";
import { computeMetricsWithSegments } from "@/lib/metrics";
import { formatMetricValue } from "@/lib/ui/metrics";
import { splitTypeLabel } from "@/lib/splitType";
import { DecisionBadge } from "@/components/shared/DecisionBadge";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { AttributePills } from "@/components/shared/AttributePills";
import { PromptIterationPanel } from "@/components/shared/PromptIterationPanel";

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

type FilterType = "all" | "fp" | "fn" | "parse_fail" | "correct" | "corrected" | "gt_corrected" | "flagged_open" | "flagged_resolved";

const RESOLUTION_ACTIONS: { value: ResolutionAction; label: string }[] = [
  { value: "label_confirmed", label: "Label Confirmed" },
  { value: "label_corrected", label: "Label Corrected" },
  { value: "attributes_corrected", label: "Attributes Corrected" },
  { value: "image_removed", label: "Image Removed" },
  { value: "needs_discussion", label: "Needs Discussion" },
];

export function HilReview({ detection }: { detection: Detection }) {
  const { selectedRunByDetection, setSelectedRunForDetection, triggerRefresh, refreshCounter, apiKey } = useAppStore();
  const [runs, setRuns] = useState<Run[]>([]);
  const [promptLabelById, setPromptLabelById] = useState<Record<string, string>>({});
  const [promptLineageById, setPromptLineageById] = useState<Record<string, { rootLabel: string; isIteration: boolean }>>({});
  const selectedRunId = selectedRunByDetection[detection.detection_id] || "";
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<"table" | "image">("table");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runData, setRunData] = useState<any>(null);
  const [datasetItemByImageId, setDatasetItemByImageId] = useState<Record<string, { item_id: string; segment_tags: string[] }>>({});
  const [loadingRun, setLoadingRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [flaggedPredictionIds, setFlaggedPredictionIds] = useState<Set<string>>(new Set());
  const [resolvedFlaggedPredictionIds, setResolvedFlaggedPredictionIds] = useState<Set<string>>(new Set());
  const [flagsByPredictionId, setFlagsByPredictionId] = useState<Record<string, ReviewFlag>>({});
  const [resolvedFlagsByPredictionId, setResolvedFlagsByPredictionId] = useState<Record<string, ReviewFlag>>({});
  const [gtCorrectionsByPredictionId, setGtCorrectionsByPredictionId] = useState<Record<string, GroundtruthCorrection[]>>({});
  const [flagModalPredictionId, setFlagModalPredictionId] = useState<string | null>(null);
  const [resolveModalFlagId, setResolveModalFlagId] = useState<string | null>(null);
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
    // Trace each prompt up its lineage to the human-authored root so iteration
    // runs can be grouped with the run they originated from.
    const lineage: Record<string, { rootLabel: string; isIteration: boolean }> = {};
    if (Array.isArray(prompts)) {
      const byId = new Map(prompts.map((p: any) => [p.prompt_version_id, p]));
      const isIteration = (p: any) => p?.created_by === "system";
      for (const p of prompts as any[]) {
        let cur: any = p;
        const seen = new Set<string>();
        while (
          cur &&
          isIteration(cur) &&
          cur.source_prompt_version_id &&
          byId.has(cur.source_prompt_version_id) &&
          !seen.has(cur.prompt_version_id)
        ) {
          seen.add(cur.prompt_version_id);
          cur = byId.get(cur.source_prompt_version_id);
        }
        lineage[p.prompt_version_id] = {
          rootLabel: cur?.version_label || p.version_label || "",
          isIteration: isIteration(p),
        };
      }
    }
    setPromptLineageById(lineage);
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

      // Load review flags for this run
      const flagsRes = await fetch(`/api/review-flags?run_id=${selectedRunId}`);
      if (flagsRes.ok) {
        const flagsData = await flagsRes.json();
        const flags: ReviewFlag[] = Array.isArray(flagsData?.flags) ? flagsData.flags : [];
        const openFlags = flags.filter((f) => f.status === "open");
        const resolvedFlags = flags.filter((f) => f.status === "resolved");
        setFlaggedPredictionIds(new Set(openFlags.map((f) => f.prediction_id!).filter(Boolean)));
        setResolvedFlaggedPredictionIds(new Set(resolvedFlags.map((f) => f.prediction_id!).filter(Boolean)));
        const byPredId: Record<string, ReviewFlag> = {};
        for (const f of openFlags) {
          if (f.prediction_id) byPredId[f.prediction_id] = f;
        }
        setFlagsByPredictionId(byPredId);
        const resolvedByPredId: Record<string, ReviewFlag> = {};
        for (const f of resolvedFlags) {
          if (f.prediction_id) resolvedByPredId[f.prediction_id] = f;
        }
        setResolvedFlagsByPredictionId(resolvedByPredId);
      }

      // Load ground-truth correction log for this run (all entries per prediction)
      const gtRes = await fetch(`/api/hil/gt-corrections?run_id=${selectedRunId}`);
      if (gtRes.ok) {
        const gtPayload = await gtRes.json();
        const corrections: GroundtruthCorrection[] = Array.isArray(gtPayload?.corrections) ? gtPayload.corrections : [];
        const byPrediction: Record<string, GroundtruthCorrection[]> = {};
        for (const c of corrections) {
          if (!byPrediction[c.prediction_id]) byPrediction[c.prediction_id] = [];
          byPrediction[c.prediction_id].push(c);
        }
        setGtCorrectionsByPredictionId(byPrediction);
      } else {
        setGtCorrectionsByPredictionId({});
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
      case "gt_corrected": return (gtCorrectionsByPredictionId[p.prediction_id]?.length || 0) > 0;
      case "flagged_open": return flaggedPredictionIds.has(p.prediction_id);
      case "flagged_resolved": return resolvedFlaggedPredictionIds.has(p.prediction_id);
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
          image_description: updates.reviewer_note !== undefined ? updates.reviewer_note : p.image_description,
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

    if (Object.prototype.hasOwnProperty.call(updates, "ground_truth_label") && selectedRunId) {
      // Re-fetch GT correction log so the filter/history reflects the new entry.
      const gtRes = await fetch(`/api/hil/gt-corrections?run_id=${selectedRunId}`);
      if (gtRes.ok) {
        const gtPayload = await gtRes.json();
        const corrections: GroundtruthCorrection[] = Array.isArray(gtPayload?.corrections) ? gtPayload.corrections : [];
        const byPrediction: Record<string, GroundtruthCorrection[]> = {};
        for (const c of corrections) {
          if (!byPrediction[c.prediction_id]) byPrediction[c.prediction_id] = [];
          byPrediction[c.prediction_id].push(c);
        }
        setGtCorrectionsByPredictionId(byPrediction);
      }
    }
  };

  const [exporting, setExporting] = useState(false);
  const [finalized, setFinalized] = useState<boolean | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const { notify } = useAppFeedback();

  useEffect(() => {
    let cancelled = false;
    if (!selectedRunId) {
      setFinalized(null);
      return;
    }
    setFinalized(null);
    (async () => {
      try {
        const res = await fetch(`/api/hil/finalize?run_id=${encodeURIComponent(selectedRunId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setFinalized(Boolean(data?.finalized));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const finalizeHilReview = async () => {
    if (!selectedRunId || finalizing || finalized) return;
    setFinalizing(true);
    try {
      const res = await fetch("/api/hil/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: selectedRunId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFinalized(true);
        notify({ tone: "success", message: "HIL review finalized — entry added to Version Notes." });
      } else {
        notify({ tone: "error", message: data?.error || "Failed to finalize HIL review" });
      }
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Failed to finalize HIL review" });
    } finally {
      setFinalizing(false);
    }
  };

  const exportRunToExcel = async () => {
    if (!selectedRunId || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/runs/export?run_id=${selectedRunId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `run_export_${selectedRunId.substring(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const createFlag = async (predictionId: string, reason: string) => {
    const pred = predictions.find((p) => p.prediction_id === predictionId);
    if (!pred) return;
    const res = await fetch("/api/review-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prediction_id: predictionId,
        detection_id: detection.detection_id,
        image_id: pred.image_id,
        reason,
      }),
    });
    if (res.ok) {
      setFlaggedPredictionIds((prev) => new Set([...prev, predictionId]));
      const json = await res.json();
      setFlagsByPredictionId((prev) => ({
        ...prev,
        [predictionId]: {
          flag_id: json.flag_id,
          prediction_id: predictionId,
          dataset_item_id: null,
          detection_id: detection.detection_id,
          image_id: pred.image_id,
          reason,
          status: "open",
          resolution_action: null,
          resolution_note: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        },
      }));
    }
    setFlagModalPredictionId(null);
  };

  const resolveFlag = async (flagId: string, action: ResolutionAction, note: string) => {
    const res = await fetch("/api/review-flags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flag_id: flagId,
        status: "resolved",
        resolution_action: action,
        resolution_note: note || null,
      }),
    });
    if (res.ok) {
      const flag = Object.values(flagsByPredictionId).find((f) => f.flag_id === flagId);
      if (flag?.prediction_id) {
        const resolvedVersion: ReviewFlag = {
          ...flag,
          status: "resolved",
          resolution_action: action,
          resolution_note: note || null,
          resolved_at: new Date().toISOString(),
        };
        setFlaggedPredictionIds((prev) => {
          const next = new Set(prev);
          next.delete(flag.prediction_id!);
          return next;
        });
        setFlagsByPredictionId((prev) => {
          const next = { ...prev };
          delete next[flag.prediction_id!];
          return next;
        });
        setResolvedFlaggedPredictionIds((prev) => new Set([...prev, flag.prediction_id!]));
        setResolvedFlagsByPredictionId((prev) => ({
          ...prev,
          [flag.prediction_id!]: resolvedVersion,
        }));
      }
    }
    setResolveModalFlagId(null);
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
            {(() => {
              // Group runs by the human-authored root prompt so iteration runs sit
              // with the run they originated from; within a group, the original run
              // comes first, then its AI-iteration runs (newest first).
              const groups = new Map<string, any[]>();
              for (const r of runs as any[]) {
                const key = promptLineageById[r.prompt_version_id]?.rootLabel || promptLabelById[r.prompt_version_id] || "Other";
                const arr = groups.get(key) || [];
                arr.push(r);
                groups.set(key, arr);
              }
              const renderOption = (r: any) => (
                <option key={r.run_id} value={r.run_id}>
                  {(promptLineageById[r.prompt_version_id]?.isIteration ? "↳ " : "") +
                    formatRunOptionLabel(r, promptLabelById[r.prompt_version_id])}
                </option>
              );
              return [...groups.entries()].map(([groupLabel, groupRuns]) => {
                if (groupRuns.length <= 1) return groupRuns.map(renderOption);
                const sorted = [...groupRuns].sort((a, b) => {
                  const ai = promptLineageById[a.prompt_version_id]?.isIteration ? 1 : 0;
                  const bi = promptLineageById[b.prompt_version_id]?.isIteration ? 1 : 0;
                  if (ai !== bi) return ai - bi;
                  return +new Date(b.created_at) - +new Date(a.created_at);
                });
                return (
                  <optgroup key={groupLabel} label={groupLabel}>
                    {sorted.map(renderOption)}
                  </optgroup>
                );
              });
            })()}
          </select>
          {predictions.length > 0 && (
            <button
              onClick={exportRunToExcel}
              disabled={exporting}
              className="app-btn app-btn-subtle app-btn-sm text-xs whitespace-nowrap"
            >
              {exporting ? "Exporting..." : "Export to Excel"}
            </button>
          )}
          {selectedRunId && (
            <button
              onClick={finalizeHilReview}
              disabled={finalizing || finalized === true || finalized === null}
              title={finalized ? "Already finalized" : "Write a performance summary entry to Version Notes"}
              className="app-btn app-btn-subtle app-btn-sm text-xs whitespace-nowrap disabled:opacity-40"
            >
              {finalizing
                ? "Finalizing..."
                : finalized
                  ? "HIL Review Finalized"
                  : "Finalize HIL Review"}
            </button>
          )}
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
              ["gt_corrected", "GT Updated"],
              ["flagged_open", "Flagged — Open"],
              ["flagged_resolved", "Flagged — Resolved"],
            ] as [FilterType, string][]).map(([key, label]) => {
              const count = predictions.filter((p) => {
                const gt = p.corrected_label || p.ground_truth_label;
                switch (key) {
                  case "fp": return p.parse_ok && p.predicted_decision === "DETECTED" && gt === "NOT_DETECTED";
                  case "fn": return p.parse_ok && p.predicted_decision === "NOT_DETECTED" && gt === "DETECTED";
                  case "parse_fail": return !p.parse_ok && !isInferenceCallFailure(p);
                  case "correct": return p.parse_ok && p.predicted_decision === gt;
                  case "corrected": return p.corrected_label !== null;
                  case "gt_corrected": return (gtCorrectionsByPredictionId[p.prediction_id]?.length || 0) > 0;
                  case "flagged_open": return flaggedPredictionIds.has(p.prediction_id);
                  case "flagged_resolved": return resolvedFlaggedPredictionIds.has(p.prediction_id);
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

      {/* AI Prompt Iteration */}
      {selectedRunId && (
        <PromptIterationPanel
          runId={selectedRunId}
          finalized={finalized === true}
          promptVersionLabel={
            promptLabelById[runs.find((r) => r.run_id === selectedRunId)?.prompt_version_id || ""] || ""
          }
          promptVersionId={runs.find((r) => r.run_id === selectedRunId)?.prompt_version_id || ""}
          predictions={predictions}
          apiKey={apiKey}
        />
      )}

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
                <col style={{ width: "6rem" }} />
                <col style={{ width: "11rem" }} />
                <col style={{ width: "9rem" }} />
                <col style={{ width: "10rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "13rem" }} />
                <col style={{ width: "12rem" }} />
                <col style={{ width: "7rem" }} />
                <col style={{ width: "6rem" }} />
                <col style={{ width: "7rem" }} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="app-table-col-label">Preview</th>
                  <th className="app-table-col-label">Image ID</th>
                  <th className="app-table-col-label">Predicted</th>
                  <th className="app-table-col-label">Ground Truth</th>
                  <th className="app-table-col-label">Match</th>
                  <th className="app-table-col-label">Error Tag</th>
                  <th className="app-table-col-label">Attributes</th>
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
                    segmentTags={datasetItemByImageId[p.image_id]?.segment_tags || []}
                    onUpdate={updatePrediction}
                    onImageReview={() => {
                      setCurrentIndex(i);
                      setViewMode("image");
                    }}
                    isIteration={runData?.split_type === "ITERATION"}
                    isFlagged={flaggedPredictionIds.has(p.prediction_id)}
                    onFlag={() => setFlagModalPredictionId(p.prediction_id)}
                    onResolve={() => {
                      const flag = flagsByPredictionId[p.prediction_id];
                      if (flag) setResolveModalFlagId(flag.flag_id);
                    }}
                    flagReason={flagsByPredictionId[p.prediction_id]?.reason}
                  />
                ))}
                {filteredPredictions.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-gray-500">
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
          isFlagged={flaggedPredictionIds.has(currentPrediction.prediction_id)}
          onFlag={() => setFlagModalPredictionId(currentPrediction.prediction_id)}
          onResolve={() => {
            const flag = flagsByPredictionId[currentPrediction.prediction_id];
            if (flag) setResolveModalFlagId(flag.flag_id);
          }}
          flagReason={flagsByPredictionId[currentPrediction.prediction_id]?.reason}
          resolvedFlag={resolvedFlagsByPredictionId[currentPrediction.prediction_id]}
          gtCorrections={gtCorrectionsByPredictionId[currentPrediction.prediction_id] || []}
        />
      )}

      {flagModalPredictionId && (
        <FlagModal
          onSubmit={(reason) => createFlag(flagModalPredictionId, reason)}
          onCancel={() => setFlagModalPredictionId(null)}
        />
      )}

      {resolveModalFlagId && (
        <ResolveModal
          flag={Object.values(flagsByPredictionId).find((f) => f.flag_id === resolveModalFlagId)!}
          onSubmit={(action, note) => resolveFlag(resolveModalFlagId, action, note)}
          onCancel={() => setResolveModalFlagId(null)}
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
  segmentTags,
  onUpdate,
  onImageReview,
  isIteration,
  isFlagged,
  onFlag,
  onResolve,
  flagReason,
}: {
  prediction: Prediction;
  segmentTags: string[];
  onUpdate: (id: string, updates: any) => void;
  onImageReview: () => void;
  isIteration: boolean;
  isFlagged: boolean;
  onFlag: () => void;
  onResolve: () => void;
  flagReason?: string;
}) {
  const gt = p.corrected_label || p.ground_truth_label;
  const isCorrect = p.parse_ok && p.predicted_decision === gt;
  const isMatch = p.parse_ok && !!p.ground_truth_label && p.predicted_decision === p.ground_truth_label;

  return (
    <tr className={!isCorrect ? "app-table-row-alert" : ""}>
      <td>
        <img
          src={p.image_uri}
          alt={p.image_id}
          className="w-10 h-10 object-cover rounded cursor-pointer hover:opacity-80"
          onClick={onImageReview}
        />
      </td>
      <td className="font-mono text-xs">{p.image_id}</td>
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
        <div className="app-table-left-slot flex flex-wrap gap-1">
          {segmentTags.length > 0 ? segmentTags.map((tag) => (
            <span key={tag} className="inline-block rounded bg-[var(--app-field-bg)] border border-[var(--app-border)] px-1.5 py-0.5 text-[10px] text-[var(--app-text-muted)]">
              {tag}
            </span>
          )) : <span className="text-[var(--app-text-muted)]">—</span>}
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
        <div className="app-table-left-slot flex gap-1">
          <button
            onClick={onImageReview}
            className="app-btn app-btn-subtle app-btn-sm text-xs"
          >
            Review
          </button>
          {isFlagged ? (
            <button
              onClick={onResolve}
              className="app-btn app-btn-sm text-xs text-amber-400 border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20"
              title={flagReason || "Flagged for review"}
            >
              Flagged
            </button>
          ) : (
            <button
              onClick={onFlag}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              title="Flag for secondary review"
            >
              Flag
            </button>
          )}
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
  isFlagged,
  onFlag,
  onResolve,
  flagReason,
  resolvedFlag,
  gtCorrections,
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
  isFlagged: boolean;
  onFlag: () => void;
  onResolve: () => void;
  flagReason?: string;
  resolvedFlag?: ReviewFlag;
  gtCorrections?: GroundtruthCorrection[];
}) {
  const [note, setNote] = useState(p.image_description || p.reviewer_note || "");
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
    const initialNote = p.image_description || p.reviewer_note || "";
    setNote(initialNote);
    setNoteDirty(false);
    lastPredictionIdRef.current = p.prediction_id;
    lastNoteRef.current = initialNote;
  }, [p.prediction_id, p.reviewer_note, p.image_description]);

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
              onClick={() => setImageZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              disabled={imageZoom <= 1}
            >
              Zoom -
            </button>
            <button
              onClick={() => setImageZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
              disabled={imageZoom >= 4}
            >
              Zoom +
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
          className="w-full h-[700px] overflow-hidden rounded bg-gray-900 flex items-center justify-center"
          onMouseDown={startImageDrag}
          onMouseMove={moveImageDrag}
          onMouseUp={endImageDrag}
          onMouseLeave={endImageDrag}
          style={{ cursor: imageZoom > 1 ? (draggingImage ? "grabbing" : "grab") : "default" }}
        >
          <img
            src={p.image_uri}
            alt={p.image_id}
            className="max-h-[700px] max-w-full object-contain rounded select-none"
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
        {/* Flag for Secondary Review — always at top */}
        <div className="app-card p-4">
          <h4 className="text-xs text-gray-500 font-medium mb-2">Secondary Review</h4>
          {isFlagged ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="text-xs text-amber-400 font-medium">Flagged for review</span>
              </div>
              {flagReason && (
                <p className="text-xs text-gray-300 bg-gray-900 rounded p-2">{flagReason}</p>
              )}
              <button
                onClick={onResolve}
                className="app-btn app-btn-sm text-xs text-amber-400 border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20"
              >
                Resolve Flag
              </button>
            </div>
          ) : (
            <button
              onClick={onFlag}
              className="app-btn app-btn-subtle app-btn-sm text-xs"
            >
              Flag for Secondary Review
            </button>
          )}
        </div>

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

        {/* Resolved flag history */}
        {resolvedFlag && (
          <div className="app-card p-4">
            <h4 className="text-xs text-gray-500 font-medium mb-2">Resolved Secondary Review</h4>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-gray-500">Question: </span>
                <span className="text-gray-300">{resolvedFlag.reason}</span>
              </div>
              <div>
                <span className="text-gray-500">Resolution: </span>
                <span className="text-gray-300">{resolvedFlag.resolution_action?.replace(/_/g, " ") || "—"}</span>
              </div>
              {resolvedFlag.resolution_note && (
                <div>
                  <span className="text-gray-500">Note: </span>
                  <span className="text-gray-300">{resolvedFlag.resolution_note}</span>
                </div>
              )}
              {resolvedFlag.resolved_at && (
                <div className="text-gray-500">
                  Resolved {new Date(resolvedFlag.resolved_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        )}

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

        {/* Ground Truth Label History — logged below the raw Model Response */}
        {gtCorrections && gtCorrections.length > 0 && (
          <GroundtruthLabelHistory corrections={gtCorrections} />
        )}
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
  const extraTags = value.filter((tag) => !options.includes(tag));
  return (
    <div>
      {extraTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {extraTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="text-amber-400/60 hover:text-amber-300 ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <AttributePills
        options={options}
        selected={value}
        onToggle={(attr) =>
          onChange(value.includes(attr) ? value.filter((v) => v !== attr) : [...value, attr])
        }
      />
      {options.length === 0 && value.length === 0 && (
        <p className="text-[11px] text-gray-500">No attributes configured for this detection.</p>
      )}
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

function FlagModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="app-card-strong p-6 w-full max-w-md space-y-4">
        <h3 className="text-sm font-semibold text-white">Flag for Secondary Review</h3>
        <p className="text-xs text-gray-400">
          What is your question or concern about this image?
        </p>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-24"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g., Unsure if this qualifies as detected — looks borderline..."
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="app-btn app-btn-subtle app-btn-sm text-xs">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={!reason.trim()}
            className="app-btn app-btn-primary app-btn-sm text-xs disabled:opacity-40"
          >
            Submit Flag
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolveModal({
  flag,
  onSubmit,
  onCancel,
}: {
  flag: ReviewFlag;
  onSubmit: (action: ResolutionAction, note: string) => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<ResolutionAction>("label_confirmed");
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="app-card-strong p-6 w-full max-w-md space-y-4">
        <h3 className="text-sm font-semibold text-white">Resolve Flag</h3>
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Original question:</p>
          <p className="text-xs text-gray-200 bg-gray-900 rounded p-2">{flag.reason}</p>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Resolution action</label>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value as ResolutionAction)}
          >
            {RESOLUTION_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Resolution note (optional)</label>
          <textarea
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-20"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Additional context or answer to the reviewer's question..."
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="app-btn app-btn-subtle app-btn-sm text-xs">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(action, note)}
            className="app-btn app-btn-success app-btn-sm text-xs"
          >
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}

function GroundtruthLabelHistory({
  corrections,
}: {
  corrections: GroundtruthCorrection[];
}) {
  return (
    <div className="app-card p-4">
      <h4 className="text-xs text-gray-500 font-medium mb-3">Ground Truth Label History</h4>
      <ul className="space-y-3">
        {corrections.map((c) => (
          <li key={c.correction_id} className="border border-[var(--app-border)] rounded p-3 bg-[var(--app-field-bg)]">
            <GroundtruthHistoryEntry correction={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroundtruthHistoryEntry({
  correction,
}: {
  correction: GroundtruthCorrection;
}) {
  const oldLabel = correction.old_label || "UNSET";
  const newLabel = correction.new_label || "UNSET";
  const aiPred = correction.predicted_decision || "PARSE_FAIL";
  const aiMatch = correction.ai_matches_new_gt;
  const actor = correction.actor || "user";
  const when = new Date(correction.created_at);

  return (
    <div className="text-xs text-gray-300 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-gray-400">{when.toLocaleString()}</span>
        <span className="text-gray-500">by <span className="text-gray-300 font-medium">{actor}</span></span>
      </div>
      <div>
        <span className="text-gray-500">Change: </span>
        <span className="font-medium">{oldLabel}</span>
        <span className="text-gray-500"> → </span>
        <span className="font-medium">{newLabel}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500">AI prediction:</span>
        <DecisionBadge decision={aiPred} />
        {aiMatch === null ? (
          <span className="text-gray-400">(no AI prediction)</span>
        ) : aiMatch ? (
          <span className="text-emerald-300 font-medium">matches new GT</span>
        ) : (
          <span className="text-amber-300 font-medium">disagrees with new GT</span>
        )}
      </div>
    </div>
  );
}
