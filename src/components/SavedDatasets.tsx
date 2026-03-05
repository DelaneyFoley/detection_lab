"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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
  const [describingProgress, setDescribingProgress] = useState("");
  const [appendingImages, setAppendingImages] = useState(false);
  const [appendSelectionCount, setAppendSelectionCount] = useState(0);

  const loadDatasets = useCallback(async () => {
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
  }, [selectedDatasetId]);

  const loadDatasetItems = useCallback(async (datasetId: string) => {
    const res = await fetch(`/api/datasets?dataset_id=${datasetId}`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    setDatasetItems(
      items.map((item: any) => ({
        ...item,
        segment_tags: normalizeSegmentTags(item.segment_tags),
      }))
    );
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets, refreshCounter]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setDatasetItems([]);
      return;
    }
    loadDatasetItems(selectedDatasetId);
  }, [loadDatasetItems, selectedDatasetId]);

  const sortedDatasetItems = useMemo(() => {
    const copy = [...datasetItems];
    copy.sort((a, b) => {
      let delta = 0;
      if (itemSortBy === "image_id") {
        delta = naturalCollator.compare(String(a.image_id || ""), String(b.image_id || ""));
      } else {
        delta = naturalCollator.compare(String(a.ground_truth_label || ""), String(b.ground_truth_label || ""));
      }
      if (delta < 0) return itemSortDir === "asc" ? -1 : 1;
      if (delta > 0) return itemSortDir === "asc" ? 1 : -1;
      const tieBreak = naturalCollator.compare(String(a.image_id || ""), String(b.image_id || ""));
      if (tieBreak < 0) return itemSortDir === "asc" ? -1 : 1;
      if (tieBreak > 0) return itemSortDir === "asc" ? 1 : -1;
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
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedPreviewIndex((prev) => {
          if (prev == null) return prev;
          return Math.max(0, prev - 1);
        });
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
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
  const selectedDetection = detections.find((d) => d.detection_id === selectedDataset?.detection_id) || null;
  const segmentOptions = useMemo(
    () => (Array.isArray(selectedDetection?.segment_taxonomy) ? selectedDetection.segment_taxonomy : []),
    [selectedDetection?.segment_taxonomy]
  );

  useEffect(() => {
    if (!selectedDataset) return;
    setEditingName(selectedDataset.name);
    setEditingSplit(selectedDataset.split_type);
    setIsEditingDetails(false);
  }, [selectedDataset]);

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

      const itemRes = await fetch("/api/datasets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_update_items",
          dataset_id: selectedDataset.dataset_id,
          items: datasetItems.map((item) => ({
            item_id: item.item_id,
            image_id: item.image_id.trim(),
            image_uri: item.image_uri,
            image_description: item.image_description || "",
            ground_truth_label: item.ground_truth_label,
            segment_tags: normalizeSegmentTags(item.segment_tags),
          })),
        }),
      });
      if (!itemRes.ok) {
        const text = await itemRes.text();
        throw new Error(text || "Failed to save dataset items");
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

  const cancelEditingDetails = async () => {
    if (!selectedDataset) return;
    setEditingName(selectedDataset.name);
    setEditingSplit(selectedDataset.split_type);
    if (selectedDatasetId) {
      await loadDatasetItems(selectedDatasetId);
    }
    setIsEditingDetails(false);
  };

  const updateItemField = (itemId: string, patch: Partial<DatasetItem>) => {
    setDatasetItems((prev) => prev.map((item) => (item.item_id === itemId ? { ...item, ...patch } : item)));
  };

  const deleteItem = async (item: DatasetItem) => {
    if (!selectedDatasetId) return;
    if (!confirm(`Remove image "${item.image_id}" from this dataset?`)) return;
    const res = await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_item", item_id: item.item_id }),
    });
    if (!res.ok) {
      const text = await res.text();
      alert(text || "Failed to remove image");
      return;
    }
    await loadDatasets();
    await loadDatasetItems(selectedDatasetId);
    triggerRefresh();
  };

  const appendImages = async (files: FileList | null) => {
    if (!selectedDatasetId || !files || files.length === 0) return;
    setAppendingImages(true);
    try {
      const picked = Array.from(files);
      const formData = new FormData();
      formData.append("action", "append_files");
      formData.append("dataset_id", selectedDatasetId);
      formData.append(
        "items",
        JSON.stringify(
          picked.map((file) => {
            const base = file.name.replace(/\.[^.]+$/, "");
            return {
              image_id: sanitizeImageId(base || `image_${Date.now()}`),
              image_description: "",
              ground_truth_label: null,
              segment_tags: [],
            };
          })
        )
      );
      picked.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/datasets", {
        method: "PUT",
        body: formData,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to add images");
      }
      await loadDatasets();
      await loadDatasetItems(selectedDatasetId);
      triggerRefresh();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to add images";
      alert(msg);
    } finally {
      setAppendingImages(false);
    }
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
    setDescribingProgress("");
    try {
      const pendingItemIds = datasetItems
        .filter((item) => !String(item.image_description || "").trim())
        .map((item) => item.item_id);
      if (pendingItemIds.length === 0) {
        setDescribingProgress("All descriptions already populated.");
        return;
      }
      let updated = 0;
      for (let i = 0; i < pendingItemIds.length; i++) {
        setDescribingProgress(`Describing images: ${i}/${pendingItemIds.length}`);
        const res = await fetch("/api/gemini/describe-dataset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            model_override: selectedModel,
            dataset_id: selectedDatasetId,
            overwrite: false,
            item_ids: [pendingItemIds[i]],
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Failed to generate descriptions");
        updated += Number(payload.updated || 0);
      }
      setDescribingProgress(`Describing images: ${pendingItemIds.length}/${pendingItemIds.length}`);
      await loadDatasets();
      await loadDatasetItems(selectedDatasetId);
      triggerRefresh();
      alert(`Generated ${updated} descriptions.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to generate descriptions";
      alert(msg);
    } finally {
      setDescribingProgress("");
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
              {isEditingDetails && (
                <button
                  onClick={() => void cancelEditingDetails()}
                  disabled={isSavingDetails}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
                >
                  Cancel
                </button>
              )}
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
          {describingProgress && <div className="text-xs text-gray-500">{describingProgress}</div>}

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
            {isEditingDetails && (
              <div className="mb-2 flex items-center gap-2">
                <input
                  id="saved-datasets-append-files-input"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={appendingImages}
                  onChange={(e) => {
                    const count = e.target.files?.length || 0;
                    setAppendSelectionCount(count);
                    void appendImages(e.target.files);
                    e.currentTarget.value = "";
                  }}
                  className="hidden"
                />
                <label
                  htmlFor="saved-datasets-append-files-input"
                  className={`px-3 py-1.5 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 ${
                    appendingImages ? "opacity-50 pointer-events-none" : "cursor-pointer hover:bg-gray-800"
                  }`}
                >
                  Choose Files
                </label>
                <span className="text-xs text-gray-500">
                  {appendSelectionCount > 0 ? `${appendSelectionCount} Files Selected` : "Choose Files"}
                </span>
              </div>
            )}
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
                    <th className="text-left px-2 py-2">Segments</th>
                    {isEditingDetails && <th className="text-right px-2 py-2">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedDatasetItems.map((item, index) => (
                    <tr key={item.item_id} className="border-b border-gray-900/70">
                      <td className="px-2 py-2 w-44 align-middle">
                        <img
                          src={item.image_uri}
                          alt={item.image_id}
                          className="block h-24 w-36 min-w-36 max-w-36 object-cover rounded border border-gray-700 cursor-pointer"
                          onClick={() => setSelectedPreviewIndex(index)}
                        />
                      </td>
                      <td className={`px-2 py-2 ${isEditingDetails ? "align-top" : "align-middle"}`}>
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
                      <td className={`px-2 py-2 ${isEditingDetails ? "align-top" : "align-middle"}`}>
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
                      <td className={`px-2 py-2 ${isEditingDetails ? "align-top" : "align-middle"}`}>
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
                          <div className="py-1 text-xs">
                            <GroundTruthBadge value={item.ground_truth_label || null} />
                          </div>
                        )}
                      </td>
                      <td className={`px-2 py-2 min-w-[260px] ${isEditingDetails ? "align-top" : "align-middle"}`}>
                        {isEditingDetails ? (
                          <SegmentTagsEditor
                            value={normalizeSegmentTags(item.segment_tags)}
                            options={segmentOptions}
                            onChange={(next) => updateItemField(item.item_id, { segment_tags: next } as Partial<DatasetItem>)}
                          />
                        ) : (
                          <SegmentTagList value={normalizeSegmentTags(item.segment_tags)} />
                        )}
                      </td>
                      {isEditingDetails && (
                        <td className={`px-2 py-2 text-right ${isEditingDetails ? "align-top" : "align-middle"}`}>
                          <button
                            onClick={() => void deleteItem(item)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {datasetItems.length === 0 && (
                    <tr>
                      <td colSpan={isEditingDetails ? 6 : 5} className="px-2 py-5 text-center text-gray-500">
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

      <ImagePreviewModal
        isOpen={selectedPreviewIndex != null && !!sortedDatasetItems[selectedPreviewIndex || 0]}
        imageUrl={selectedPreviewIndex != null ? sortedDatasetItems[selectedPreviewIndex]?.image_uri || "" : ""}
        imageAlt={selectedPreviewIndex != null ? sortedDatasetItems[selectedPreviewIndex]?.image_id || "Preview" : "Preview"}
        title="Dataset Preview"
        subtitle={selectedPreviewIndex != null ? sortedDatasetItems[selectedPreviewIndex]?.image_id || "" : ""}
        index={selectedPreviewIndex ?? 0}
        total={sortedDatasetItems.length}
        onClose={() => setSelectedPreviewIndex(null)}
        onPrev={() => setSelectedPreviewIndex((prev) => (prev == null ? null : Math.max(0, prev - 1)))}
        onNext={() =>
          setSelectedPreviewIndex((prev) =>
            prev == null ? null : Math.min(sortedDatasetItems.length - 1, prev + 1)
          )
        }
        details={
          selectedPreviewIndex != null && sortedDatasetItems[selectedPreviewIndex] ? (
            <div className="space-y-3">
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
                    <GroundTruthBadge value={sortedDatasetItems[selectedPreviewIndex].ground_truth_label || null} />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Segments</label>
                {isEditingDetails ? (
                  <SegmentTagsEditor
                    value={normalizeSegmentTags(sortedDatasetItems[selectedPreviewIndex].segment_tags)}
                    options={segmentOptions}
                    onChange={(next) =>
                      updateItemField(sortedDatasetItems[selectedPreviewIndex].item_id, { segment_tags: next } as Partial<DatasetItem>)
                    }
                  />
                ) : (
                  <SegmentTagList value={normalizeSegmentTags(sortedDatasetItems[selectedPreviewIndex].segment_tags)} />
                )}
              </div>
            </div>
          ) : null
        }
      />
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
  const [mode, setMode] = useState<"json" | "excel" | "files">("files");
  const [jsonInput, setJsonInput] = useState("");
  const [jsonRows, setJsonRows] = useState<
    Array<{
      image_id: string;
      image_url: string;
      ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
      segment_tags?: string[] | string;
    }>
  >([]);
  const [excelRows, setExcelRows] = useState<
    Array<{
      image_id: string;
      image_url: string;
      ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
      segment_tags?: string[] | string;
    }>
  >([]);
  const [excelFileName, setExcelFileName] = useState("");
  const [autoSplit, setAutoSplit] = useState(false);
  const [fileRows, setFileRows] = useState<
    Array<{
      id: string;
      file: File;
      preview: string;
      imageId: string;
      label: "DETECTED" | "NOT_DETECTED" | "";
      segment_tags: string[];
    }>
  >([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const selectedDetection = detections.find((d) => d.detection_id === detectionId) || null;
  const segmentOptions = Array.isArray(selectedDetection?.segment_taxonomy) ? selectedDetection.segment_taxonomy : [];

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
      segment_tags: string[];
    }> = picked.map((file, i) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        id: `${Date.now()}_${i}_${base}`,
        file,
        preview: URL.createObjectURL(file),
        imageId: sanitizeImageId(base || `image_${i + 1}`),
        label: "",
        segment_tags: [],
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

        if (autoSplit) {
          if (fileRows.some((r) => !r.label)) {
            setError("Auto-split requires all ground truth labels to be set.");
            return;
          }
          const splitItems = splitRowsForAutoSplit(
            fileRows.map((r) => ({
              image_id: r.imageId.trim(),
              ground_truth_label: r.label as "DETECTED" | "NOT_DETECTED",
              segment_tags: normalizeSegmentTags(r.segment_tags),
              file: r.file,
            }))
          );
          const splitDefs: Array<{ key: "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL"; label: string }> = [
            { key: "ITERATION", label: "TRAIN" },
            { key: "GOLDEN", label: "TEST" },
            { key: "HELD_OUT_EVAL", label: "EVAL" },
          ];
          for (const split of splitDefs) {
            const items = splitItems[split.key];
            if (items.length === 0) continue;
            const formData = new FormData();
            formData.append("name", `${name.trim()} (${split.label})`);
            formData.append("detection_id", detectionId);
            formData.append("split_type", split.key);
            formData.append(
              "items",
              JSON.stringify(
                items.map((item) => ({
                  image_id: item.image_id,
                  image_description: "",
                  ground_truth_label: item.ground_truth_label,
                  segment_tags: item.segment_tags,
                }))
              )
            );
            items.forEach((item) => formData.append("files", item.file));
            const res = await fetch("/api/datasets", { method: "POST", body: formData });
            if (!res.ok) {
              const payload = await res.json().catch(() => null);
              throw new Error(payload?.error || `Failed to create ${split.label} dataset`);
            }
          }
        } else {
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
                segment_tags: normalizeSegmentTags(r.segment_tags),
              }))
            )
          );
          fileRows.forEach((r) => formData.append("files", r.file));
          await fetch("/api/datasets", { method: "POST", body: formData });
        }
      } else if (mode === "excel") {
        const items = excelRows.map((row) => ({
          image_id: row.image_id,
          image_uri: row.image_url,
          ground_truth_label: row.ground_truth_label,
          segment_tags: normalizeSegmentTags(row.segment_tags),
        }));
        if (autoSplit) {
          await fetch("/api/datasets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_split_datasets",
              name_prefix: name.trim(),
              detection_id: detectionId,
              items,
            }),
          });
        } else {
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
      } else {
        const sourceRows = jsonRows.length > 0 ? jsonRows : parseJsonManifest(jsonInput);
        const items = sourceRows.map((row) => ({
          image_id: row.image_id,
          image_uri: row.image_url,
          ground_truth_label: row.ground_truth_label,
          segment_tags: normalizeSegmentTags(row.segment_tags),
        }));
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
        if (autoSplit) {
          await fetch("/api/datasets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_split_datasets",
              name_prefix: name.trim(),
              detection_id: detectionId,
              items,
            }),
          });
        } else {
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
          onClick={() => setMode("excel")}
          className={`px-3 py-1.5 text-xs rounded ${mode === "excel" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
        >
          Excel Manifest
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
        <div className="space-y-2">
          <textarea
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono h-36"
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[
  { "image_id": "img_001", "image_uri": "https://...", "ground_truth_label": "DETECTED" }
]`}
          />
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700"
            onClick={() => {
              try {
                const parsed = parseJsonManifest(jsonInput);
                setJsonRows(parsed);
                setError("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Invalid JSON");
              }
            }}
          >
            Load JSON for Review
          </button>
        </div>
      ) : mode === "excel" ? (
        <div className="space-y-2">
          <input
            id="saved-datasets-excel-input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const parsed = await parseExcelManifest(file);
              setExcelRows(parsed);
              setExcelFileName(file.name);
              e.currentTarget.value = "";
            }}
            className="hidden"
          />
          <label
            htmlFor="saved-datasets-excel-input"
            className="inline-block px-3 py-2 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 cursor-pointer hover:bg-gray-800"
          >
            Choose Files
          </label>
          <span className="ml-3 text-xs text-gray-500">
            {excelFileName ? "1 Files Selected" : "Choose Files"}
          </span>
          <p className="text-[11px] text-gray-500">
            Required columns: `image_id`, `image_url`, `ground_truth_label` (label can be DETECTED, NOT_DETECTED, or blank).
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            id="saved-datasets-files-input"
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
          <label
            htmlFor="saved-datasets-files-input"
            className="inline-block px-3 py-2 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 cursor-pointer hover:bg-gray-800"
          >
            Choose Files
          </label>
          <span className="ml-3 text-xs text-gray-500">
            {fileRows.length > 0 ? `${fileRows.length} Files Selected` : "Choose Files"}
          </span>
          {fileRows.length > 0 && (
            <div className="max-h-72 overflow-y-auto border border-gray-800 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900/90">
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2 px-2">Preview</th>
                    <th className="text-left py-2 px-2">image_id</th>
                    <th className="text-left py-2 px-2">Label</th>
                    <th className="text-left py-2 px-2">Segments</th>
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
                      <td className="py-2 px-2 min-w-[220px]">
                        <SegmentTagsEditor
                          value={normalizeSegmentTags(row.segment_tags)}
                          options={segmentOptions}
                          onChange={(next) =>
                            setFileRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, segment_tags: next } : r)))
                          }
                        />
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

      {(mode === "excel" ? excelRows.length > 0 : mode === "json" ? jsonRows.length > 0 : false) && (
        <div className="max-h-72 overflow-auto border border-gray-800 rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900/90">
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 px-2">Image ID</th>
                <th className="text-left py-2 px-2">Image URL</th>
                <th className="text-left py-2 px-2">Ground Truth</th>
                <th className="text-left py-2 px-2">Segments</th>
              </tr>
            </thead>
            <tbody>
              {(mode === "excel" ? excelRows : jsonRows).map((row, idx) => (
                <tr key={`${row.image_id}_${idx}`} className="border-b border-gray-900/70 align-top">
                  <td className="py-2 px-2 font-mono text-gray-300">{row.image_id}</td>
                  <td className="py-2 px-2 text-gray-400 max-w-[320px] truncate" title={row.image_url}>
                    {row.image_url}
                  </td>
                  <td className="py-2 px-2">
                    <select
                      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                      value={row.ground_truth_label || ""}
                      onChange={(e) => {
                        const nextLabel = (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null;
                        if (mode === "excel") {
                          setExcelRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, ground_truth_label: nextLabel } : r))
                          );
                        } else {
                          setJsonRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, ground_truth_label: nextLabel } : r))
                          );
                        }
                      }}
                    >
                      <option value="">UNSET</option>
                      <option value="DETECTED">DETECTED</option>
                      <option value="NOT_DETECTED">NOT_DETECTED</option>
                    </select>
                  </td>
                  <td className="py-2 px-2 min-w-[220px]">
                    <SegmentTagsEditor
                      value={normalizeSegmentTags(row.segment_tags)}
                      options={segmentOptions}
                      onChange={(next) => {
                        if (mode === "excel") {
                          setExcelRows((prev) => prev.map((r, i) => (i === idx ? { ...r, segment_tags: next } : r)));
                        } else {
                          setJsonRows((prev) => prev.map((r, i) => (i === idx ? { ...r, segment_tags: next } : r)));
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}

      {(mode === "excel" || mode === "json" || mode === "files") && (
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={autoSplit}
            onChange={(e) => setAutoSplit(e.target.checked)}
          />
          Auto-split into TRAIN/TEST/EVAL datasets (label stratification + segment balancing; requires labels)
        </label>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
      >
        {uploading ? "Uploading..." : "Upload Dataset"}
      </button>

      <ImagePreviewModal
        isOpen={expandedIndex != null && !!fileRows[expandedIndex || 0]}
        imageUrl={expandedIndex != null ? fileRows[expandedIndex]?.preview || "" : ""}
        imageAlt={expandedIndex != null ? fileRows[expandedIndex]?.file.name || "Preview" : "Preview"}
        title="Upload Preview"
        subtitle={expandedIndex != null ? fileRows[expandedIndex]?.file.name || "" : ""}
        index={expandedIndex ?? 0}
        total={fileRows.length}
        onClose={() => setExpandedIndex(null)}
        onPrev={() => setExpandedIndex((i) => (i == null ? null : Math.max(0, i - 1)))}
        onNext={() => setExpandedIndex((i) => (i == null ? null : Math.min(fileRows.length - 1, i + 1)))}
      />
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
    const segmentTags = (row.segment_tags ?? row.segmentTags ?? row.segments ?? "") as string[] | string;
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

function normalizeSegmentTags(value: unknown): string[] {
  if (value == null) return [];
  const rawParts = Array.isArray(value)
    ? value.map((v) => String(v || ""))
    : String(value)
        .split(/[;,|]/g)
        .map((v) => String(v || ""));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of rawParts) {
    const clean = part.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(clean);
  }
  return tags;
}

function SegmentTagList({ value }: { value: string[] }) {
  if (!value.length) return <span className="text-gray-500 text-[11px]">No segments</span>;
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
    <div className="flex flex-col gap-1.5">
      <div className="w-full">
        <select
          className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px]"
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
      </div>
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
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

function splitRowsForAutoSplit<T extends { ground_truth_label: "DETECTED" | "NOT_DETECTED"; segment_tags?: string[] }>(
  rows: T[]
): Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", T[]> {
  const order: Array<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL"> = ["ITERATION", "GOLDEN", "HELD_OUT_EVAL"];
  const splits: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", T[]> = {
    ITERATION: [],
    GOLDEN: [],
    HELD_OUT_EVAL: [],
  };
  const shuffle = (items: T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const countsByRatios = (total: number, ratios: [number, number, number] = [0.7, 0.15, 0.15]) => {
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
  const allocate = (bucket: T[]) => {
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
    const prioritized = [...bucket].sort((a, b) => (b.segment_tags?.length || 0) - (a.segment_tags?.length || 0));
    for (const row of prioritized) {
      const candidates = order.filter((split) => assigned[split] < counts[order.indexOf(split)]);
      if (!candidates.length) break;
      let best = candidates[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const split of candidates) {
        const cap = Math.max(1, counts[order.indexOf(split)]);
        const loadPenalty = assigned[split] / cap;
        let segPenalty = 0;
        for (const tag of row.segment_tags || []) segPenalty += segmentCounts[split].get(tag) || 0;
        const score = segPenalty + loadPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = split;
        }
      }
      splits[best].push(row);
      assigned[best] += 1;
      for (const tag of row.segment_tags || []) {
        segmentCounts[best].set(tag, (segmentCounts[best].get(tag) || 0) + 1);
      }
    }
  };
  allocate(shuffle(rows.filter((r) => r.ground_truth_label === "DETECTED")));
  allocate(shuffle(rows.filter((r) => r.ground_truth_label === "NOT_DETECTED")));
  return splits;
}

function GroundTruthBadge({ value }: { value: "DETECTED" | "NOT_DETECTED" | null }) {
  if (!value) return <span className="text-gray-400">UNSET</span>;
  if (value === "DETECTED") {
    return <span className="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300">DETECTED</span>;
  }
  return <span className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300">NOT_DETECTED</span>;
}
