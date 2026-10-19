"use client";

import { useMemo, useState } from "react";
import type { Dataset, Detection } from "@/types";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { splitTypeLabel } from "@/lib/splitType";

type MergeFrame = {
  image_uri: string;
  present: string[];
  absent: string[];
  gaps: string[];
  conflicts: string[];
  attributes: string[];
};

type MergePreview = {
  labels: string[];
  sources: Array<{ dataset_id: string; name: string; label: string }>;
  frames: MergeFrame[];
  attribute_vocabulary: string[];
  total_frames: number;
  frames_with_gaps: number;
  conflict_frames: number;
};

type Resolution = "present" | "absent";
type ReviewMode = "by_image" | "by_label";
type AttrMode = "apply" | "list_only" | "none";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "merged"
  );
}

export function MergeDatasets({
  datasets,
  detections,
  onCreated,
}: {
  datasets: Dataset[];
  detections: Detection[];
  onCreated: () => void;
}) {
  const { notify } = useAppFeedback();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [splitType, setSplitType] = useState("MASTER");
  const [saving, setSaving] = useState(false);
  // frameUrl -> label -> resolution
  const [resolutions, setResolutions] = useState<Record<string, Record<string, Resolution>>>({});
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("by_image");
  const [activeLabel, setActiveLabel] = useState<string>("");
  const [attrMode, setAttrMode] = useState<AttrMode>("apply");

  const prodLabelByDetection = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of detections) if (d.production_label) m.set(d.detection_id, d.production_label);
    return m;
  }, [detections]);

  const datasetLabel = (d: Dataset): string => (d.detection_id ? prodLabelByDetection.get(d.detection_id) || "" : "");

  const toggleSelected = (id: string) => {
    setPreview(null);
    setResolutions({});
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runPreview = async () => {
    setError("");
    setPreview(null);
    setResolutions({});
    setReviewIndex(0);
    if (selected.size < 2) {
      setError("Select at least two datasets to merge.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "merge_preview", dataset_ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data?.missing_label_datasets) && data.missing_label_datasets.length > 0) {
          const list = data.missing_label_datasets.map((m: any) => `${m.name} (${m.reason})`).join("; ");
          setError(`${data.error} ${list}`);
        } else {
          setError(data?.error || "Failed to preview merge.");
        }
        return;
      }
      setPreview(data as MergePreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to preview merge.");
    } finally {
      setLoading(false);
    }
  };

  const gapFrames = useMemo(() => (preview ? preview.frames.filter((f) => f.gaps.length > 0) : []), [preview]);

  const labelsWithGaps = useMemo(() => {
    if (!preview) return [] as string[];
    const set = new Set<string>();
    for (const f of gapFrames) for (const l of f.gaps) set.add(l);
    return preview.labels.filter((l) => set.has(l));
  }, [preview, gapFrames]);
  const effectiveActiveLabel = labelsWithGaps.includes(activeLabel) ? activeLabel : labelsWithGaps[0] || "";
  const framesForActiveLabel = useMemo(
    () => gapFrames.filter((f) => f.gaps.includes(effectiveActiveLabel)),
    [gapFrames, effectiveActiveLabel]
  );

  const frameFullyResolved = (f: MergeFrame): boolean =>
    f.gaps.every((l) => !!resolutions[f.image_uri]?.[l]);

  const resolvedGapFrameCount = useMemo(
    () => gapFrames.filter(frameFullyResolved).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gapFrames, resolutions]
  );
  const allResolved = gapFrames.length === 0 || resolvedGapFrameCount === gapFrames.length;

  const setResolution = (frameUrl: string, label: string, value: Resolution) => {
    setResolutions((prev) => ({
      ...prev,
      [frameUrl]: { ...(prev[frameUrl] || {}), [label]: value },
    }));
  };

  // Bulk-resolve every still-unresolved frame of the active label (by-label mode).
  const bulkResolveActiveLabel = (value: Resolution) => {
    setResolutions((prev) => {
      const next = { ...prev };
      for (const f of framesForActiveLabel) {
        if (!next[f.image_uri]?.[effectiveActiveLabel]) {
          next[f.image_uri] = { ...(next[f.image_uri] || {}), [effectiveActiveLabel]: value };
        }
      }
      return next;
    });
  };

  const createMerged = async () => {
    if (!preview) return;
    if (!name.trim()) {
      setError("Enter a name for the merged dataset.");
      return;
    }
    if (!allResolved) {
      setError("Resolve every flagged image's labels before saving.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const prefix = `${slugify(name)}_${Math.random().toString(36).slice(2, 8)}`;
      const items = preview.frames.map((f, i) => {
        const resolvedPresent = f.gaps.filter((l) => resolutions[f.image_uri]?.[l] === "present");
        const labels = Array.from(new Set([...f.present, ...resolvedPresent]));
        // Attribute carry-over per the chosen option.
        const segment_tags = attrMode === "apply" ? f.attributes : [];
        return {
          image_id: `${prefix}_${String(i + 1).padStart(5, "0")}`,
          image_uri: f.image_uri,
          ground_truth_labels: labels,
          segment_tags,
        };
      });
      const body: Record<string, unknown> = {
        name: name.trim(),
        detection_id: null,
        split_type: splitType,
        items,
      };
      if (attrMode !== "none") body.segment_taxonomy = preview.attribute_vocabulary;
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.dataset_id) {
        throw new Error(data?.error || "Failed to create merged dataset.");
      }
      notify({ message: `Created merged multi-label dataset "${name.trim()}" with ${items.length} images.`, tone: "success" });
      setOpen(false);
      setSelected(new Set());
      setPreview(null);
      setResolutions({});
      setName("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create merged dataset.");
    } finally {
      setSaving(false);
    }
  };

  const currentGapFrame = gapFrames[reviewIndex];

  return (
    <div className="app-section space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-200">Merge into Multi-Label Dataset</h3>
          <p className="text-xs text-gray-500">
            Combine single-label datasets by frame URL. Each source detection&apos;s Production Label becomes a ground-truth
            label; frames missing a review for a detection are flagged for labeling before saving.
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="app-btn app-btn-secondary app-btn-sm text-xs">
          {open ? "Close" : "Start Merge"}
        </button>
      </div>

      {open && (
        <div className="space-y-4">
          {/* Step 1: select datasets */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300 mb-2">1 · Select datasets</div>
            <div className="app-table-wrap max-h-64 overflow-y-auto">
              <table className="app-table app-table-fixed text-xs">
                <colgroup>
                  <col style={{ width: "3rem" }} />
                  <col />
                  <col style={{ width: "14rem" }} />
                  <col style={{ width: "10rem" }} />
                  <col style={{ width: "6rem" }} />
                </colgroup>
                <thead className="sticky top-0">
                  <tr>
                    <th></th>
                    <th className="app-table-col-label">Dataset</th>
                    <th className="app-table-col-label">Production Label</th>
                    <th className="app-table-col-label">Split</th>
                    <th className="app-table-col-center">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((d) => {
                    const label = datasetLabel(d);
                    return (
                      <tr key={d.dataset_id} className={selected.has(d.dataset_id) ? "bg-sky-900/15" : ""}>
                        <td className="app-table-col-center">
                          <input
                            type="checkbox"
                            checked={selected.has(d.dataset_id)}
                            onChange={() => toggleSelected(d.dataset_id)}
                          />
                        </td>
                        <td className="text-gray-200">{d.name}</td>
                        <td>
                          {label ? (
                            <span className="rounded bg-sky-600/20 px-1.5 py-0.5 text-[10px] text-sky-200">{label}</span>
                          ) : (
                            <span className="text-[10px] text-amber-400">no production label</span>
                          )}
                        </td>
                        <td className="text-gray-400">{splitTypeLabel(d.split_type)}</td>
                        <td className="app-table-col-center text-gray-400">{d.size}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={runPreview}
                disabled={loading || selected.size < 2}
                className="app-btn app-btn-primary app-btn-sm text-xs disabled:opacity-50"
              >
                {loading ? "Analyzing…" : `Preview Merge (${selected.size})`}
              </button>
              {error && <span className="text-xs text-red-400">{error}</span>}
            </div>
          </div>

          {/* Step 2: preview + gap review */}
          {preview && (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">2 · Review coverage</div>
              <div className="flex flex-wrap gap-4 rounded-lg border border-white/8 bg-[rgba(10,25,45,0.35)] px-3 py-2 text-xs">
                <span className="text-gray-400">Labels: <span className="text-gray-200">{preview.labels.join(", ")}</span></span>
                <span className="text-gray-400">Unique frames: <span className="text-gray-200">{preview.total_frames}</span></span>
                <span className="text-gray-400">Need review: <span className={preview.frames_with_gaps > 0 ? "text-amber-300" : "text-green-400"}>{preview.frames_with_gaps}</span></span>
                {preview.conflict_frames > 0 && (
                  <span className="text-gray-400">Conflicts: <span className="text-amber-300">{preview.conflict_frames}</span> (present wins)</span>
                )}
              </div>

              {gapFrames.length > 0 ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-900/10 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-200">
                      Labels missing ground truth ({resolvedGapFrameCount}/{gapFrames.length} images resolved)
                    </span>
                    <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-0.5">
                      <button
                        onClick={() => setReviewMode("by_image")}
                        className={`rounded px-2 py-0.5 text-[11px] ${reviewMode === "by_image" ? "bg-sky-600/40 text-white" : "text-gray-400"}`}
                      >
                        By image
                      </button>
                      <button
                        onClick={() => setReviewMode("by_label")}
                        className={`rounded px-2 py-0.5 text-[11px] ${reviewMode === "by_label" ? "bg-sky-600/40 text-white" : "text-gray-400"}`}
                      >
                        By label
                      </button>
                    </div>
                  </div>

                  {reviewMode === "by_image" ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-500">Image {Math.min(reviewIndex + 1, gapFrames.length)} / {gapFrames.length}</span>
                        <div className="flex gap-2">
                          <button onClick={() => setReviewIndex((i) => Math.max(0, i - 1))} disabled={reviewIndex <= 0} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-40">← Prev</button>
                          <button onClick={() => setReviewIndex((i) => Math.min(gapFrames.length - 1, i + 1))} disabled={reviewIndex >= gapFrames.length - 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-40">Next →</button>
                        </div>
                      </div>
                      {currentGapFrame && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <img src={currentGapFrame.image_uri} alt="frame" className="w-full rounded border border-gray-700 object-contain max-h-[360px] bg-black/30" />
                          <div className="space-y-3">
                            {currentGapFrame.present.length > 0 && (
                              <div className="text-xs text-gray-400">
                                Known present:{" "}
                                {currentGapFrame.present.map((l) => (
                                  <span key={l} className="ml-1 rounded bg-sky-600/20 px-1.5 py-0.5 text-[10px] text-sky-200">{l}</span>
                                ))}
                              </div>
                            )}
                            <div className="space-y-2">
                              {currentGapFrame.gaps.map((label) => {
                                const value = resolutions[currentGapFrame.image_uri]?.[label];
                                const isConflict = currentGapFrame.conflicts.includes(label);
                                return (
                                  <div key={label} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                                    <span className="text-xs text-gray-200">
                                      {label}
                                      {isConflict && <span className="ml-1 text-[10px] text-amber-400" title="Sources disagreed on this label">⚠ sources disagree</span>}
                                    </span>
                                    <div className="flex gap-1">
                                      <button onClick={() => setResolution(currentGapFrame.image_uri, label, "present")} className={`app-btn app-btn-sm text-[11px] ${value === "present" ? "app-btn-primary" : "app-btn-subtle"}`}>Present</button>
                                      <button onClick={() => setResolution(currentGapFrame.image_uri, label, "absent")} className={`app-btn app-btn-sm text-[11px] ${value === "absent" ? "app-btn-primary" : "app-btn-subtle"}`}>Not Present</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-500">Label</span>
                        <select value={effectiveActiveLabel} onChange={(e) => setActiveLabel(e.target.value)} className="app-select text-xs">
                          {labelsWithGaps.map((l) => {
                            const left = gapFrames.filter((f) => f.gaps.includes(l) && !resolutions[f.image_uri]?.[l]).length;
                            return <option key={l} value={l}>{l} — {left} left</option>;
                          })}
                        </select>
                        <button onClick={() => bulkResolveActiveLabel("absent")} className="app-btn app-btn-subtle app-btn-sm text-[11px]">Mark all remaining Not Present</button>
                        <button onClick={() => bulkResolveActiveLabel("present")} className="app-btn app-btn-subtle app-btn-sm text-[11px]">Mark all remaining Present</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 max-h-[420px] overflow-y-auto pr-1">
                        {framesForActiveLabel.map((f) => {
                          const value = resolutions[f.image_uri]?.[effectiveActiveLabel];
                          const isConflict = f.conflicts.includes(effectiveActiveLabel);
                          return (
                            <div key={f.image_uri} className={`rounded border p-1.5 ${value ? "border-white/10" : "border-amber-500/30"} bg-black/20`}>
                              <img src={f.image_uri} alt="frame" className="h-24 w-full rounded object-cover" />
                              {isConflict && <div className="mt-0.5 text-[9px] text-amber-400">⚠ sources disagree</div>}
                              <div className="mt-1 flex gap-1">
                                <button onClick={() => setResolution(f.image_uri, effectiveActiveLabel, "present")} className={`flex-1 rounded py-0.5 text-[10px] ${value === "present" ? "bg-sky-600 text-white" : "bg-white/10 text-gray-300"}`}>Present</button>
                                <button onClick={() => setResolution(f.image_uri, effectiveActiveLabel, "absent")} className={`flex-1 rounded py-0.5 text-[10px] ${value === "absent" ? "bg-sky-600 text-white" : "bg-white/10 text-gray-300"}`}>Not</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-green-500/25 bg-green-900/10 px-3 py-2 text-xs text-green-300">
                  Every frame has ground truth for all labels — no review needed.
                </div>
              )}

              {/* Step 3: save */}
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">3 · Save merged dataset</div>

              {preview.attribute_vocabulary.length > 0 && (
                <div className="rounded-lg border border-white/8 bg-[rgba(10,25,45,0.35)] p-3 space-y-2">
                  <div className="text-xs font-medium text-gray-200">Image attributes</div>
                  <p className="text-[11px] text-gray-500">
                    Combined attribute list from the source datasets: {preview.attribute_vocabulary.join(", ")}.
                  </p>
                  {[
                    { value: "apply" as AttrMode, label: "Carry over the attribute list and keep each image's attributes", hint: "An attribute is applied to an image if it was set in any source dataset; the rest stay unselected." },
                    { value: "list_only" as AttrMode, label: "Carry over the attribute list, but clear every image's attributes", hint: "Keeps the attribute options available; no attributes are pre-applied." },
                    { value: "none" as AttrMode, label: "Don't carry over attributes", hint: "The merged dataset starts with no attribute list." },
                  ].map((opt) => (
                    <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="merge-attr-mode"
                        className="mt-0.5"
                        checked={attrMode === opt.value}
                        onChange={() => setAttrMode(opt.value)}
                      />
                      <span>
                        <span className="text-xs text-gray-200">{opt.label}</span>
                        <span className="block text-[11px] text-gray-500">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Merged dataset name</label>
                  <input
                    className="app-input text-xs"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kitchen Fire Core — Multi-Label Master"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Split</label>
                  <select className="app-select text-xs" value={splitType} onChange={(e) => setSplitType(e.target.value)}>
                    <option value="MASTER">MASTER</option>
                    <option value="CUSTOM">CUSTOM</option>
                    <option value="ITERATION">TRAIN</option>
                    <option value="GOLDEN">TEST</option>
                    <option value="HELD_OUT_EVAL">EVALUATE</option>
                  </select>
                </div>
                <button
                  onClick={createMerged}
                  disabled={saving || !allResolved || !name.trim()}
                  className="app-btn app-btn-success app-btn-sm text-xs disabled:opacity-50"
                  title={!allResolved ? "Resolve all flagged images first" : ""}
                >
                  {saving ? "Creating…" : `Create Merged Dataset (${preview.total_frames} images)`}
                </button>
                {!allResolved && (
                  <span className="text-xs text-amber-400">{gapFrames.length - resolvedGapFrameCount} image(s) still need labels</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
