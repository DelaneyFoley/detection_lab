"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function SavedDatasets({ detections }: { detections: Detection[] }) {
  const { triggerRefresh, refreshCounter, apiKey, selectedModel } = useAppStore();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [editingName, setEditingName] = useState("");
  const [editingSplit, setEditingSplit] = useState("ITERATION");
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [itemSortBy, setItemSortBy] = useState<"image_id" | "ground_truth_label">("image_id");
  const [itemSortDir, setItemSortDir] = useState<"asc" | "desc">("asc");
  const [describingImages, setDescribingImages] = useState(false);

  const loadDatasets = async () => {
    const res = await fetch("/api/datasets");
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    setDatasets(rows);
    if (!selectedDatasetId && rows.length > 0) {
      setSelectedDatasetId(rows[0].dataset_id);
    }
    if (selectedDatasetId && !rows.some((d: Dataset) => d.dataset_id === selectedDatasetId)) {
      setSelectedDatasetId(rows[0]?.dataset_id || null);
    }
  };

  const loadDatasetItems = async (datasetId: string) => {
    const res = await fetch(`/api/datasets?dataset_id=${datasetId}`);
    const data = await res.json();
    setDatasetItems(Array.isArray(data.items) ? data.items : []);
  };

  useEffect(() => {
    loadDatasets();
  }, [refreshCounter]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setDatasetItems([]);
      return;
    }
    loadDatasetItems(selectedDatasetId);
  }, [selectedDatasetId]);

  const sortedDatasetItems = useMemo(() => {
    const copy = [...datasetItems];
    copy.sort((a, b) => {
      const left = String(a[itemSortBy] || "").toLowerCase();
      const right = String(b[itemSortBy] || "").toLowerCase();
      if (left < right) return itemSortDir === "asc" ? -1 : 1;
      if (left > right) return itemSortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [datasetItems, itemSortBy, itemSortDir]);

  useEffect(() => {
    if (selectedPreviewIndex == null) return;
    if (sortedDatasetItems.length === 0) {
      setSelectedPreviewIndex(null);
      return;
    }
    if (selectedPreviewIndex >= sortedDatasetItems.length) {
      setSelectedPreviewIndex(sortedDatasetItems.length - 1);
    }
  }, [sortedDatasetItems, selectedPreviewIndex]);

  useEffect(() => {
    if (selectedPreviewIndex == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedPreviewIndex((prev) => {
          if (prev == null) return prev;
          return Math.max(0, prev - 1);
        });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedPreviewIndex((prev) => {
          if (prev == null) return prev;
          return Math.min(sortedDatasetItems.length - 1, prev + 1);
        });
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSelectedPreviewIndex(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPreviewIndex, sortedDatasetItems.length]);

  const detectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of detections) {
      map.set(d.detection_id, d.display_name);
    }
    return map;
  }, [detections]);

  const selectedDataset = datasets.find((d) => d.dataset_id === selectedDatasetId) || null;

  useEffect(() => {
    if (!selectedDataset) return;
    setEditingName(selectedDataset.name);
    setEditingSplit(selectedDataset.split_type);
    setIsEditingDetails(false);
  }, [selectedDataset?.dataset_id]);

  const saveDatasetMeta = async () => {
    if (!selectedDataset) return;
    const imageIdValidation = validateDatasetItemImageIds(datasetItems);
    if (!imageIdValidation.ok) {
      alert(imageIdValidation.error);
      return;
    }
    setIsSavingDetails(true);
    try {
      const metaRes = await fetch("/api/datasets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: selectedDataset.dataset_id,
          name: editingName.trim(),
          split_type: editingSplit,
        }),
      });
      if (!metaRes.ok) {
        const text = await metaRes.text();
        throw new Error(text || "Failed to save dataset metadata");
      }

      // Save item edits sequentially to avoid sqlite write contention.
      for (const item of datasetItems) {
        const itemRes = await fetch("/api/datasets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item_id: item.item_id,
            image_id: item.image_id.trim(),
            image_uri: item.image_uri,
            image_description: item.image_description || "",
            ground_truth_label: item.ground_truth_label,
          }),
        });
        if (!itemRes.ok) {
          const text = await itemRes.text();
          throw new Error(text || `Failed saving item ${item.image_id}`);
        }
      }

      await loadDatasets();
      if (selectedDatasetId) await loadDatasetItems(selectedDatasetId);
      triggerRefresh();
      setIsEditingDetails(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save changes";
      alert(message);
    } finally {
      setIsSavingDetails(false);
    }
  };

  const updateItemField = (itemId: string, patch: Partial<DatasetItem>) => {
    setDatasetItems((prev) => prev.map((item) => (item.item_id === itemId ? { ...item, ...patch } : item)));
  };

  const deleteDataset = async () => {
    if (!selectedDataset) return;
    if (!confirm(`Delete dataset "${selectedDataset.name}"? This cannot be undone.`)) return;
    await fetch("/api/datasets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: selectedDataset.dataset_id }),
    });
    setSelectedDatasetId(null);
    setDatasetItems([]);
    await loadDatasets();
    triggerRefresh();
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
      if (!res.ok) throw new Error(payload?.error || "Failed to generate descriptions");
      await loadDatasets();
      await loadDatasetItems(selectedDatasetId);
      triggerRefresh();
      alert(`Generated ${payload.updated || 0} descriptions.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate descriptions";
      alert(msg);
    } finally {
      setDescribingImages(false);
    }
  };

  const toggleItemSort = (field: "image_id" | "ground_truth_label") => {
    if (itemSortBy === field) {
      setItemSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setItemSortBy(field);
    setItemSortDir("asc");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Saved Datasets</h2>
          <p className="text-sm text-gray-500">All datasets across detections.</p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded"
        >
          {showUpload ? "Cancel Upload" : "Upload Dataset"}
        </button>
      </div>

      {showUpload && (
        <GlobalDatasetUploadForm
          detections={detections}
          onUploaded={async () => {
            setShowUpload(false);
            await loadDatasets();
            triggerRefresh();
          }}
        />
      )}

      <div className="overflow-x-auto border border-gray-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400">
            <tr>
              <th className="text-left px-3 py-2">Dataset</th>
              <th className="text-left px-3 py-2">Detection</th>
              <th className="text-left px-3 py-2">Split</th>
              <th className="text-right px-3 py-2">Size</th>
              <th className="text-left px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <tr
                key={d.dataset_id}
                className={`border-t border-gray-800 cursor-pointer ${
                  selectedDatasetId === d.dataset_id ? "bg-blue-900/20" : "hover:bg-gray-900/40"
                }`}
                onClick={() => setSelectedDatasetId(d.dataset_id)}
              >
                <td className="px-3 py-2 text-gray-200">{d.name}</td>
                <td className="px-3 py-2 text-gray-400">{detectionNameById.get(d.detection_id) || d.detection_id}</td>
                <td className="px-3 py-2 text-gray-400">{splitTypeLabel(d.split_type)}</td>
                <td className="px-3 py-2 text-right text-gray-300">{d.size}</td>
                <td className="px-3 py-2 text-gray-500">{new Date(d.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No datasets saved yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedDataset && (
        <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-gray-200">Dataset Details</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (isEditingDetails) {
                    saveDatasetMeta();
                  } else {
                    setIsEditingDetails(true);
                  }
                }}
                disabled={isSavingDetails}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
              >
                {isSavingDetails ? "Saving..." : isEditingDetails ? "Save" : "Edit"}
              </button>
              <button
                onClick={populateDescriptionsWithAi}
                disabled={describingImages || datasetItems.length === 0}
                className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded"
              >
                {describingImages ? "Generating..." : "Populate Descriptions with AI"}
              </button>
              <button
                onClick={deleteDataset}
                className="text-xs px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded"
              >
                Delete Dataset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
              {isEditingDetails ? (
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
              ) : (
                <div className="w-full px-0 py-2 text-sm text-gray-300">{editingName}</div>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Split Type</label>
              {isEditingDetails ? (
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={editingSplit}
                  onChange={(e) => setEditingSplit(e.target.value)}
                >
                  <option value="GOLDEN">TEST</option>
                  <option value="ITERATION">TRAIN</option>
                  <option value="HELD_OUT_EVAL">EVALUATE</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              ) : (
                <div className="w-full px-0 py-2 text-sm text-gray-300">{splitTypeLabel(editingSplit)}</div>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-xs text-gray-400 font-medium mb-2">Preview ({datasetItems.length} images)</h4>
            <div className="max-h-[360px] overflow-auto border border-gray-800 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900/90">
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-2 py-2 w-44">Preview</th>
                    <th className="text-left px-2 py-2">
                      <button type="button" onClick={() => toggleItemSort("image_id")} className="hover:text-gray-300">
                        Image ID {itemSortBy === "image_id" ? (itemSortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="text-left px-2 py-2">Image Description</th>
                    <th className="text-left px-2 py-2">
                      <button
                        type="button"
                        onClick={() => toggleItemSort("ground_truth_label")}
                        className="hover:text-gray-300"
                      >
                        Ground Truth Label {itemSortBy === "ground_truth_label" ? (itemSortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDatasetItems.map((item, index) => (
                    <tr key={item.item_id} className="border-b border-gray-900/70">
                      <td className="px-2 py-2 w-44">
                        <img
                          src={item.image_uri}
                          alt={item.image_id}
                          className="block h-24 w-36 min-w-36 max-w-36 object-cover rounded border border-gray-700 cursor-pointer"
                          onClick={() => setSelectedPreviewIndex(index)}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {isEditingDetails ? (
                          <input
                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-300"
                            value={item.image_id}
                            onChange={(e) => updateItemField(item.item_id, { image_id: sanitizeImageId(e.target.value) })}
                          />
                        ) : (
                          <div className="w-full py-1 text-xs font-mono text-gray-300">{item.image_id}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {isEditingDetails ? (
                          <input
                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
                            value={item.image_description || ""}
                            onChange={(e) => updateItemField(item.item_id, { image_description: e.target.value })}
                          />
                        ) : (
                          <div className="w-full py-1 text-xs text-gray-300">{item.image_description || ""}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {isEditingDetails ? (
                          <select
                            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
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
                        ) : (
                          <div className="py-1 text-xs text-gray-300">{item.ground_truth_label || "UNSET"}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {datasetItems.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-5 text-center text-gray-500">
                        No images in this dataset.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedPreviewIndex != null && sortedDatasetItems[selectedPreviewIndex] && (
        <div
          className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start justify-center p-6"
          onClick={() => setSelectedPreviewIndex(null)}
        >
          <div
            className="w-full max-w-5xl max-h-[calc(100vh-3rem)] bg-gray-900 border border-gray-700 rounded-lg p-4 grid gap-4 overflow-hidden my-auto"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center">
              <img
                src={sortedDatasetItems[selectedPreviewIndex].image_uri}
                alt={sortedDatasetItems[selectedPreviewIndex].image_id}
                className="max-h-[72vh] max-w-full rounded-lg border border-gray-700"
              />
            </div>
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="text-xs text-gray-500">
                {selectedPreviewIndex + 1} / {sortedDatasetItems.length} (Use Up/Down arrows to navigate)
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Image ID</label>
                {isEditingDetails ? (
                  <input
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono text-gray-300"
                    value={sortedDatasetItems[selectedPreviewIndex].image_id}
                    onChange={(e) =>
                      updateItemField(sortedDatasetItems[selectedPreviewIndex].item_id, {
                        image_id: sanitizeImageId(e.target.value),
                      })
                    }
                  />
                ) : (
                  <div className="w-full px-0 py-1.5 text-xs font-mono text-gray-300">
                    {sortedDatasetItems[selectedPreviewIndex].image_id}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Image Description</label>
                {isEditingDetails ? (
                  <textarea
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 h-28"
                    value={sortedDatasetItems[selectedPreviewIndex].image_description || ""}
                    onChange={(e) =>
                      updateItemField(sortedDatasetItems[selectedPreviewIndex].item_id, {
                        image_description: e.target.value,
                      })
                    }
                  />
                ) : (
                  <div className="w-full min-h-28 px-0 py-1.5 text-xs text-gray-300 whitespace-pre-wrap">
                    {sortedDatasetItems[selectedPreviewIndex].image_description || "No description."}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ground Truth</label>
                {isEditingDetails ? (
                  <select
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
                    value={sortedDatasetItems[selectedPreviewIndex].ground_truth_label || ""}
                    onChange={(e) =>
                      updateItemField(sortedDatasetItems[selectedPreviewIndex].item_id, {
                        ground_truth_label: (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null,
                      })
                    }
                  >
                    <option value="">UNSET</option>
                    <option value="DETECTED">DETECTED</option>
                    <option value="NOT_DETECTED">NOT_DETECTED</option>
                  </select>
                ) : (
                  <div className="w-full px-0 py-1.5 text-xs text-gray-300">
                    {sortedDatasetItems[selectedPreviewIndex].ground_truth_label || "UNSET"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalDatasetUploadForm({
  detections,
  onUploaded,
}: {
  detections: Detection[];
  onUploaded: () => void;
}) {
  const [detectionId, setDetectionId] = useState<string>(detections[0]?.detection_id || "");
  const [name, setName] = useState("");
  const [splitType, setSplitType] = useState<string>("ITERATION");
  const [mode, setMode] = useState<"json" | "files">("files");
  const [jsonInput, setJsonInput] = useState("");
  const [fileRows, setFileRows] = useState<
    Array<{ id: string; file: File; preview: string; imageId: string; label: "DETECTED" | "NOT_DETECTED" | "" }>
  >([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!detectionId && detections[0]?.detection_id) {
      setDetectionId(detections[0].detection_id);
    }
  }, [detections, detectionId]);

  useEffect(() => {
    return () => {
      fileRows.forEach((r) => URL.revokeObjectURL(r.preview));
    };
  }, [fileRows]);

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;
    const nextRows: Array<{
      id: string;
      file: File;
      preview: string;
      imageId: string;
      label: "DETECTED" | "NOT_DETECTED" | "";
    }> = picked.map((file, i) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        id: `${Date.now()}_${i}_${base}`,
        file,
        preview: URL.createObjectURL(file),
        imageId: sanitizeImageId(base || `image_${i + 1}`),
        label: "",
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
    if (!detectionId) {
      setError("Select a detection");
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
          const imageId = row.imageId.trim();
          if (!imageId) {
            setError("Each image needs an image_id");
            return;
          }
          if (imageIds.has(imageId)) {
            setError(`Duplicate image_id: ${imageId}`);
            return;
          }
          imageIds.add(imageId);
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
              image_description: "",
              ground_truth_label: r.label || null,
            }))
          )
        );
        fileRows.forEach((r) => formData.append("files", r.file));
        await fetch("/api/datasets", { method: "POST", body: formData });
      } else {
        const items = JSON.parse(jsonInput);
        if (!Array.isArray(items) || items.length === 0) {
          setError("Dataset manifest must be a non-empty JSON array");
          return;
        }
        for (const item of items) {
          const imageId = String(item.image_id ?? "").trim();
          if (!imageId || !item.image_uri) {
            setError("Each item must include image_id and image_uri");
            return;
          }
          item.image_id = imageId;
        }
        const jsonImageIds = new Set<string>();
        for (const item of items) {
          if (jsonImageIds.has(item.image_id)) {
            setError(`Duplicate image_id: ${item.image_id}`);
            return;
          }
          jsonImageIds.add(item.image_id);
          if (
            item.ground_truth_label != null &&
            !["DETECTED", "NOT_DETECTED"].includes(item.ground_truth_label)
          ) {
            setError("ground_truth_label must be DETECTED, NOT_DETECTED, or null");
            return;
          }
        }
        await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            detection_id: detectionId,
            split_type: splitType,
            items,
          }),
        });
      }
      onUploaded();
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 space-y-4">
      <h3 className="text-sm font-medium text-gray-200">Upload New Dataset</h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
          <input
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Detection</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
            value={detectionId}
            onChange={(e) => setDetectionId(e.target.value)}
          >
            {detections.map((d) => (
              <option key={d.detection_id} value={d.detection_id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Split</label>
          <select
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
            value={splitType}
            onChange={(e) => setSplitType(e.target.value)}
          >
            <option value="ITERATION">TRAIN</option>
            <option value="GOLDEN">TEST</option>
            <option value="HELD_OUT_EVAL">EVALUATE</option>
            <option value="CUSTOM">CUSTOM</option>
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
        <textarea
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono h-36"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder={`[
  { "image_id": "img_001", "image_uri": "https://...", "ground_truth_label": "DETECTED" }
]`}
        />
      ) : (
        <div className="space-y-3">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          {fileRows.length > 0 && (
            <div className="max-h-72 overflow-y-auto border border-gray-800 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900/90">
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2 px-2">Preview</th>
                    <th className="text-left py-2 px-2">image_id</th>
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-right py-2 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fileRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-900/70">
                      <td className="py-2 px-2">
                        <img
                          src={row.preview}
                          alt={row.file.name}
                          className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer"
                          onClick={() => setExpandedIndex(fileRows.findIndex((f) => f.id === row.id))}
                        />
                      </td>
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
                                r.id === row.id ? { ...r, label: e.target.value as "DETECTED" | "NOT_DETECTED" | "" } : r
                              )
                            )
                          }
                        >
                          <option value="">UNSET</option>
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

      {error && <div className="text-xs text-red-400">{error}</div>}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
      >
        {uploading ? "Uploading..." : "Upload Dataset"}
      </button>

      {expandedIndex != null && fileRows[expandedIndex] && (
        <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto flex items-start justify-center p-6">
          <button className="absolute inset-0" onClick={() => setExpandedIndex(null)} aria-label="Close preview" />
          <div className="relative z-10 w-full max-w-5xl max-h-[calc(100vh-3rem)] overflow-y-auto my-auto">
            <img
              src={fileRows[expandedIndex].preview}
              alt={fileRows[expandedIndex].file.name}
              className="w-full max-h-[75vh] object-contain rounded border border-gray-700 bg-gray-900"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function sanitizeImageId(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function validateDatasetItemImageIds(
  items: DatasetItem[]
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const item of items) {
    const imageId = String(item.image_id ?? "").trim();
    if (!imageId) return { ok: false, error: "Image ID cannot be blank." };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate image_id: ${imageId}` };
    seen.add(imageId);
  }
  return { ok: true };
}
