"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Dataset, DatasetItem } from "@/types";
import { splitTypeBadgeClass, splitTypeLabel } from "@/lib/splitType";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";

export function DatasetManager({ detection }: { detection: Detection }) {
  const { refreshCounter, triggerRefresh, apiKey, selectedModel } = useAppStore();
  const { notify, confirm } = useAppFeedback();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingDatasetMeta, setSavingDatasetMeta] = useState(false);
  const [editingDatasetName, setEditingDatasetName] = useState("");
  const [editingDatasetSplit, setEditingDatasetSplit] = useState("ITERATION");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [describingImages, setDescribingImages] = useState(false);

  const loadDatasets = useCallback(async () => {
    const res = await fetch(`/api/datasets?detection_id=${detection.detection_id}`);
    const data = await res.json();
    setDatasets(data);
  }, [detection.detection_id]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets, refreshCounter]);

  const loadDatasetItems = useCallback(async () => {
    if (!selectedDatasetId) {
      setDatasetItems([]);
      return;
    }
    setLoadingItems(true);
    const res = await fetch(`/api/datasets?dataset_id=${selectedDatasetId}`);
    const data = await res.json();
    setDatasetItems(data.items || []);
    setLoadingItems(false);
  }, [selectedDatasetId]);

  useEffect(() => {
    loadDatasetItems();
  }, [loadDatasetItems]);

  const deleteDataset = async (datasetId: string) => {
    if (
      !(await confirm({
        title: "Delete Dataset",
        message: "Delete this dataset and all its items? This cannot be undone.",
        confirmLabel: "Delete Dataset",
        tone: "danger",
      }))
    ) {
      return;
    }
    const res = await fetch("/api/datasets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    });
    if (!res.ok) {
      const text = await res.text();
      notify({ message: `Failed to delete dataset: ${text}`, tone: "error" });
      return;
    }
    if (selectedDatasetId === datasetId) {
      setSelectedDatasetId(null);
      setDatasetItems([]);
    }
    await loadDatasets();
    triggerRefresh();
  };

  const selectedDataset = datasets.find((d) => d.dataset_id === selectedDatasetId);

  useEffect(() => {
    if (!selectedDataset) return;
    setEditingDatasetName(selectedDataset.name);
    setEditingDatasetSplit(selectedDataset.split_type);
  }, [selectedDataset]);

  useEffect(() => {
    if (!selectedDatasetId) return;
    const exists = datasets.some((d) => d.dataset_id === selectedDatasetId);
    if (!exists) {
      setSelectedDatasetId(null);
      setDatasetItems([]);
    }
  }, [datasets, selectedDatasetId]);

  const saveDatasetMeta = async () => {
    if (!selectedDataset) return;
    setSavingDatasetMeta(true);
    await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: selectedDataset.dataset_id,
        name: editingDatasetName.trim(),
        split_type: editingDatasetSplit,
      }),
    });
    await loadDatasets();
    await loadDatasetItems();
    triggerRefresh();
    setSavingDatasetMeta(false);
  };

  const updateItemField = (itemId: string, patch: Partial<DatasetItem>) => {
    setDatasetItems((prev) =>
      prev.map((i) => (i.item_id === itemId ? { ...i, ...patch } : i))
    );
  };

  const saveItem = async (item: DatasetItem) => {
    setSavingItemId(item.item_id);
    await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: item.item_id,
        image_id: item.image_id,
        image_uri: item.image_uri,
        image_description: item.image_description || "",
        ground_truth_label: item.ground_truth_label,
      }),
    });
    await loadDatasets();
    await loadDatasetItems();
    triggerRefresh();
    setSavingItemId(null);
  };

  const populateDescriptionsWithAi = async () => {
    if (!selectedDatasetId) return;
    setDescribingImages(true);
    try {
      const res = await fetch("/api/gemini/describe-dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          dataset_id: selectedDatasetId,
          overwrite: false,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to generate image descriptions");
      }
      await loadDatasetItems();
      await loadDatasets();
      triggerRefresh();
      notify({ message: `Generated ${payload.updated || 0} descriptions.`, tone: "success" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate descriptions";
      notify({ message: msg, tone: "error" });
    } finally {
      setDescribingImages(false);
    }
  };

  const countByLabel = (label: string) =>
    datasetItems.filter((i) => i.ground_truth_label === label).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1">
          <h2 className="app-page-title">Dataset Manager</h2>
          <p className="app-page-copy mt-1">
            Upload, inspect, and manage datasets for{" "}
            <span className="text-[var(--app-text)]">{detection.display_name}</span>
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="app-btn app-btn-primary app-btn-lg"
        >
          {showUpload ? "Cancel" : "Upload New Dataset"}
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <DatasetUploadForm
          detectionId={detection.detection_id}
          onUploaded={() => {
            setShowUpload(false);
            loadDatasets();
            triggerRefresh();
          }}
        />
      )}

      {/* Dataset Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {datasets.map((d) => (
          <div
            key={d.dataset_id}
            onClick={() => setSelectedDatasetId(d.dataset_id)}
            className={`cursor-pointer rounded-2xl border p-4 transition-all ${
              selectedDatasetId === d.dataset_id
                ? "border-sky-400/40 bg-sky-500/10 ring-1 ring-sky-400/20"
                : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]"
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-medium text-sm text-gray-200 truncate flex-1">{d.name}</h3>
              <span className={`ml-2 shrink-0 ${splitTypeBadgeClass(d.split_type)}`}>
                {splitTypeLabel(d.split_type)}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-gray-400 mt-3">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{d.size} images</span>
              </div>
              <span className="text-gray-600">|</span>
              <span className="font-mono text-gray-500" title="Dataset hash">#{d.dataset_hash.slice(0, 8)}</span>
            </div>

            <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-700/50">
              <span className="text-xs text-gray-500">
                {new Date(d.created_at).toLocaleDateString()}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteDataset(d.dataset_id);
                }}
                className="app-btn app-btn-danger px-2.5 py-1 text-xs"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {datasets.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            <p className="text-sm">No datasets yet for this detection.</p>
            <button
              onClick={() => setShowUpload(true)}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300"
            >
              Upload your first dataset
            </button>
          </div>
        )}
      </div>

      {/* Dataset Detail View */}
      {selectedDataset && (
        <div className="app-card-strong overflow-hidden">
          {/* Detail Header */}
          <div className="border-b border-white/10 bg-black/10 px-5 py-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-200">Dataset Details</h3>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                  <span className={splitTypeBadgeClass(selectedDataset.split_type)}>
                    {splitTypeLabel(selectedDataset.split_type)}
                  </span>
                  <span>{selectedDataset.size} images</span>
                  <span className="font-mono text-gray-500">hash: {selectedDataset.dataset_hash}</span>
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <div className="text-center">
                  <div className="text-lg font-semibold text-green-400">{countByLabel("DETECTED")}</div>
                  <div className="text-gray-500">DETECTED</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-400">{countByLabel("NOT_DETECTED")}</div>
                  <div className="text-gray-500">NOT_DET</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-purple-400">
                    {datasetItems.length > 0
                      ? ((countByLabel("DETECTED") / datasetItems.length) * 100).toFixed(0) + "%"
                      : "—"}
                  </div>
                  <div className="text-gray-500">Prevalence</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
                <input
                  className="app-input px-2.5 py-1.5 text-sm"
                  value={editingDatasetName}
                  onChange={(e) => setEditingDatasetName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Split Type</label>
                <select
                  className="app-select px-2.5 py-1.5 text-sm"
                  value={editingDatasetSplit}
                  onChange={(e) => setEditingDatasetSplit(e.target.value)}
                >
                  <option value="ITERATION">TRAIN</option>
                  <option value="GOLDEN">TEST</option>
                  <option value="HELD_OUT_EVAL">EVALUATE</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              </div>
            </div>
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={saveDatasetMeta}
                  disabled={savingDatasetMeta}
                  className="app-btn app-btn-success app-btn-md disabled:opacity-50"
                >
                  {savingDatasetMeta ? "Saving..." : "Save Dataset Meta"}
                </button>
                <button
                  onClick={populateDescriptionsWithAi}
                  disabled={describingImages || datasetItems.length === 0}
                  className="app-btn app-btn-subtle app-btn-md disabled:opacity-50"
                >
                  {describingImages ? "Generating descriptions..." : "Populate Descriptions with AI"}
                </button>
              </div>
            </div>

            {selectedDataset.split_type === "HELD_OUT_EVAL" && (
              <div className="mt-3 rounded-2xl border border-purple-400/20 bg-purple-500/10 px-3 py-2 text-xs text-purple-300">
                This is a protected held-out dataset. Items cannot be edited.
              </div>
            )}
            {selectedDataset.split_type === "GOLDEN" && (
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Test set — used for regression gating. Changes will affect regression results.
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            {loadingItems ? (
              <div className="text-center py-8 text-gray-500 text-sm">Loading items...</div>
            ) : (
              <table className="app-table app-table-fixed text-sm">
                <colgroup>
                  <col style={{ width: "3rem" }} />
                  <col style={{ width: "7rem" }} />
                  <col style={{ width: "12rem" }} />
                  <col style={{ width: "16rem" }} />
                  <col />
                  <col style={{ width: "10rem" }} />
                  <col style={{ width: "6rem" }} />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="app-table-col-label">#</th>
                    <th className="app-table-col-label">Preview</th>
                    <th className="app-table-col-label">Image ID</th>
                    <th className="app-table-col-label">Image URI</th>
                    <th className="app-table-col-label">Image Description</th>
                    <th className="app-table-col-center">Ground Truth</th>
                    <th className="app-table-col-right">Save</th>
                  </tr>
                </thead>
                <tbody>
                  {datasetItems.map((item, i) => (
                    <tr key={item.item_id}>
                      <td className="text-xs text-gray-600">{i + 1}</td>
                      <td>
                        <img
                          src={item.image_uri}
                          alt={item.image_id}
                          className="w-16 h-12 object-cover rounded border border-gray-700"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-300"
                          value={item.image_id}
                          onChange={(e) => updateItemField(item.item_id, { image_id: e.target.value })}
                        />
                      </td>
                      <td className="py-2 px-4 text-xs text-gray-400 max-w-[300px] truncate font-mono">
                        <input
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-300"
                          value={item.image_uri}
                          onChange={(e) => updateItemField(item.item_id, { image_uri: e.target.value })}
                        />
                      </td>
                      <td>
                        <textarea
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 min-h-12"
                          value={item.image_description || ""}
                          onChange={(e) => updateItemField(item.item_id, { image_description: e.target.value })}
                        />
                      </td>
                      <td className="app-table-col-center">
                        <select
                          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                          value={item.ground_truth_label || ""}
                          onChange={(e) =>
                            updateItemField(item.item_id, {
                              ground_truth_label: (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null,
                            })
                          }
                        >
                          <option value="">UNSET</option>
                          <option value="DETECTED">DETECTED</option>
                          <option value="NOT_DETECTED">NOT_DETECTED</option>
                        </select>
                      </td>
                      <td className="app-table-col-right">
                        <button
                          onClick={() => saveItem(item)}
                          disabled={savingItemId === item.item_id}
                          className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
                        >
                          {savingItemId === item.item_id ? "Saving..." : "Save"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Manifest Format Info */}
          <div className="px-5 py-3 border-t border-gray-700 bg-gray-900/30">
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-400">Dataset manifest format</summary>
              <pre className="mt-2 bg-gray-900 rounded p-3 font-mono text-gray-400 overflow-x-auto">
{`[
  {
    "image_id": "unique_id",
    "image_uri": "https://... or ./local/path.jpg",
    "ground_truth_label": "DETECTED" | "NOT_DETECTED"
  }
]`}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

function DatasetUploadForm({
  detectionId,
  onUploaded,
}: {
  detectionId: string;
  onUploaded: () => void;
}) {
  const [name, setName] = useState("");
  const [splitType, setSplitType] = useState<string>("ITERATION");
  const [mode, setMode] = useState<"json" | "csv" | "files">("files");
  const [jsonInput, setJsonInput] = useState("");
  const [csvInput, setCsvInput] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [fileRows, setFileRows] = useState<
    Array<{ id: string; file: File; preview: string; imageId: string; label: "DETECTED" | "NOT_DETECTED" }>
  >([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    return () => {
      fileRows.forEach((r) => URL.revokeObjectURL(r.preview));
    };
  }, [fileRows]);

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;

    const nextRows = picked.map((file, i) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        id: `${Date.now()}_${i}_${base}`,
        file,
        preview: URL.createObjectURL(file),
        imageId: sanitizeImageId(base || `image_${i + 1}`),
        label: "NOT_DETECTED" as const,
      };
    });
    setFileRows((prev) => [...prev, ...nextRows]);
    event.currentTarget.value = "";
  };

  const removeFileRow = (id: string) => {
    setFileRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleUpload = async () => {
    setError("");
    if (!name.trim()) {
      setError("Dataset name is required");
      return;
    }

    try {
      setUploading(true);
      if (mode === "files") {
        if (fileRows.length === 0) {
          setError("Choose at least one image file");
          return;
        }

        const imageIds = new Set<string>();
        for (const row of fileRows) {
          if (!row.imageId.trim()) {
            setError("Each image needs an image_id");
            return;
          }
          if (imageIds.has(row.imageId)) {
            setError(`Duplicate image_id: ${row.imageId}`);
            return;
          }
          imageIds.add(row.imageId);
        }

        const formData = new FormData();
        formData.append("name", name.trim());
        formData.append("detection_id", detectionId);
        formData.append("split_type", splitType);
        formData.append(
          "items",
          JSON.stringify(
            fileRows.map((r) => ({
              image_id: r.imageId.trim(),
              ground_truth_label: r.label,
            }))
          )
        );
        fileRows.forEach((r) => formData.append("files", r.file));

        const res = await fetch("/api/datasets", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || "Failed to upload image files.");
        }
      } else if (mode === "csv") {
        const parsed = parseCsvManifest(csvInput);
        if (parsed.length === 0) {
          setError("CSV must contain at least one data row.");
          return;
        }
        const imageIds = new Set<string>();
        for (let i = 0; i < parsed.length; i++) {
          const row = parsed[i];
          if (imageIds.has(row.image_id)) {
            setError(`Duplicate image_id in CSV: ${row.image_id}`);
            return;
          }
          imageIds.add(row.image_id);
        }
        const res = await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            detection_id: detectionId,
            split_type: splitType,
            items: parsed.map((row) => ({
              image_id: row.image_id,
              image_uri: row.image_url,
              ground_truth_label: row.ground_truth_label,
            })),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || "Failed to upload CSV dataset.");
        }
      } else {
        const items = JSON.parse(jsonInput);
        if (!Array.isArray(items)) {
          setError("Must be a JSON array");
          return;
        }
        if (items.length === 0) {
          setError("Dataset must contain at least one item");
          return;
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item.image_id || !item.image_uri || !["DETECTED", "NOT_DETECTED"].includes(item.ground_truth_label)) {
            setError(`Item ${i}: Each item must have image_id, image_uri, and ground_truth_label (DETECTED|NOT_DETECTED)`);
            return;
          }
        }
        const res = await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), detection_id: detectionId, split_type: splitType, items }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || "Failed to upload JSON dataset.");
        }
      }
      onUploaded();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="app-section space-y-4">
      <h3 className="text-sm font-medium text-gray-300">Upload New Dataset</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
          <input
            className="app-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smoke Test Set v2"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Split Type</label>
          <select
            className="app-select"
            value={splitType}
            onChange={(e) => setSplitType(e.target.value)}
          >
            <option value="ITERATION">TRAIN — for prompt development, corrections via HIL</option>
            <option value="GOLDEN">TEST — fixed regression gate set</option>
            <option value="HELD_OUT_EVAL">EVALUATE — protected final evaluation</option>
            <option value="CUSTOM">CUSTOM — general purpose</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("files")}
          className={`app-toggle ${mode === "files" ? "app-toggle-active" : ""}`}
        >
          Upload Image Files
        </button>
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={`app-toggle ${mode === "csv" ? "app-toggle-active" : ""}`}
        >
          CSV Manifest
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`app-toggle ${mode === "json" ? "app-toggle-active" : ""}`}
        >
          JSON Manifest
        </button>
      </div>

      {mode === "json" ? (
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Dataset Manifest (JSON array)
          </label>
          <textarea
            className="app-textarea h-40 text-xs font-mono"
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[
  { "image_id": "img_001", "image_uri": "https://example.com/img1.jpg", "ground_truth_label": "DETECTED" },
  { "image_id": "img_002", "image_uri": "https://example.com/img2.jpg", "ground_truth_label": "NOT_DETECTED" }
]`}
          />
        </div>
      ) : mode === "csv" ? (
        <div className="space-y-2">
          <label className="text-xs text-gray-400 block mb-1">
            Dataset Manifest (CSV: image_id, image_url, ground_truth_label)
          </label>
          <input
            id="dataset-manager-csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setCsvInput(text);
              setCsvFileName(file.name);
              e.currentTarget.value = "";
            }}
            className="hidden"
          />
          <label
            htmlFor="dataset-manager-csv-input"
            className="app-btn app-btn-secondary cursor-pointer"
          >
            Choose Files
          </label>
          <span className="ml-3 text-xs text-gray-500">
            {csvFileName ? "1 Files Selected" : "Choose Files"}
          </span>
          <textarea
            className="app-textarea h-40 text-xs font-mono"
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
            placeholder={`image_id,image_url,ground_truth_label
img_001,https://example.com/img1.jpg,DETECTED
img_002,gs://my-bucket/folder/img2.jpg,NOT_DETECTED`}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Select Images</label>
            <input
              id="dataset-manager-files-input"
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
            <label
              htmlFor="dataset-manager-files-input"
            className="app-btn app-btn-secondary cursor-pointer"
          >
            Choose Files
          </label>
            <span className="ml-3 text-xs text-gray-500">
              {fileRows.length > 0 ? `${fileRows.length} Files Selected` : "Choose Files"}
            </span>
            <p className="text-[11px] text-gray-500 mt-1">
              Assign ground-truth labels per image before uploading.
            </p>
          </div>

          {fileRows.length > 0 && (
            <div className="app-table-wrap max-h-72 overflow-y-auto">
              <table className="app-table app-table-fixed text-xs">
                <colgroup>
                  <col style={{ width: "8rem" }} />
                  <col style={{ width: "14rem" }} />
                  <col />
                  <col style={{ width: "9rem" }} />
                  <col style={{ width: "6rem" }} />
                </colgroup>
                <thead className="sticky top-0">
                  <tr>
                    <th className="app-table-col-label">Preview</th>
                    <th className="app-table-col-label">File</th>
                    <th className="app-table-col-label">image_id</th>
                    <th className="app-table-col-center">Label</th>
                    <th className="app-table-col-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fileRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <img
                          src={row.preview}
                          alt={row.file.name}
                          className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-90"
                          onClick={() => setExpandedIndex(fileRows.findIndex((f) => f.id === row.id))}
                        />
                      </td>
                      <td className="text-gray-300">{row.file.name}</td>
                      <td>
                        <input
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                          value={row.imageId}
                          onChange={(e) =>
                            setFileRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, imageId: sanitizeImageId(e.target.value) } : r))
                            )
                          }
                        />
                      </td>
                      <td className="app-table-col-center">
                        <select
                          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                          value={row.label}
                          onChange={(e) =>
                            setFileRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, label: e.target.value as "DETECTED" | "NOT_DETECTED" }
                                  : r
                              )
                            )
                          }
                        >
                          <option value="DETECTED">DETECTED</option>
                          <option value="NOT_DETECTED">NOT_DETECTED</option>
                        </select>
                      </td>
                      <td className="app-table-col-right">
                        <button onClick={() => removeFileRow(row.id)} className="text-red-400 hover:text-red-300">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800/50 rounded px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="app-btn app-btn-primary disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload Dataset"}
      </button>

      {expandedIndex != null && fileRows[expandedIndex] && (
        <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto flex items-start justify-center p-6">
          <button
            className="absolute inset-0"
            onClick={() => setExpandedIndex(null)}
            aria-label="Close preview"
          />
          <div className="relative z-10 w-full max-w-5xl max-h-[calc(100vh-3rem)] overflow-y-auto my-auto">
            <div className="flex items-center justify-between mb-2 text-xs text-gray-300">
              <span>{fileRows[expandedIndex].file.name}</span>
              <span>{expandedIndex + 1} / {fileRows.length}</span>
            </div>
            <img
              src={fileRows[expandedIndex].preview}
              alt={fileRows[expandedIndex].file.name}
              className="w-full max-h-[75vh] object-contain rounded border border-gray-700 bg-gray-900"
            />
            <div className="flex justify-between mt-3">
              <button
                onClick={() => setExpandedIndex((i) => (i == null ? null : Math.max(0, i - 1)))}
                disabled={expandedIndex <= 0}
                className="app-btn app-btn-secondary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setExpandedIndex((i) =>
                    i == null ? null : Math.min(fileRows.length - 1, i + 1)
                  )
                }
                disabled={expandedIndex >= fileRows.length - 1}
                className="app-btn app-btn-secondary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function sanitizeImageId(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function parseCsvManifest(input: string): Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED";
}> {
  const normalized = String(input || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("CSV is empty.");
  }

  const lines = normalized.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV requires a header and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const expected = ["image_id", "image_url", "ground_truth_label"];
  const matchesHeader = headers.length === expected.length && headers.every((h, i) => h === expected[i]);
  if (!matchesHeader) {
    throw new Error("CSV header must be exactly: image_id,image_url,ground_truth_label");
  }

  const rows: Array<{
    image_id: string;
    image_url: string;
    ground_truth_label: "DETECTED" | "NOT_DETECTED";
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length === 1 && !cols[0].trim()) continue;
    if (cols.length !== 3) {
      throw new Error(`CSV row ${i + 1} must have exactly 3 columns.`);
    }
    const imageId = sanitizeImageId(cols[0]);
    const imageUrl = cols[1].trim();
    const label = cols[2].trim().toUpperCase();
    if (!imageId) {
      throw new Error(`CSV row ${i + 1} has blank image_id.`);
    }
    if (!imageUrl) {
      throw new Error(`CSV row ${i + 1} has blank image_url.`);
    }
    if (label !== "DETECTED" && label !== "NOT_DETECTED") {
      throw new Error(`CSV row ${i + 1} has invalid ground_truth_label: ${cols[2]}.`);
    }
    rows.push({
      image_id: imageId,
      image_url: imageUrl,
      ground_truth_label: label as "DETECTED" | "NOT_DETECTED",
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
