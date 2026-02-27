"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import type { Detection, Dataset, DatasetItem } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function DatasetManager({ detection }: { detection: Detection }) {
  const { refreshCounter, triggerRefresh } = useAppStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingDatasetMeta, setSavingDatasetMeta] = useState(false);
  const [editingDatasetName, setEditingDatasetName] = useState("");
  const [editingDatasetSplit, setEditingDatasetSplit] = useState("ITERATION");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    const res = await fetch(`/api/datasets?detection_id=${detection.detection_id}`);
    const data = await res.json();
    setDatasets(data);
  }, [detection.detection_id, refreshCounter]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

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
    if (!confirm("Delete this dataset and all its items? This cannot be undone.")) return;
    const res = await fetch("/api/datasets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId }),
    });
    if (!res.ok) {
      const text = await res.text();
      alert(`Failed to delete dataset: ${text}`);
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
        ground_truth_label: item.ground_truth_label,
      }),
    });
    await loadDatasets();
    await loadDatasetItems();
    triggerRefresh();
    setSavingItemId(null);
  };

  const countByLabel = (label: string) =>
    datasetItems.filter((i) => i.ground_truth_label === label).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Dataset Manager</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload, inspect, and manage datasets for{" "}
            <span className="text-gray-300">{detection.display_name}</span>
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
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
            className={`border rounded-lg p-4 cursor-pointer transition-all ${
              selectedDatasetId === d.dataset_id
                ? "border-blue-500 bg-blue-900/10 ring-1 ring-blue-500/30"
                : "border-gray-700 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60"
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-medium text-sm text-gray-200 truncate flex-1">{d.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded ml-2 shrink-0 ${splitTypeStyle(d.split_type)}`}>
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
                className="text-xs text-gray-600 hover:text-red-400 transition-colors"
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
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          {/* Detail Header */}
          <div className="px-5 py-4 border-b border-gray-700 bg-gray-800/30">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-200">Dataset Details</h3>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                  <span className={`px-2 py-0.5 rounded ${splitTypeStyle(selectedDataset.split_type)}`}>
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
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-sm"
                  value={editingDatasetName}
                  onChange={(e) => setEditingDatasetName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Split Type</label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-sm"
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
              <button
                onClick={saveDatasetMeta}
                disabled={savingDatasetMeta}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
              >
                {savingDatasetMeta ? "Saving..." : "Save Dataset Meta"}
              </button>
            </div>

            {selectedDataset.split_type === "HELD_OUT_EVAL" && (
              <div className="mt-3 bg-purple-900/15 border border-purple-800/40 rounded px-3 py-2 text-xs text-purple-400">
                This is a protected held-out dataset. Items cannot be edited.
              </div>
            )}
            {selectedDataset.split_type === "GOLDEN" && (
              <div className="mt-3 bg-yellow-900/15 border border-yellow-800/40 rounded px-3 py-2 text-xs text-yellow-400">
                Golden set — used for regression gating. Changes will affect regression results.
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            {loadingItems ? (
              <div className="text-center py-8 text-gray-500 text-sm">Loading items...</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-800 z-10">
                  <tr className="text-xs text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2.5 px-4 w-12">#</th>
                    <th className="text-left py-2.5 px-4">Preview</th>
                    <th className="text-left py-2.5 px-4">Image ID</th>
                    <th className="text-left py-2.5 px-4">Image URI</th>
                    <th className="text-center py-2.5 px-4">Ground Truth</th>
                    <th className="text-right py-2.5 px-4">Save</th>
                  </tr>
                </thead>
                <tbody>
                  {datasetItems.map((item, i) => (
                    <tr
                      key={item.item_id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="py-2 px-4 text-xs text-gray-600">{i + 1}</td>
                      <td className="py-2 px-4">
                        <img
                          src={item.image_uri}
                          alt={item.image_id}
                          className="w-16 h-12 object-cover rounded border border-gray-700"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </td>
                      <td className="py-2 px-4">
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
                      <td className="text-center py-2 px-4">
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
                      <td className="text-right py-2 px-4">
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
  const [mode, setMode] = useState<"json" | "files">("files");
  const [jsonInput, setJsonInput] = useState("");
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

        await fetch("/api/datasets", { method: "POST", body: formData });
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
        await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), detection_id: detectionId, split_type: splitType, items }),
        });
      }
      onUploaded();
    } catch {
      setError("Invalid JSON format. Ensure it is a valid JSON array.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-medium text-gray-300">Upload New Dataset</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
          <input
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smoke Test Set v2"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Split Type</label>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
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
          className={`px-3 py-1.5 text-xs rounded ${mode === "files" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
        >
          Upload Image Files
        </button>
        <button
          type="button"
          onClick={() => setMode("json")}
          className={`px-3 py-1.5 text-xs rounded ${mode === "json" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
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
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-xs font-mono h-40 focus:outline-none focus:border-blue-500"
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[
  { "image_id": "img_001", "image_uri": "https://example.com/img1.jpg", "ground_truth_label": "DETECTED" },
  { "image_id": "img_002", "image_uri": "https://example.com/img2.jpg", "ground_truth_label": "NOT_DETECTED" }
]`}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Select Images</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Assign ground-truth labels per image before uploading.
            </p>
          </div>

          {fileRows.length > 0 && (
            <div className="max-h-72 overflow-y-auto border border-gray-700 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-800">
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 px-2">Preview</th>
                    <th className="text-left py-2 px-2">File</th>
                    <th className="text-left py-2 px-2">image_id</th>
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-right py-2 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fileRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-800/60">
                      <td className="py-2 px-2">
                        <img
                          src={row.preview}
                          alt={row.file.name}
                          className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer hover:opacity-90"
                          onClick={() => setExpandedIndex(fileRows.findIndex((f) => f.id === row.id))}
                        />
                      </td>
                      <td className="py-2 px-2 text-gray-300">{row.file.name}</td>
                      <td className="py-2 px-2">
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
                      <td className="py-2 px-2">
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
                      <td className="py-2 px-2 text-right">
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
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
      >
        {uploading ? "Uploading..." : "Upload Dataset"}
      </button>

      {expandedIndex != null && fileRows[expandedIndex] && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
          <button
            className="absolute inset-0"
            onClick={() => setExpandedIndex(null)}
            aria-label="Close preview"
          />
          <div className="relative z-10 w-full max-w-5xl">
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
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded"
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
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded"
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

function splitTypeStyle(t: string) {
  switch (t) {
    case "GOLDEN":
      return "bg-yellow-900/30 text-yellow-400 border border-yellow-800/50";
    case "ITERATION":
      return "bg-blue-900/30 text-blue-400 border border-blue-800/50";
    case "HELD_OUT_EVAL":
      return "bg-purple-900/30 text-purple-400 border border-purple-800/50";
    default:
      return "bg-gray-800 text-gray-400 border border-gray-700";
  }
}
