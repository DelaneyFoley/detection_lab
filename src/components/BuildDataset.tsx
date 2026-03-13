"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection, PromptVersion } from "@/types";
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
  const { apiKey, selectedModel, setActiveTab, setSelectedRunForDetection, triggerRefresh, refreshCounter } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [mode, setMode] = useState<"load" | "build">("load");

  const [selectedExistingDatasetId, setSelectedExistingDatasetId] = useState("");

  const [datasetName, setDatasetName] = useState("");
  const [splitType, setSplitType] = useState<"" | "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL" | "AUTO_SPLIT">("");
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [buildInputMode, setBuildInputMode] = useState<"files" | "excel" | "json">("files");
  const [excelFileName, setExcelFileName] = useState("");
  const [jsonInput, setJsonInput] = useState("");

  const [building, setBuilding] = useState(false);
  const [buildMode, setBuildMode] = useState<"save" | "run" | null>(null);
  const [status, setStatus] = useState("");
  const [builtDatasetId, setBuiltDatasetId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelingRun, setCancelingRun] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [segmentOptionsDraft, setSegmentOptionsDraft] = useState<string[]>(
    Array.isArray(detection?.segment_taxonomy) ? detection.segment_taxonomy.filter(Boolean) : []
  );
  const [newSegmentOption, setNewSegmentOption] = useState("");
  const [savingSegments, setSavingSegments] = useState(false);
  const autoSplit = splitType === "AUTO_SPLIT";

  const segmentOptions = useMemo(() => {
    return segmentOptionsDraft;
  }, [segmentOptionsDraft]);

  useEffect(() => {
    if (!detection) return;
    setMode("load");
    setSelectedExistingDatasetId("");
    setRows([]);
    setDatasetName("");
    setSplitType("");
    setBuildInputMode("files");
    setExcelFileName("");
    setJsonInput("");
    setBuiltDatasetId(null);
    setStatus("");
    setValidationError("");
    setPreviewIndex(null);
  }, [detection]);

  useEffect(() => {
    setSegmentOptionsDraft(Array.isArray(detection?.segment_taxonomy) ? detection.segment_taxonomy.filter(Boolean) : []);
  }, [detection?.segment_taxonomy, detection?.detection_id]);

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
      if (promptRows[0]?.prompt_version_id) {
        setSelectedPromptId((prev) => prev || promptRows[0].prompt_version_id);
      }
      setSelectedExistingDatasetId((prev) => (datasetRows.some((d) => d.dataset_id === prev) ? prev : ""));
    };
    loadData();
  }, [detection, refreshCounter]);

  useEffect(() => {
    if (mode !== "load" || !selectedExistingDatasetId) return;
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
    };
    loadItems();
  }, [mode, selectedExistingDatasetId]);

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

  const canSave = useMemo(
    () => mode === "build" && rows.length > 0 && datasetName.trim().length > 0 && splitType !== "" && validateImageIds(rows).ok,
    [mode, rows, datasetName, splitType]
  );
  const canRun = useMemo(
    () => !!detection && !!selectedPromptId && (mode === "load" ? !!selectedExistingDatasetId : canSave),
    [detection, selectedPromptId, mode, selectedExistingDatasetId, canSave]
  );
  const selectedBuildFileCount = useMemo(() => rows.filter((r) => !!r.file).length, [rows]);

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;
    const next = picked.map((file, i) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        id: `${Date.now()}_${i}_${base}`,
        file,
        preview: URL.createObjectURL(file),
        imageId: sanitizeImageId(base || `image_${i + 1}`),
        groundTruthLabel: null,
        segmentTags: ["Baseline"],
        aiAssignedLabel: "" as const,
        aiConfidence: null,
        aiDescription: "",
      };
    });
    setRows((prev) => [...prev, ...next]);
    setValidationError("");
    event.currentTarget.value = "";
  };

  const onPickExcelFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseExcelManifest(file);
      const mapped: BuildRow[] = parsed.map((row, i) => ({
        id: `${Date.now()}_xlsx_${i}_${row.image_id}`,
        preview: row.image_url,
        imageId: row.image_id,
        groundTruthLabel: row.ground_truth_label,
        segmentTags: normalizeSegmentTags(row.segment_tags),
        aiAssignedLabel: "",
        aiConfidence: null,
        aiDescription: "",
      }));
      setRows(mapped);
      setExcelFileName(file.name);
      setValidationError("");
      setStatus(`Loaded ${mapped.length} rows from ${file.name}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to parse Excel";
      setValidationError(msg);
    } finally {
      event.currentTarget.value = "";
    }
  };

  const loadFromJsonInput = () => {
    try {
      const parsed = parseJsonManifest(jsonInput);
      const mapped: BuildRow[] = parsed.map((row, i) => ({
        id: `${Date.now()}_json_${i}_${row.image_id}`,
        preview: row.image_url,
        imageId: row.image_id,
        groundTruthLabel: row.ground_truth_label,
        segmentTags: normalizeSegmentTags(row.segment_tags),
        aiAssignedLabel: "",
        aiConfidence: null,
        aiDescription: "",
      }));
      setRows(mapped);
      setValidationError("");
      setStatus(`Loaded ${mapped.length} rows from JSON.`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to parse JSON";
      setValidationError(msg);
    }
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.file && target.preview.startsWith("blob:")) URL.revokeObjectURL(target.preview);
      return prev.filter((r) => r.id !== id);
    });
    setValidationError("");
  };

  const updateRow = (id: string, patch: Partial<BuildRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addSegmentOption = () => {
    const next = String(newSegmentOption || "").trim();
    if (!next) return;
    if (segmentOptionsDraft.some((item) => item.toLowerCase() === next.toLowerCase())) return;
    setSegmentOptionsDraft((prev) => [...prev, next]);
    setNewSegmentOption("");
  };

  const removeSegmentOption = (value: string) => {
    setSegmentOptionsDraft((prev) => prev.filter((item) => item !== value));
  };

  const saveSegmentOptions = async () => {
    if (!detection) return;
    setSavingSegments(true);
    try {
      const res = await fetch("/api/detections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_id: detection.detection_id,
          display_name: detection.display_name,
          description: detection.description,
          detection_category: detection.detection_category,
          label_policy: detection.label_policy,
          user_prompt_addendum: detection.user_prompt_addendum,
          decision_rubric: Array.isArray(detection.decision_rubric) ? detection.decision_rubric : [],
          segment_taxonomy: segmentOptionsDraft,
          metric_thresholds: detection.metric_thresholds,
          approved_prompt_version: detection.approved_prompt_version,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update image attributes");
      }
      triggerRefresh();
      setStatus("Image attributes updated for this detection.");
    } catch (error: unknown) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Failed to update image attributes"}`);
    } finally {
      setSavingSegments(false);
    }
  };

  const createDatasetOnly = async () => {
    if (splitType !== "ITERATION" && splitType !== "GOLDEN" && splitType !== "HELD_OUT_EVAL") {
      throw new Error("Select TRAIN, TEST, or EVAL to save a single dataset.");
    }
    const validation = validateImageIds(rows);
    if (!validation.ok) throw new Error(validation.error);

    setStatus("Saving dataset...");
    const allRowsHaveFiles = rows.every((r) => !!r.file);
      const createRes = allRowsHaveFiles
      ? await (async () => {
          const formData = new FormData();
          formData.append("name", datasetName.trim());
          if (detection?.detection_id) formData.append("detection_id", detection.detection_id);
          formData.append("split_type", splitType);
          formData.append(
            "items",
            JSON.stringify(
              rows.map((r) => ({
                image_id: r.imageId.trim(),
                image_description: "",
                ground_truth_label: r.groundTruthLabel,
                segment_tags: r.segmentTags,
              }))
            )
          );
          rows.forEach((r) => {
            if (r.file) formData.append("files", r.file);
          });
          return fetch("/api/datasets", { method: "POST", body: formData });
        })()
      : await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: datasetName.trim(),
            detection_id: detection?.detection_id || null,
            split_type: splitType,
            items: rows.map((r) => ({
              image_id: r.imageId.trim(),
              image_uri: r.preview,
              image_description: "",
              ground_truth_label: r.groundTruthLabel,
              segment_tags: r.segmentTags,
            })),
          }),
        });
    const created = await createRes.json();
    if (!createRes.ok || !created?.dataset_id) {
      throw new Error(created?.error || "Failed to create dataset");
    }

    const datasetId = created.dataset_id as string;
    setBuiltDatasetId(datasetId);
    triggerRefresh();
    return datasetId;
  };

  const createSplitDatasets = async (): Promise<string | null> => {
    const validation = validateImageIds(rows);
    if (!validation.ok) throw new Error(validation.error);
    if (rows.some((r) => !r.groundTruthLabel)) {
      throw new Error("Auto-split requires ground_truth_label for every row.");
    }
    const hasLocalFiles = rows.some((r) => !!r.file);
    setStatus("Creating TRAIN/TEST/EVAL datasets...");

    const splitRows = splitRowsForAutoSplit(rows);
    if (!hasLocalFiles) {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_split_datasets",
          detection_id: detection?.detection_id || null,
          name_prefix: datasetName.trim(),
          items: rows.map((r) => ({
            image_id: r.imageId.trim(),
            image_uri: r.preview,
            ground_truth_label: r.groundTruthLabel,
            segment_tags: r.segmentTags,
          })),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to create split datasets");
      }
      triggerRefresh();
      setStatus(
        `Created split datasets: TRAIN=${payload?.created?.[0]?.size || 0}, TEST=${payload?.created?.[1]?.size || 0}, EVAL=${payload?.created?.[2]?.size || 0}.`
      );
      const created = Array.isArray(payload?.created) ? payload.created : [];
      const train = created.find((d: any) => d?.split_type === "ITERATION");
      return train?.dataset_id || null;
    }

    const splitDefinitions: Array<{ key: "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL"; label: string }> = [
      { key: "ITERATION", label: "TRAIN" },
      { key: "GOLDEN", label: "TEST" },
      { key: "HELD_OUT_EVAL", label: "EVAL" },
    ];

    let trainDatasetId: string | null = null;
    for (const split of splitDefinitions) {
      const itemsForSplit = splitRows[split.key];
      if (itemsForSplit.length === 0) continue;
      const formData = new FormData();
      formData.append("name", `${datasetName.trim()} (${split.label})`);
      if (detection?.detection_id) formData.append("detection_id", detection.detection_id);
      formData.append("split_type", split.key);
      formData.append(
        "items",
        JSON.stringify(
          itemsForSplit.map((r) => ({
            image_id: r.imageId.trim(),
            image_description: "",
            ground_truth_label: r.groundTruthLabel,
            segment_tags: r.segmentTags,
          }))
        )
      );
      for (const row of itemsForSplit) {
        if (!row.file) throw new Error("Auto-split with files requires file-backed rows.");
        formData.append("files", row.file);
      }

      const res = await fetch("/api/datasets", { method: "POST", body: formData });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `Failed to create ${split.label} dataset`);
      }
      if (split.key === "ITERATION" && payload?.dataset_id) {
        trainDatasetId = String(payload.dataset_id);
      }
    }

    triggerRefresh();
    setStatus(
      `Created split datasets: TRAIN=${splitRows.ITERATION.length}, TEST=${splitRows.GOLDEN.length}, EVAL=${splitRows.HELD_OUT_EVAL.length}.`
    );
    return trainDatasetId;
  };

  const runOnDataset = async (datasetId: string) => {
    if (!detection) throw new Error("Select a detection to run prompts.");
    setStatus("Starting run...");
    const runRes = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        model_override: selectedModel,
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
    if (mode === "load") {
      setSelectedExistingDatasetId("");
      setRows([]);
      setBuiltDatasetId(null);
      setStatus("");
      setValidationError("");
      return;
    }
    setDatasetName("");
    setSplitType("ITERATION");
    setRows([]);
    setBuildInputMode("files");
    setExcelFileName("");
    setJsonInput("");
    setSplitType("");
    setBuiltDatasetId(null);
    setStatus("");
    setValidationError("");
    setPreviewIndex(null);
  };

  const saveDataset = async () => {
    if (!canSave) return;
    const validation = validateImageIds(rows);
    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }
    setValidationError("");
    setBuilding(true);
    setBuildMode("save");
    setBuiltDatasetId(null);
    try {
      if (autoSplit) {
        await createSplitDatasets();
      } else {
        await createDatasetOnly();
        setStatus("Dataset saved.");
      }
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Save failed"}`);
    } finally {
      setBuilding(false);
      setBuildMode(null);
    }
  };

  const runDataset = async () => {
    if (!canRun) return;
    setValidationError("");
    setBuilding(true);
    setBuildMode("run");
    try {
      if (autoSplit) {
        const trainDatasetId = await createSplitDatasets();
        if (!trainDatasetId) {
          throw new Error("Auto-split did not produce a TRAIN dataset to run.");
        }
        await runOnDataset(trainDatasetId);
        setBuiltDatasetId(trainDatasetId);
        return;
      }
      let datasetId = selectedExistingDatasetId;
      if (mode === "build") {
        datasetId = builtDatasetId || (await createDatasetOnly());
      }
      await runOnDataset(datasetId);
      setBuiltDatasetId(datasetId);
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
          <h2 className="app-page-title">Build & Run Datasets</h2>
          <p className="app-page-copy">
            Load an existing labeled dataset or build a new one from images, Excel, or JSON before running prompt inference.
          </p>
        </div>
      </div>
      {!detection && (
        <p className="rounded-2xl border border-[rgba(240,180,100,0.2)] bg-[rgba(86,60,27,0.45)] px-4 py-3 text-xs text-[var(--app-warning)]">
          No detection selected: you can build/save unassigned datasets, but running prompt inference is disabled.
        </p>
      )}

      <div className="app-section space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setMode("load");
                setRows([]);
                setBuiltDatasetId(null);
                setStatus("");
                setValidationError("");
                setPreviewIndex(null);
              }}
              className={`app-toggle ${mode === "load" ? "app-toggle-active" : ""}`}
            >
              Load Dataset
            </button>
            <button
              onClick={() => {
                setMode("build");
                setRows([]);
                setDatasetName("");
                setSplitType("");
                setBuildInputMode("files");
                setExcelFileName("");
                setJsonInput("");
                setBuiltDatasetId(null);
                setStatus("");
                setValidationError("");
                setPreviewIndex(null);
              }}
              className={`app-toggle ${mode === "build" ? "app-toggle-active" : ""}`}
            >
              Build Dataset
            </button>
          </div>
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

          {mode === "load" ? (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Saved Dataset</label>
              <select
                className="app-select w-full px-3 py-2 text-sm"
                value={selectedExistingDatasetId}
                onChange={(e) => setSelectedExistingDatasetId(e.target.value)}
              >
                <option value="">Select dataset</option>
                {datasets.map((d) => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.name} ({splitTypeLabel(d.split_type)}, {d.size} images)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
                <input
                  className={`app-input w-full px-3 py-2 text-sm ${
                    datasetName.trim() ? "" : "border-red-500/70"
                  }`}
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                />
                {!datasetName.trim() && <p className="mt-1 text-[11px] text-red-400">Dataset name is required.</p>}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Split Type</label>
                <select
                  className={`app-select w-full px-3 py-2 text-sm ${
                    splitType ? "" : "border-red-500/70"
                  }`}
                  value={splitType}
                  onChange={(e) =>
                    setSplitType(e.target.value as "" | "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL" | "AUTO_SPLIT")
                  }
                >
                  <option value="">Select split type</option>
                  <option value="ITERATION">TRAIN</option>
                  <option value="GOLDEN">TEST</option>
                  <option value="HELD_OUT_EVAL">EVAL</option>
                  <option value="AUTO_SPLIT">AUTO-SPLIT</option>
                </select>
                {!splitType && <p className="mt-1 text-[11px] text-red-400">Split type is required.</p>}
              </div>
            </>
          )}
        </div>

        {mode === "build" && (
          <div className="space-y-6 border-t border-white/8 pt-5">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="app-label mb-1">Dataset Source</div>
                  <p className="app-subsection-copy">
                    Choose how you want to assemble this dataset, then load files or metadata for the build.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setBuildInputMode("files")}
                    className={`app-toggle ${buildInputMode === "files" ? "app-toggle-active" : ""}`}
                  >
                    Upload Images
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildInputMode("excel")}
                    className={`app-toggle ${buildInputMode === "excel" ? "app-toggle-active" : ""}`}
                  >
                    Upload Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildInputMode("json")}
                    className={`app-toggle ${buildInputMode === "json" ? "app-toggle-active" : ""}`}
                  >
                    Paste JSON
                  </button>
                </div>

                <div className="space-y-2 border-t border-white/8 pt-4">
                  {buildInputMode === "files" ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          id="build-dataset-files-input"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={onPickFiles}
                          className="hidden"
                        />
                        <label
                          htmlFor="build-dataset-files-input"
                          className="app-btn app-btn-secondary app-btn-sm cursor-pointer"
                        >
                          Choose Files
                        </label>
                        {selectedBuildFileCount > 0 && (
                          <span className="text-xs text-gray-500">{selectedBuildFileCount} Files Selected</span>
                        )}
                      </div>
                    </>
                  ) : buildInputMode === "excel" ? (
                    <>
                      <div className="space-y-1">
                        <label className="block text-xs text-gray-400">
                          Excel Manifest {excelFileName ? `• ${excelFileName}` : ""}
                        </label>
                        <p className="text-[11px] text-gray-500">
                          Required columns: `image_id`, `image_url`, `ground_truth_label`
                        </p>
                        <p className="text-[11px] text-gray-500">
                          Optional column: `attributes` with comma-separated values
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          id="build-dataset-excel-input"
                          type="file"
                          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          onChange={onPickExcelFile}
                          className="hidden"
                        />
                        <label
                          htmlFor="build-dataset-excel-input"
                          className="app-btn app-btn-secondary app-btn-sm cursor-pointer"
                        >
                          Choose Files
                        </label>
                        {excelFileName && <span className="text-xs text-gray-500">1 File Selected</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block text-xs text-gray-400">
                        JSON Array (`image_id`, `image_url` or `image_uri`, optional `ground_truth_label`, optional `attribute_tags`)
                      </label>
                      <textarea
                        className="app-textarea h-36 w-full px-3 py-2 text-xs font-mono"
                        value={jsonInput}
                        onChange={(e) => setJsonInput(e.target.value)}
                        placeholder={`[\n  {"image_id":"img_001","image_url":"https://...","ground_truth_label":"DETECTED","attribute_tags":["daytime"]}\n]`}
                      />
                      <button
                        type="button"
                        onClick={loadFromJsonInput}
                        className="app-btn app-btn-secondary app-btn-sm"
                      >
                        Load JSON
                      </button>
                    </>
                  )}
                </div>

                {autoSplit && (
                  <p className="border-t border-white/8 pt-4 text-xs text-gray-400">
                    Auto-split creates TRAIN, TEST, and EVAL datasets in a 50/20/30 split. It stratifies by ground truth label
                    and balances attributes where available. All rows must have `ground_truth_label` set before saving.
                  </p>
                )}
              </div>

              {detection && (
                <div className="space-y-4 border-t border-white/8 pt-4 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="app-label">Image Attributes</div>
                      <InfoTip label="What are image attributes?">
                        Use attributes to tag conditions that can change model performance or hide the target, such as
                        `snow_on_ground`, `dark_image`, `blurry_image`, `glare`, or `partial_view`. Pick reusable tags that
                        help you balance datasets and compare results by slice later.
                      </InfoTip>
                    </div>
                    <div className="text-[11px] text-gray-500">{segmentOptionsDraft.length} total</div>
                  </div>

                  <p className="app-subsection-copy">
                    Saving here updates the detection image attributes and does not create a new prompt version.
                  </p>

                  <div className="min-h-12 px-0 py-1">
                    <div className="flex flex-wrap gap-1.5">
                      {segmentOptionsDraft.map((segment) => (
                        <span key={segment} className="inline-flex items-center gap-1 rounded-lg bg-white/6 px-2 py-0.5 text-xs text-gray-200">
                          {segment}
                          <button type="button" className="text-gray-400 hover:text-red-300" onClick={() => removeSegmentOption(segment)}>
                            ×
                          </button>
                        </span>
                      ))}
                      {segmentOptionsDraft.length === 0 && <span className="text-xs text-gray-500">No image attributes yet.</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      className="app-input min-w-0 px-3 py-2 text-sm"
                      placeholder="Add image attribute"
                      value={newSegmentOption}
                      onChange={(e) => setNewSegmentOption(e.target.value)}
                    />
                    <button type="button" onClick={addSegmentOption} className="app-btn app-btn-secondary app-btn-md">
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={saveSegmentOptions}
                      disabled={savingSegments}
                      className="app-btn app-btn-secondary app-btn-md disabled:opacity-50"
                    >
                      {savingSegments ? "Saving..." : "Save Attributes"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="app-table-wrap max-h-72 overflow-auto">
            <table className="app-table app-table-fixed text-xs">
              <colgroup>
                <col style={{ width: "7.5rem" }} />
                <col style={{ width: "12rem" }} />
                <col style={{ width: "9rem" }} />
                <col style={{ width: "16rem" }} />
                <col style={{ width: "8.5rem" }} />
                <col style={{ width: "7.5rem" }} />
                <col />
                {mode === "build" && <col style={{ width: "5.75rem" }} />}
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
                  {mode === "build" && <th className="app-table-col-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, index) => (
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
                      {mode === "build" ? (
                        <input
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                          value={r.imageId}
                          onChange={(e) => updateRow(r.id, { imageId: sanitizeImageId(e.target.value) })}
                        />
                      ) : (
                        <div className="w-full py-1 text-xs font-mono text-gray-300">{r.imageId}</div>
                      )}
                    </td>
                    <td className="app-table-col-label">
                      <div className="app-table-left-slot">
                        {mode === "build" ? (
                          <select
                            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                            value={r.groundTruthLabel || ""}
                            onChange={(e) =>
                              updateRow(r.id, { groundTruthLabel: (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null })
                            }
                          >
                            <option value="">UNSET</option>
                            <option value="DETECTED">DETECTED</option>
                            <option value="NOT_DETECTED">NOT_DETECTED</option>
                          </select>
                        ) : (
                          <GroundTruthBadge value={r.groundTruthLabel || null} />
                        )}
                      </div>
                    </td>
                    <td>
                      {mode === "build" ? (
                        <SegmentTagsEditor
                          value={r.segmentTags}
                          options={segmentOptions}
                          onChange={(next) => updateRow(r.id, { segmentTags: next })}
                        />
                      ) : (
                        <SegmentTagList value={r.segmentTags} />
                      )}
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
                    {mode === "build" && (
                      <td className="app-table-col-right">
                        <button className="text-red-400 hover:text-red-300" onClick={() => removeRow(r.id)}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {mode === "build" && (
            <button
              onClick={saveDataset}
              disabled={!canSave || building}
              className="app-btn app-btn-subtle app-btn-md text-xs"
            >
              {building && buildMode === "save" ? "Saving..." : "Save"}
            </button>
          )}
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
              <div>
                <label className="text-xs text-gray-500 block mb-1">Image ID</label>
                {mode === "build" ? (
                  <input
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono"
                    value={previewRow.imageId}
                    onChange={(e) => updateRow(previewRow.id, { imageId: sanitizeImageId(e.target.value) })}
                  />
                ) : (
                  <div className="w-full py-1.5 text-xs font-mono text-gray-300">{previewRow.imageId}</div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ground Truth</label>
                {mode === "build" ? (
                  <select
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
                    value={previewRow.groundTruthLabel || ""}
                    onChange={(e) =>
                      updateRow(previewRow.id, {
                        groundTruthLabel: (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null,
                      })
                    }
                  >
                    <option value="">UNSET</option>
                    <option value="DETECTED">DETECTED</option>
                    <option value="NOT_DETECTED">NOT_DETECTED</option>
                  </select>
                ) : (
                  <div className="w-full py-1.5 text-xs text-gray-300">
                    <GroundTruthBadge value={previewRow.groundTruthLabel || null} />
                  </div>
                )}
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
                {mode === "build" ? (
                  <SegmentTagsEditor
                    value={previewRow.segmentTags}
                    options={segmentOptions}
                    onChange={(next) => updateRow(previewRow.id, { segmentTags: next })}
                  />
                ) : (
                  <SegmentTagList value={previewRow.segmentTags} />
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">AI Description</label>
                <div className="text-xs text-gray-300 whitespace-pre-wrap break-words">{previewRow.aiDescription || "—"}</div>
              </div>
              {mode === "build" && (
                <div className="pt-1">
                  <button
                    type="button"
                    className="text-xs px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-white"
                    onClick={() => {
                      removeRow(previewRow.id);
                      setPreviewIndex((idx) => {
                        if (idx == null) return null;
                        if (rows.length <= 1) return null;
                        return Math.max(0, Math.min(idx, rows.length - 2));
                      });
                    }}
                  >
                    Remove Image
                  </button>
                </div>
              )}
            </div>
          ) : null
        }
      />
    </div>
  );
}

function sanitizeImageId(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function validateImageIds(rows: BuildRow[]): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const row of rows) {
    const imageId = row.imageId.trim();
    if (!imageId) return { ok: false, error: "Each image needs a non-blank Image ID." };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate image_id: ${imageId}` };
    seen.add(imageId);
  }
  return { ok: true };
}

async function parseExcelManifest(file: File): Promise<Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
  segment_tags?: string[] | string;
}>> {
  const xlsx = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Excel file has no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return normalizeManifestRows(rawRows, "Excel");
}

function parseJsonManifest(input: string): Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
  segment_tags?: string[] | string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(input || ""));
  } catch {
    throw new Error("Invalid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("JSON must be a non-empty array.");
  }
  return normalizeManifestRows(parsed as Array<Record<string, unknown>>, "JSON");
}

function normalizeManifestRows(
  rowsInput: Array<Record<string, unknown>>,
  sourceLabel: string
): Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
  segment_tags?: string[] | string;
}> {
  const rows: Array<{
    image_id: string;
    image_url: string;
    ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
    segment_tags?: string[] | string;
  }> = [];

  for (let i = 0; i < rowsInput.length; i++) {
    const row = rowsInput[i] || {};
    const imageId = sanitizeImageId(String(row.image_id || row.imageId || ""));
    const imageUrl = String(row.image_url || row.image_uri || row.imageUri || "").trim();
    const rawLabel = String(row.ground_truth_label || row.groundTruthLabel || "").trim().toUpperCase();
    const segmentTags = (row.segment_tags ?? row.segmentTags ?? row.attribute_tags ?? row.attributeTags ?? row.attributes ?? row.segments ?? "") as string[] | string;
    if (!imageId) {
      throw new Error(`${sourceLabel} row ${i + 1} has blank image_id.`);
    }
    if (!imageUrl) {
      throw new Error(`${sourceLabel} row ${i + 1} has blank image_url/image_uri.`);
    }
    let label: "DETECTED" | "NOT_DETECTED" | null = null;
    if (rawLabel) {
      if (rawLabel !== "DETECTED" && rawLabel !== "NOT_DETECTED") {
        throw new Error(`${sourceLabel} row ${i + 1} has invalid ground_truth_label: ${rawLabel}.`);
      }
      label = rawLabel as "DETECTED" | "NOT_DETECTED";
    }
    rows.push({
      image_id: imageId,
      image_url: imageUrl,
      ground_truth_label: label,
      segment_tags: segmentTags,
    });
  }

  return rows;
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
  if (value == null) return ["Baseline"];
  const parts = Array.isArray(value)
    ? value.map((v) => String(v || ""))
    : String(value)
        .split(/[;,|]/g)
        .map((v) => String(v || ""));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of parts) {
    const clean = part.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(clean);
  }
  return tags.length > 0 ? tags : ["Baseline"];
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

function splitRowsForAutoSplit(rows: BuildRow[]): Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", BuildRow[]> {
  const order: Array<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL"> = ["ITERATION", "GOLDEN", "HELD_OUT_EVAL"];
  const splits: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", BuildRow[]> = {
    ITERATION: [],
    GOLDEN: [],
    HELD_OUT_EVAL: [],
  };
  const shuffle = (items: BuildRow[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const detected = shuffle(rows.filter((r) => r.groundTruthLabel === "DETECTED"));
  const notDetected = shuffle(rows.filter((r) => r.groundTruthLabel === "NOT_DETECTED"));

  const countsByRatios = (total: number, ratios: [number, number, number] = [0.5, 0.2, 0.3]) => {
    const exact = ratios.map((r) => r * total);
    const counts = exact.map((v) => Math.floor(v)) as [number, number, number];
    let remaining = total - counts.reduce((acc, n) => acc + n, 0);
    const remainders = exact
      .map((v, idx) => ({ idx, rem: v - Math.floor(v) }))
      .sort((a, b) => b.rem - a.rem);
    let k = 0;
    while (remaining > 0) {
      counts[remainders[k % remainders.length].idx] += 1;
      remaining -= 1;
      k += 1;
    }
    return counts;
  };

  const assignWithSegmentBalancing = (bucket: BuildRow[]) => {
    if (bucket.length === 0) return;
    const counts = countsByRatios(bucket.length);
    const assigned: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", number> = {
      ITERATION: 0,
      GOLDEN: 0,
      HELD_OUT_EVAL: 0,
    };
    const segmentCounts: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", Map<string, number>> = {
      ITERATION: new Map(),
      GOLDEN: new Map(),
      HELD_OUT_EVAL: new Map(),
    };
    const prioritized = [...bucket].sort((a, b) => (b.segmentTags?.length || 0) - (a.segmentTags?.length || 0));

    for (const row of prioritized) {
      const candidates = order.filter((split) => assigned[split] < counts[order.indexOf(split)]);
      if (candidates.length === 0) break;
      let best = candidates[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const split of candidates) {
        const cap = Math.max(1, counts[order.indexOf(split)]);
        const loadPenalty = assigned[split] / cap;
        let segPenalty = 0;
        for (const tag of row.segmentTags || []) segPenalty += segmentCounts[split].get(tag) || 0;
        const score = segPenalty + loadPenalty;
        if (score < bestScore) {
          best = split;
          bestScore = score;
        }
      }
      splits[best].push(row);
      assigned[best] += 1;
      for (const tag of row.segmentTags || []) {
        segmentCounts[best].set(tag, (segmentCounts[best].get(tag) || 0) + 1);
      }
    }
  };

  assignWithSegmentBalancing(detected);
  assignWithSegmentBalancing(notDetected);
  return splits;
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
    <div className="space-y-1.5">
      <select
        className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px]"
        value=""
        onChange={(e) => {
          const next = e.target.value;
          if (!next) return;
          if (!value.includes(next)) onChange([...value, next]);
        }}
      >
        <option value="">Add attribute...</option>
        {options.filter((option) => !value.includes(option)).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-gray-200 text-[11px]">
              {tag}
              <button
                type="button"
                className="text-gray-400 hover:text-red-300"
                onClick={() => onChange(value.filter((v) => v !== tag))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
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
