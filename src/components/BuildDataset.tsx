"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection, PromptVersion, ReviewFlag, ResolutionAction } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { InfoTip } from "@/components/shared/InfoTip";
import { DecisionBadge } from "@/components/shared/DecisionBadge";

type BuildRow = {
  id: string;
  file?: File;
  preview: string;
  imageId: string;
  groundTruthLabel: "DETECTED" | "NOT_DETECTED" | null;
  segmentTags: string[];
  aiAssignedLabel?: "DETECTED" | "NOT_DETECTED" | "PARSE_FAIL" | "";
  aiConfidence?: number | null;
  aiDescription?: string;
};

export function BuildDataset({ detection }: { detection: Detection | null }) {
  const { apiKey, selectedModel, setActiveTab, setSelectedRunForDetection, triggerRefresh, refreshCounter, selectedPromptByDetection } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");

  const [selectedExistingDatasetId, setSelectedExistingDatasetId] = useState("");

  const [rows, setRows] = useState<BuildRow[]>([]);

  const [building, setBuilding] = useState(false);
  const [buildMode, setBuildMode] = useState<"save" | "run" | null>(null);
  const [status, setStatus] = useState("");
  const [builtDatasetId, setBuiltDatasetId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelingRun, setCancelingRun] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Review flags state (only used in load mode)
  const [flaggedItemIds, setFlaggedItemIds] = useState<Set<string>>(new Set());
  const [flagsByItemId, setFlagsByItemId] = useState<Record<string, ReviewFlag>>({});
  const [resolvedFlagsByItemId, setResolvedFlagsByItemId] = useState<Record<string, ReviewFlag>>({});
  const [flagModalItemId, setFlagModalItemId] = useState<string | null>(null);
  const [resolveModalFlagId, setResolveModalFlagId] = useState<string | null>(null);
  const [datasetFlagFilter, setDatasetFlagFilter] = useState<false | "open" | "resolved">(false);

  // Child datasets (per-annotator splits linked to a parent) should not be
  // directly selectable here — only show top-level datasets in the dropdown.
  const selectableDatasets = useMemo(
    () => datasets.filter((d) => !d.linked_dataset_id),
    [datasets]
  );

  useEffect(() => {
    if (!detection) return;
    setSelectedExistingDatasetId("");
    setRows([]);
    setBuiltDatasetId(null);
    setStatus("");
    setValidationError("");
    setPreviewIndex(null);
  }, [detection]);

  useEffect(() => {
    const loadData = async () => {
      const [promptsRes, datasetsRes] = await Promise.all([
        detection ? fetch(`/api/prompts?detection_id=${detection.detection_id}`) : Promise.resolve(new Response("[]")),
        detection ? fetch(`/api/datasets?detection_id=${detection.detection_id}`) : fetch("/api/datasets?unassigned=1"),
      ]);
      const promptPayload = await promptsRes.json();
      const datasetPayload = await datasetsRes.json();
      const promptRows = Array.isArray(promptPayload)
        ? (promptPayload as PromptVersion[])
        : Array.isArray(promptPayload?.items)
          ? (promptPayload.items as PromptVersion[])
          : [];
      const datasetRows = Array.isArray(datasetPayload)
        ? (datasetPayload as Dataset[])
        : Array.isArray(datasetPayload?.items)
          ? (datasetPayload.items as Dataset[])
          : [];
      setPrompts(promptRows);
      setDatasets(datasetRows);
      if (promptRows.length > 0) {
        const storeChoice = detection ? selectedPromptByDetection[detection.detection_id] : "";
        const storeExists = storeChoice && promptRows.some((p) => p.prompt_version_id === storeChoice);
        const fallback = promptRows[0].prompt_version_id;
        setSelectedPromptId((prev) => {
          if (prev && promptRows.some((p) => p.prompt_version_id === prev)) return prev;
          return storeExists ? storeChoice : fallback;
        });
      }
      setSelectedExistingDatasetId((prev) => (datasetRows.some((d) => d.dataset_id === prev) ? prev : ""));
    };
    loadData();
  }, [detection, refreshCounter, selectedPromptByDetection]);

  useEffect(() => {
    if (!selectedExistingDatasetId) return;
    const loadItems = async () => {
      const res = await fetch(`/api/datasets?dataset_id=${selectedExistingDatasetId}`);
      const data = await res.json();
      const items: DatasetItem[] = Array.isArray(data?.items) ? data.items : [];
      setRows(
        items.map((item) => ({
          id: item.item_id,
          preview: item.image_uri,
          imageId: item.image_id,
          groundTruthLabel: item.ground_truth_label ?? null,
          segmentTags: normalizeSegmentTags(item.segment_tags),
          aiAssignedLabel: "",
          aiConfidence: null,
          aiDescription: "",
        }))
      );
      setBuiltDatasetId(selectedExistingDatasetId);

      // Load review flags for this dataset
      const flagsRes = await fetch(`/api/review-flags?dataset_id=${selectedExistingDatasetId}`);
      if (flagsRes.ok) {
        const flagsData = await flagsRes.json();
        const flags: ReviewFlag[] = Array.isArray(flagsData?.flags) ? flagsData.flags : [];
        const openFlags = flags.filter((f) => f.status === "open");
        const resolvedFlags = flags.filter((f) => f.status === "resolved");
        setFlaggedItemIds(new Set(openFlags.map((f) => f.dataset_item_id!).filter(Boolean)));
        const byItemId: Record<string, ReviewFlag> = {};
        for (const f of openFlags) {
          if (f.dataset_item_id) byItemId[f.dataset_item_id] = f;
        }
        setFlagsByItemId(byItemId);
        const resolvedById: Record<string, ReviewFlag> = {};
        for (const f of resolvedFlags) {
          if (f.dataset_item_id) resolvedById[f.dataset_item_id] = f;
        }
        setResolvedFlagsByItemId(resolvedById);
      }
    };
    loadItems();
  }, [selectedExistingDatasetId]);

  useEffect(() => {
    return () => {
      rows.forEach((r) => {
        if (r.file && r.preview.startsWith("blob:")) {
          URL.revokeObjectURL(r.preview);
        }
      });
    };
  }, [rows]);

  useEffect(() => {
    if (previewIndex == null) return;
    if (rows.length === 0) {
      setPreviewIndex(null);
      return;
    }
    if (previewIndex > rows.length - 1) {
      setPreviewIndex(rows.length - 1);
    }
  }, [previewIndex, rows.length]);

  const canRun = useMemo(
    () => !!detection && !!selectedPromptId && !!selectedExistingDatasetId,
    [detection, selectedPromptId, selectedExistingDatasetId]
  );

  const createDatasetFlag = async (itemId: string, reason: string) => {
    const row = rows.find((r) => r.id === itemId);
    if (!row || !detection) return;
    const res = await fetch("/api/review-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_item_id: itemId,
        detection_id: detection.detection_id,
        image_id: row.imageId,
        reason,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      setFlaggedItemIds((prev) => new Set([...prev, itemId]));
      setFlagsByItemId((prev) => ({
        ...prev,
        [itemId]: {
          flag_id: json.flag_id,
          prediction_id: null,
          dataset_item_id: itemId,
          detection_id: detection.detection_id,
          image_id: row.imageId,
          reason,
          status: "open",
          resolution_action: null,
          resolution_note: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        },
      }));
    }
    setFlagModalItemId(null);
  };

  const resolveDatasetFlag = async (flagId: string, action: ResolutionAction, note: string) => {
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
      const flag = Object.values(flagsByItemId).find((f) => f.flag_id === flagId);
      if (flag?.dataset_item_id) {
        const resolvedVersion: ReviewFlag = {
          ...flag,
          status: "resolved",
          resolution_action: action,
          resolution_note: note || null,
          resolved_at: new Date().toISOString(),
        };
        setFlaggedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(flag.dataset_item_id!);
          return next;
        });
        setFlagsByItemId((prev) => {
          const next = { ...prev };
          delete next[flag.dataset_item_id!];
          return next;
        });
        setResolvedFlagsByItemId((prev) => ({
          ...prev,
          [flag.dataset_item_id!]: resolvedVersion,
        }));
      }
    }
    setResolveModalFlagId(null);
  };

  const runOnDataset = async (datasetId: string) => {
    if (!detection) throw new Error("Select a detection to run prompts.");
    setStatus("Starting run...");
    const runRes = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(selectedModel ? { model_override: selectedModel } : {}),
        prompt_version_id: selectedPromptId,
        dataset_id: datasetId,
        detection_id: detection.detection_id,
      }),
    });
    const run = await runRes.json();
    if (!runRes.ok || !run?.run_id) {
      throw new Error(run?.error || "Failed to run inference");
    }
    setActiveRunId(run.run_id);

    const fullRun = await pollRunToTerminalState(run.run_id, (snapshot) => {
      const total = Number(snapshot?.total_images || 0);
      const processed = Number(snapshot?.processed_images || 0);
      const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
      const stateLabel = String(snapshot?.status || "running").toUpperCase();
      setStatus(`Run ${stateLabel}: ${processed}/${total} images (${pct}%)`);
    });

    const predictions = Array.isArray(fullRun?.predictions) ? fullRun.predictions : [];
    const byImageId = new Map<string, any>();
    for (const p of predictions) byImageId.set(p.image_id, p);

    setRows((prev) =>
      prev.map((r) => {
        const p = byImageId.get(r.imageId);
        const aiAssignedLabel =
          p?.parse_ok && (p?.predicted_decision === "DETECTED" || p?.predicted_decision === "NOT_DETECTED")
            ? p.predicted_decision
            : p
              ? "PARSE_FAIL"
              : "";
        return {
          ...r,
          aiAssignedLabel,
          aiConfidence: typeof p?.confidence === "number" ? p.confidence : null,
          aiDescription: p?.evidence || "",
        };
      })
    );

    setSelectedRunForDetection(detection.detection_id, run.run_id);
    triggerRefresh();
    const processed = Number(fullRun?.processed_images || predictions.length || 0);
    const total = Number(fullRun?.total_images || rows.length || 0);
    if (fullRun?.status === "cancelled") {
      setStatus(`Run cancelled. Saved ${processed}/${total} processed images.`);
    } else if (fullRun?.status === "failed") {
      setStatus("Run failed. Partial outputs (if any) were saved.");
    } else {
      setStatus(`Run complete. Processed ${processed}/${total} images.`);
    }
    setActiveRunId(null);
    setCancelingRun(false);
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    setCancelingRun(true);
    setStatus("Cancel requested. Finishing in-flight images...");
    await fetch("/api/runs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: activeRunId, action: "cancel" }),
    });
  };

  const resetBuilder = () => {
    setSelectedExistingDatasetId("");
    setRows([]);
    setBuiltDatasetId(null);
    setStatus("");
    setValidationError("");
  };

  const runDataset = async () => {
    if (!canRun) return;
    setValidationError("");
    setBuilding(true);
    setBuildMode("run");
    try {
      await runOnDataset(selectedExistingDatasetId);
      setBuiltDatasetId(selectedExistingDatasetId);
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Run failed"}`);
      setActiveRunId(null);
      setCancelingRun(false);
    } finally {
      setBuilding(false);
      setBuildMode(null);
    }
  };

  const previewRow = previewIndex != null ? rows[previewIndex] : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Run Inference</h2>
          <p className="app-page-copy">
            Select a labeled dataset and a prompt version, then run inference. Create and manage datasets in the Datasets tab.
          </p>
        </div>
      </div>
      {!detection && (
        <p className="rounded-2xl border border-[rgba(240,180,100,0.2)] bg-[rgba(86,60,27,0.45)] px-4 py-3 text-xs text-[var(--app-warning)]">
          No detection selected: select a detection to run prompt inference against a labeled dataset.
        </p>
      )}

      <div className="app-section space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--app-text-muted)]">
            Select a labeled dataset and a prompt version, then run inference. Create or edit datasets in the Datasets tab.
          </span>
          <button
            onClick={resetBuilder}
            disabled={building}
            className="app-btn app-btn-secondary px-3 py-2 text-xs"
          >
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Prompt Version</label>
            <select
              className="app-select w-full px-3 py-2 text-sm"
              value={selectedPromptId}
              onChange={(e) => setSelectedPromptId(e.target.value)}
            >
              <option value="">Select prompt</option>
              {prompts.map((p) => (
                <option key={p.prompt_version_id} value={p.prompt_version_id}>
                  {p.version_label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Saved Dataset</label>
            <select
              className="app-select w-full px-3 py-2 text-sm"
              value={selectedExistingDatasetId}
              onChange={(e) => setSelectedExistingDatasetId(e.target.value)}
            >
              <option value="">Select dataset</option>
              {selectableDatasets.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.name} ({splitTypeLabel(d.split_type)}, {d.size} images)
                </option>
              ))}
            </select>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="app-table-wrap max-h-72 overflow-auto">
            {(flaggedItemIds.size > 0 || Object.keys(resolvedFlagsByItemId).length > 0) && (
              <div className="px-3 py-2 flex gap-2 items-center border-b border-white/6">
                <button
                  onClick={() => setDatasetFlagFilter((v) => v === "open" ? false : "open")}
                  className={`app-toggle text-xs ${datasetFlagFilter === "open" ? "app-toggle-active" : ""}`}
                >
                  Flagged — Open ({flaggedItemIds.size})
                </button>
                <button
                  onClick={() => setDatasetFlagFilter((v) => v === "resolved" ? false : "resolved")}
                  className={`app-toggle text-xs ${datasetFlagFilter === "resolved" ? "app-toggle-active" : ""}`}
                >
                  Flagged — Resolved ({Object.keys(resolvedFlagsByItemId).length})
                </button>
              </div>
            )}
            <table className="app-table app-table-fixed text-xs">
              <colgroup>
                <col style={{ width: "7.5rem" }} />
                <col style={{ width: "12rem" }} />
                <col style={{ width: "9rem" }} />
                <col style={{ width: "14rem" }} />
                <col style={{ width: "8.5rem" }} />
                <col style={{ width: "7.5rem" }} />
                <col />
                <col style={{ width: "7rem" }} />
              </colgroup>
              <thead className="sticky top-0">
                <tr>
                  <th className="app-table-col-label">Preview</th>
                  <th className="app-table-col-label">Image ID</th>
                  <th className="app-table-col-label">Ground Truth</th>
                  <th className="app-table-col-label">Attributes</th>
                  <th className="app-table-col-label">AI Label</th>
                  <th className="app-table-col-label">Confidence</th>
                  <th className="app-table-col-label">AI Description</th>
                  <th className="app-table-col-label">Flag</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => {
                    if (datasetFlagFilter === "open") return flaggedItemIds.has(r.id);
                    if (datasetFlagFilter === "resolved") return !!resolvedFlagsByItemId[r.id];
                    return true;
                  })
                  .map((r, index) => (
                  <tr key={r.id}>
                    <td>
                      <img
                        src={r.preview}
                        alt={r.imageId}
                        className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer"
                        onClick={() => setPreviewIndex(index)}
                      />
                    </td>
                    <td>
                      <div className="w-full py-1 text-xs font-mono text-gray-300">{r.imageId}</div>
                    </td>
                    <td className="app-table-col-label">
                      <div className="app-table-left-slot">
                        <GroundTruthBadge value={r.groundTruthLabel || null} />
                      </div>
                    </td>
                    <td>
                      <SegmentTagList value={r.segmentTags} />
                    </td>
                    <td className="app-table-col-label">
                      <div className="app-table-left-slot">
                        <LabelBadge label={r.aiAssignedLabel || "—"} />
                      </div>
                    </td>
                    <td className="app-table-col-label text-gray-300 whitespace-nowrap">
                      <div className="app-table-left-slot">
                        <span>{typeof r.aiConfidence === "number" ? r.aiConfidence.toFixed(2) : "—"}</span>
                      </div>
                    </td>
                    <td className="text-gray-400 max-w-xs truncate" title={r.aiDescription || ""}>
                      {r.aiDescription || "—"}
                    </td>
                    <td className="app-table-col-label">
                      <div className="app-table-left-slot">
                        {flaggedItemIds.has(r.id) ? (
                          <button
                            onClick={() => {
                              const flag = flagsByItemId[r.id];
                              if (flag) setResolveModalFlagId(flag.flag_id);
                            }}
                            className="app-btn app-btn-sm text-[10px] text-amber-400 border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20"
                            title={flagsByItemId[r.id]?.reason || "Flagged"}
                          >
                            Flagged
                          </button>
                        ) : (
                          <button
                            onClick={() => setFlagModalItemId(r.id)}
                            className="app-btn app-btn-subtle app-btn-sm text-[10px]"
                          >
                            Flag
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runDataset}
            disabled={!canRun || building}
            className="app-btn app-btn-success app-btn-md text-xs"
          >
            {building && buildMode === "run" ? "Running..." : "Run"}
          </button>
          {building && buildMode === "run" && activeRunId && (
            <button
              onClick={cancelRun}
              disabled={cancelingRun}
              className="app-btn app-btn-danger px-3 py-2 text-xs"
            >
              {cancelingRun ? "Cancelling..." : "Cancel Run"}
            </button>
          )}
          {builtDatasetId && (
            <button onClick={() => setActiveTab(2)} className="app-btn app-btn-subtle app-btn-md text-xs">
              Go to HIL Review
            </button>
          )}
        </div>
        {status && <div className="text-xs text-[var(--app-text-muted)]">{status}</div>}
        {validationError && <div className="text-xs text-[var(--app-danger)]">{validationError}</div>}
      </div>

      <ImagePreviewModal
        isOpen={previewIndex != null && !!previewRow}
        imageUrl={previewRow?.preview || ""}
        imageAlt={previewRow?.imageId || "Preview"}
        title="Dataset Preview"
        subtitle={previewRow?.imageId || ""}
        index={previewIndex ?? 0}
        total={rows.length}
        onClose={() => setPreviewIndex(null)}
        onPrev={() => setPreviewIndex((i) => (i == null ? null : Math.max(0, i - 1)))}
        onNext={() => setPreviewIndex((i) => (i == null ? null : Math.min(rows.length - 1, i + 1)))}
        details={
          previewRow ? (
            <div className="space-y-3">
              {/* Flag for Secondary Review — at top */}
              <div className="border-b border-white/6 pb-3">
                  <label className="text-xs text-gray-500 block mb-1">Secondary Review</label>
                  {flaggedItemIds.has(previewRow.id) ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
                        <span className="text-xs text-amber-400 font-medium">Flagged for review</span>
                      </div>
                      {flagsByItemId[previewRow.id]?.reason && (
                        <p className="text-xs text-gray-300 bg-gray-800 rounded p-2">{flagsByItemId[previewRow.id].reason}</p>
                      )}
                      <button
                        onClick={() => {
                          const flag = flagsByItemId[previewRow.id];
                          if (flag) setResolveModalFlagId(flag.flag_id);
                        }}
                        className="app-btn app-btn-sm text-[10px] text-amber-400 border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20"
                      >
                        Resolve Flag
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setFlagModalItemId(previewRow.id)}
                      className="app-btn app-btn-subtle app-btn-sm text-[10px]"
                    >
                      Flag for Secondary Review
                    </button>
                  )}
                </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Image ID</label>
                <div className="w-full py-1.5 text-xs font-mono text-gray-300">{previewRow.imageId}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ground Truth</label>
                <div className="w-full py-1.5 text-xs text-gray-300">
                  <GroundTruthBadge value={previewRow.groundTruthLabel || null} />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs text-gray-500 block">Attributes</label>
                  <InfoTip label="What are image attributes?">
                    Use attributes to tag conditions that can change model performance or hide the target, such as
                    `snow_on_ground`, `dark_image`, `blurry_image`, `glare`, or `partial_view`. Pick reusable tags that
                    help you balance datasets and compare results by slice later.
                  </InfoTip>
                </div>
                <SegmentTagList value={previewRow.segmentTags} />
              </div>

              {/* Resolved flag history — below attributes */}
              {resolvedFlagsByItemId[previewRow.id] && (
                <div className="border-t border-white/6 pt-3">
                  <label className="text-xs text-gray-500 block mb-1">Resolved Secondary Review</label>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-gray-500">Question: </span>
                      <span className="text-gray-300">{resolvedFlagsByItemId[previewRow.id].reason}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Resolution: </span>
                      <span className="text-gray-300">{resolvedFlagsByItemId[previewRow.id].resolution_action?.replace(/_/g, " ") || "—"}</span>
                    </div>
                    {resolvedFlagsByItemId[previewRow.id].resolution_note && (
                      <div>
                        <span className="text-gray-500">Note: </span>
                        <span className="text-gray-300">{resolvedFlagsByItemId[previewRow.id].resolution_note}</span>
                      </div>
                    )}
                    {resolvedFlagsByItemId[previewRow.id].resolved_at && (
                      <div className="text-gray-500">
                        Resolved {new Date(resolvedFlagsByItemId[previewRow.id].resolved_at!).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 block mb-1">AI Description</label>
                <div className="text-xs text-gray-300 whitespace-pre-wrap break-words">{previewRow.aiDescription || "—"}</div>
              </div>
            </div>
          ) : null
        }
      />

      {flagModalItemId && (
        <DatasetFlagModal
          onSubmit={(reason) => createDatasetFlag(flagModalItemId, reason)}
          onCancel={() => setFlagModalItemId(null)}
        />
      )}

      {resolveModalFlagId && (
        <DatasetResolveModal
          flag={Object.values(flagsByItemId).find((f) => f.flag_id === resolveModalFlagId)!}
          onSubmit={(action, note) => resolveDatasetFlag(resolveModalFlagId, action, note)}
          onCancel={() => setResolveModalFlagId(null)}
        />
      )}
    </div>
  );
}

async function pollRunToTerminalState(runId: string, onProgress?: (snapshot: any) => void): Promise<any> {
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

function normalizeSegmentTags(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v || "").trim()).filter(Boolean);
    return dedupeStrings(parts);
  }
  const str = String(value).trim();
  if (str.startsWith("[")) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return dedupeStrings(parsed.map((v: unknown) => String(v || "").trim()).filter(Boolean));
    } catch { /* fall through */ }
  }
  const rawParts = str.split(/[;,|]/g).map((v) => v.trim());
  return dedupeStrings(rawParts);
}

function dedupeStrings(parts: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(part);
  }
  return tags;
}

function GroundTruthBadge({ value }: { value: "DETECTED" | "NOT_DETECTED" | null }) {
  if (value) return <DecisionBadge decision={value} />;
  return <span className="app-badge app-badge-muted">Unset</span>;
}

function SegmentTagList({ value }: { value: string[] }) {
  if (!value.length) return <span className="text-gray-500 text-[11px]">No attributes</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {value.map((tag) => (
        <span key={tag} className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-200 text-[11px]">
          {tag}
        </span>
      ))}
    </div>
  );
}

function LabelBadge({ label }: { label: string }) {
  if (label === "DETECTED" || label === "NOT_DETECTED" || label === "PARSE_FAIL") {
    return <DecisionBadge decision={label} />;
  }
  if (label === "UNSET") {
    return <span className="app-badge app-badge-muted">Unset</span>;
  }
  return <span className="text-gray-300">{label}</span>;
}

const DATASET_RESOLUTION_ACTIONS: { value: ResolutionAction; label: string }[] = [
  { value: "label_confirmed", label: "Label Confirmed" },
  { value: "label_corrected", label: "Label Corrected" },
  { value: "attributes_corrected", label: "Attributes Corrected" },
  { value: "image_removed", label: "Image Removed" },
  { value: "needs_discussion", label: "Needs Discussion" },
];

function DatasetFlagModal({
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
          placeholder="e.g., Unsure about the ground truth label — could be either..."
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

function DatasetResolveModal({
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
            {DATASET_RESOLUTION_ACTIONS.map((a) => (
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
