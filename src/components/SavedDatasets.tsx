"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection, SplitType, ReviewFlag } from "@/types";
import { splitTypeBadgeClass, splitTypeLabel } from "@/lib/splitType";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { AttributePills } from "@/components/shared/AttributePills";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { compareImageIds } from "@/lib/imageIdSort";
import { DecisionBadge } from "@/components/shared/DecisionBadge";
import { STATUS_LABELS, STATUS_BADGE_CLASSES, QA_STATUS_ORDER, derivedParentStatus } from "@/lib/statusConstants";
import { Flag, Link2, LayoutGrid, PackageCheck, Scale, RefreshCw, Archive, FileText, MoreHorizontal, ChevronRight, ChevronDown, Search, X } from "lucide-react";

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function SavedDatasets({ detections }: { detections: Detection[] }) {
  const { triggerRefresh, refreshCounter, pendingDatasetId, setPendingDatasetId } = useAppStore();
  const { notify, confirm } = useAppFeedback();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [editingName, setEditingName] = useState("");
  const [editingDetectionId, setEditingDetectionId] = useState("");
  const [editingSplit, setEditingSplit] = useState<SplitType>("MASTER");
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [autoSplittingMaster, setAutoSplittingMaster] = useState(false);
  const [itemSortBy, setItemSortBy] = useState<"image_id" | "ground_truth_label">("image_id");
  const [itemSortDir, setItemSortDir] = useState<"asc" | "desc">("asc");
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [segmentOptionsDraft, setSegmentOptionsDraft] = useState<string[]>([]);
  const [newSegmentOption, setNewSegmentOption] = useState("");
  const [savingSegments, setSavingSegments] = useState(false);

  // Review flags state
  const [flaggedItemIds, setFlaggedItemIds] = useState<Set<string>>(new Set());
  const [flagsByItemId, setFlagsByItemId] = useState<Record<string, ReviewFlag>>({});
  const [resolvedFlagsByItemId, setResolvedFlagsByItemId] = useState<Record<string, ReviewFlag>>({});
  const [flagModalItemId, setFlagModalItemId] = useState<string | null>(null);
  const [resolveModalFlagId, setResolveModalFlagId] = useState<string | null>(null);

  // Assign Annotators modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignAnnotators, setAssignAnnotators] = useState<string[]>([]);
  const [assignResetLabels, setAssignResetLabels] = useState(true);
  const [assignResetSegments, setAssignResetSegments] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [availableAnnotators, setAvailableAnnotators] = useState<string[]>([]);
  const [alreadyAssignedAnnotators, setAlreadyAssignedAnnotators] = useState<string[]>([]);

  // Accordion expand state
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const loadDatasets = useCallback(async () => {
    const res = await fetch("/api/datasets");
    const data = await res.json();
    const rows = (Array.isArray(data) ? data : []).map((d: any) => ({
      ...d,
      segment_taxonomy: typeof d.segment_taxonomy === "string" ? JSON.parse(d.segment_taxonomy || "[]") : (Array.isArray(d.segment_taxonomy) ? d.segment_taxonomy : []),
    }));
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

    // Load review flags for this dataset
    const flagsRes = await fetch(`/api/review-flags?dataset_id=${datasetId}`);
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
    } else {
      setFlaggedItemIds(new Set());
      setFlagsByItemId({});
      setResolvedFlagsByItemId({});
    }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets, refreshCounter]);

  useEffect(() => {
    if (pendingDatasetId) {
      setSelectedDatasetId(pendingDatasetId);
      setPendingDatasetId(null);
    }
  }, [pendingDatasetId, setPendingDatasetId]);

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
        delta = compareImageIds(String(a.image_id || ""), String(b.image_id || ""));
      } else {
        delta = naturalCollator.compare(String(a.ground_truth_label || ""), String(b.ground_truth_label || ""));
      }
      if (delta < 0) return itemSortDir === "asc" ? -1 : 1;
      if (delta > 0) return itemSortDir === "asc" ? 1 : -1;
      const tieBreak = compareImageIds(String(a.image_id || ""), String(b.image_id || ""));
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

  const [datasetPage, setDatasetPage] = useState(1);
  const [datasetPageSize, setDatasetPageSize] = useState(5);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [datasetSortKey, setDatasetSortKey] = useState<"name" | "detection" | "split" | "status" | "updated">("updated");
  const [datasetSortDir, setDatasetSortDir] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const STATUS_TABS = useMemo(() => [
    { id: "all", label: "All", icon: <LayoutGrid className="h-4 w-4" /> },
    { id: "drafts", label: "Drafts", icon: <FileText className="h-4 w-4" />, statuses: ["draft"] },
    { id: "processing", label: "Processing", icon: <RefreshCw className="h-4 w-4" />, statuses: ["assigned", "in_annotation", "needs_revision"] },
    { id: "review", label: "In Review", icon: <Scale className="h-4 w-4" />, statuses: ["submitted", "in_qa", "approved"] },
    { id: "finalized", label: "Finalized", icon: <PackageCheck className="h-4 w-4" />, statuses: ["finalized"] },
    { id: "archived", label: "Archived", icon: <Archive className="h-4 w-4" />, statuses: ["archived"] },
  ], []);

  const filteredDatasets = useMemo(() => {
    const tab = STATUS_TABS.find((t) => t.id === statusFilter);
    if (!tab || statusFilter === "all") {
      return datasets.filter((d) => (d.qa_status || "draft") !== "archived");
    }
    return datasets.filter((d) => tab.statuses!.includes(d.qa_status || "draft"));
  }, [datasets, statusFilter, STATUS_TABS]);

  const displayGroups = useMemo(() => {
    const groups: { parent: Dataset; children: Dataset[] }[] = [];
    const childIds = new Set(filteredDatasets.filter((d) => d.linked_dataset_id).map((d) => d.dataset_id));
    const filteredIds = new Set(filteredDatasets.map((d) => d.dataset_id));

    for (const d of filteredDatasets) {
      if (d.linked_dataset_id && filteredIds.has(d.linked_dataset_id)) continue;
      const children = filteredDatasets.filter((c) => c.linked_dataset_id === d.dataset_id);
      groups.push({ parent: d, children });
    }

    if (!searchQuery.trim()) return groups;
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((g) => {
      const name = (g.parent.name || "").toLowerCase();
      const detection = (detectionNameById.get(g.parent.detection_id || "") || "").toLowerCase();
      return name.includes(q) || detection.includes(q);
    });
  }, [filteredDatasets, searchQuery, detectionNameById]);

  const sortedGroups = useMemo(() => {
    const copy = [...displayGroups];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (datasetSortKey) {
        case "name":
          cmp = (a.parent.name || "").localeCompare(b.parent.name || "");
          break;
        case "detection":
          cmp = (detectionNameById.get(a.parent.detection_id || "") || "").localeCompare(detectionNameById.get(b.parent.detection_id || "") || "");
          break;
        case "split":
          cmp = (a.parent.split_type || "").localeCompare(b.parent.split_type || "");
          break;
        case "status": {
          const statusA = a.children.length > 0 ? derivedStatus(a.children) : (a.parent.qa_status || "draft");
          const statusB = b.children.length > 0 ? derivedStatus(b.children) : (b.parent.qa_status || "draft");
          cmp = (QA_STATUS_ORDER[statusA] ?? 1) - (QA_STATUS_ORDER[statusB] ?? 1);
          break;
        }
        case "updated":
          cmp = (a.parent.updated_at || "").localeCompare(b.parent.updated_at || "");
          break;
      }
      return datasetSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [displayGroups, datasetSortKey, datasetSortDir, detectionNameById]);

  const totalGroups = sortedGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / datasetPageSize));
  const paginatedGroups = sortedGroups.slice((datasetPage - 1) * datasetPageSize, datasetPage * datasetPageSize);


  const selectedDataset = datasets.find((d) => d.dataset_id === selectedDatasetId) || null;
  const selectedDatasetChildren = useMemo(
    () => selectedDataset ? datasets.filter((d) => d.linked_dataset_id === selectedDataset.dataset_id) : [],
    [datasets, selectedDataset]
  );
  const selectedDatasetStatus = selectedDatasetChildren.length > 0
    ? derivedStatus(selectedDatasetChildren)
    : (selectedDataset?.qa_status || "draft");
  const activeDetectionId = isEditingDetails ? editingDetectionId : (selectedDataset?.detection_id || "");
  const selectedDetection = detections.find((d) => d.detection_id === activeDetectionId) || null;
  const segmentOptions = useMemo(() => {
    if (isEditingDetails) return segmentOptionsDraft;
    if (selectedDetection) return Array.isArray(selectedDetection.segment_taxonomy) ? selectedDetection.segment_taxonomy : [];
    const raw = selectedDataset?.segment_taxonomy;
    return Array.isArray(raw) ? raw : [];
  }, [isEditingDetails, segmentOptionsDraft, selectedDetection?.segment_taxonomy, selectedDataset?.segment_taxonomy]);

  useEffect(() => {
    if (!selectedDataset) return;
    setEditingName(selectedDataset.name);
    setEditingDetectionId(selectedDataset.detection_id || "");
    setEditingSplit(selectedDataset.split_type);
    setIsEditingDetails(false);
  }, [selectedDataset]);

  const saveDatasetMeta = async () => {
    if (!selectedDataset) return;
    const imageIdValidation = validateDatasetItemImageIds(datasetItems);
    if (!imageIdValidation.ok) {
      notify({ message: imageIdValidation.error, tone: "error" });
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
          detection_id: editingDetectionId || null,
          split_type: editingSplit,
        }),
      });
      if (!metaRes.ok) {
        const text = await metaRes.text();
        throw new Error(text || "Failed to save dataset metadata");
      }

      const assigningDetection = editingDetectionId && editingDetectionId !== selectedDataset.detection_id;
      if (assigningDetection) {
        const datasetAttrs = Array.isArray(selectedDataset.segment_taxonomy) ? selectedDataset.segment_taxonomy : [];
        const newDetection = detections.find((d) => d.detection_id === editingDetectionId);
        const detectionAttrs = newDetection && Array.isArray(newDetection.segment_taxonomy) ? newDetection.segment_taxonomy : [];

        if (datasetAttrs.length > 0 && detectionAttrs.length > 0) {
          const hasDifference = datasetAttrs.some((a) => !detectionAttrs.includes(a));
          if (hasDifference) {
            const diffAttrs = datasetAttrs.filter((a) => !detectionAttrs.includes(a));
            const mergeChoice = await confirm({
              title: "Attribute Conflict",
              message: (
                <>
                  <p>This dataset has {diffAttrs.length} image attribute(s) that differ from the &ldquo;{newDetection!.display_name}&rdquo; detection&apos;s attributes.</p>
                  <ul className="mt-2 ml-4 list-disc text-[var(--app-text)]">
                    {diffAttrs.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                  <p className="mt-3">Would you like to merge the dataset attribute(s) into the detection attribute list, or replace the dataset attributes with the detection&apos;s attributes?</p>
                  <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2">
                    <span className="font-bold text-yellow-300">Caution:</span>{" "}
                    <span className="italic text-yellow-200/90">Replacing dataset attributes with the detection attributes will clear any attribute tags currently applied to dataset images.</span>
                  </div>
                </>
              ),
              confirmLabel: "Merge Attributes",
              cancelLabel: "Overwrite Dataset Attributes",
              dismissLabel: "Cancel",
              tone: "danger",
            });
            if (mergeChoice === null) {
              // User cancelled — do nothing with attributes
            } else if (mergeChoice && newDetection) {
              const merged = [...new Set([...detectionAttrs, ...datasetAttrs])];
              await fetch("/api/detections", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  detection_id: newDetection.detection_id,
                  display_name: newDetection.display_name,
                  description: newDetection.description,
                  detection_category: newDetection.detection_category,
                  label_policy: newDetection.label_policy,
                  user_prompt_addendum: newDetection.user_prompt_addendum,
                  decision_rubric: Array.isArray(newDetection.decision_rubric) ? newDetection.decision_rubric : [],
                  segment_taxonomy: merged,
                  metric_thresholds: newDetection.metric_thresholds,
                  approved_prompt_version: newDetection.approved_prompt_version,
                }),
              });
              await fetch("/api/datasets", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "update_attributes",
                  dataset_id: selectedDataset.dataset_id,
                  segment_taxonomy: [],
                }),
              });
            } else {
              await fetch("/api/datasets", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "update_attributes",
                  dataset_id: selectedDataset.dataset_id,
                  segment_taxonomy: [],
                }),
              });
            }
          }
        } else if (datasetAttrs.length > 0 && detectionAttrs.length === 0) {
          const migrate = await confirm({
            title: "Migrate Attributes to Detection",
            message: `This dataset has ${datasetAttrs.length} image attribute(s). The assigned detection has none. Would you like to migrate them to the detection?`,
            confirmLabel: "Migrate to Detection",
            cancelLabel: "Discard",
          });
          if (migrate && newDetection) {
            await fetch("/api/detections", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                detection_id: newDetection.detection_id,
                display_name: newDetection.display_name,
                description: newDetection.description,
                detection_category: newDetection.detection_category,
                label_policy: newDetection.label_policy,
                user_prompt_addendum: newDetection.user_prompt_addendum,
                decision_rubric: Array.isArray(newDetection.decision_rubric) ? newDetection.decision_rubric : [],
                segment_taxonomy: datasetAttrs,
                metric_thresholds: newDetection.metric_thresholds,
                approved_prompt_version: newDetection.approved_prompt_version,
              }),
            });
          }
          await fetch("/api/datasets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update_attributes",
              dataset_id: selectedDataset.dataset_id,
              segment_taxonomy: [],
            }),
          });
        }
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
      notify({ message, tone: "error" });
    } finally {
      setIsSavingDetails(false);
    }
  };

  const cancelEditingDetails = async () => {
    if (!selectedDataset) return;
    setEditingName(selectedDataset.name);
    setEditingDetectionId(selectedDataset.detection_id || "");
    setEditingSplit(selectedDataset.split_type);
    if (selectedDatasetId) {
      await loadDatasetItems(selectedDatasetId);
    }
    setIsEditingDetails(false);
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
    setSavingSegments(true);
    try {
      if (selectedDetection) {
        const proceed = await confirm({
          title: "Update Detection Attributes",
          message: `This will update the image attributes for the "${selectedDetection.display_name}" detection. All datasets assigned to this detection will be affected.`,
          confirmLabel: "Update Detection Attributes",
          tone: "warning",
        });
        if (!proceed) { setSavingSegments(false); return; }

        const res = await fetch("/api/detections", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detection_id: selectedDetection.detection_id,
            display_name: selectedDetection.display_name,
            description: selectedDetection.description,
            detection_category: selectedDetection.detection_category,
            label_policy: selectedDetection.label_policy,
            user_prompt_addendum: selectedDetection.user_prompt_addendum,
            decision_rubric: Array.isArray(selectedDetection.decision_rubric) ? selectedDetection.decision_rubric : [],
            segment_taxonomy: segmentOptionsDraft,
            metric_thresholds: selectedDetection.metric_thresholds,
            approved_prompt_version: selectedDetection.approved_prompt_version,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error || "Failed to update detection attributes");
        }
      } else {
        if (!selectedDataset) { setSavingSegments(false); return; }
        const res = await fetch("/api/datasets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_attributes",
            dataset_id: selectedDataset.dataset_id,
            segment_taxonomy: segmentOptionsDraft,
          }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error || "Failed to update dataset attributes");
        }
      }
      triggerRefresh();
      notify({ message: "Image attributes saved.", tone: "success" });
    } catch (error: unknown) {
      notify({ message: error instanceof Error ? error.message : "Failed to update image attributes", tone: "error" });
    } finally {
      setSavingSegments(false);
    }
  };

  const updateItemField = (itemId: string, patch: Partial<DatasetItem>) => {
    setDatasetItems((prev) => prev.map((item) => (item.item_id === itemId ? { ...item, ...patch } : item)));
  };

  const deleteItem = async (item: DatasetItem) => {
    if (!selectedDatasetId) return;
    if (
      !(await confirm({
        title: "Remove Image",
        message: `Remove image "${item.image_id}" from this dataset?`,
        confirmLabel: "Remove",
        tone: "danger",
      }))
    ) {
      return;
    }
    const res = await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_item", item_id: item.item_id }),
    });
    if (!res.ok) {
      const text = await res.text();
      notify({ message: text || "Failed to remove image.", tone: "error" });
      return;
    }
    await loadDatasets();
    await loadDatasetItems(selectedDatasetId);
    triggerRefresh();
  };

  const createItemFlag = async (itemId: string, reason: string) => {
    const item = datasetItems.find((i) => i.item_id === itemId);
    if (!item || !selectedDataset) return;
    const detectionId = selectedDataset.detection_id;
    if (!detectionId) {
      notify({ message: "Dataset must be assigned to a detection before flagging.", tone: "error" });
      return;
    }
    const res = await fetch("/api/review-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_item_id: itemId,
        detection_id: detectionId,
        image_id: item.image_id,
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
          detection_id: detectionId,
          image_id: item.image_id,
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

  const resolveItemFlag = async (flagId: string, action: string, note: string) => {
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
          [flag.dataset_item_id!]: {
            ...flag,
            status: "resolved",
            resolution_action: action as any,
            resolution_note: note || null,
            resolved_at: new Date().toISOString(),
          },
        }));
      }
    }
    setResolveModalFlagId(null);
  };

  const deleteDataset = async () => {
    if (!selectedDataset) return;
    if (
      !(await confirm({
        title: "Delete Dataset",
        message: `Delete dataset "${selectedDataset.name}"? This cannot be undone.`,
        confirmLabel: "Delete Dataset",
        tone: "danger",
      }))
    ) {
      return;
    }
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

  const openAssignModal = async () => {
    if (!selectedDataset) return;
    try {
      const res = await fetch("/api/qa?action=annotators");
      if (res.ok) {
        const data = await res.json();
        setAvailableAnnotators(data.annotators || []);
      }
      const childRes = await fetch(`/api/datasets?children_of=${selectedDataset.dataset_id}`);
      if (childRes.ok) {
        const childData = await childRes.json();
        const assigned = (childData.children || []).map((c: any) => c.assigned_to).filter(Boolean);
        setAlreadyAssignedAnnotators(assigned);
      } else {
        setAlreadyAssignedAnnotators([]);
      }
    } catch {
      setAvailableAnnotators([]);
      setAlreadyAssignedAnnotators([]);
    }
    setAssignAnnotators([]);
    setAssignResetLabels(true);
    setAssignResetSegments(true);
    setShowAssignModal(true);
  };

  const submitAssignAnnotators = async () => {
    if (!selectedDataset || assignAnnotators.length === 0) return;
    setAssigning(true);
    try {
      const res = await fetch("/api/datasets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_annotators",
          parent_dataset_id: selectedDataset.dataset_id,
          annotators: assignAnnotators,
          reset_labels: assignResetLabels,
          reset_segments: assignResetSegments,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to assign annotators");
      }
      notify({ message: `Created ${assignAnnotators.length} annotation dataset(s)`, tone: "success" });
      setShowAssignModal(false);
      await loadDatasets();
      triggerRefresh();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Assignment failed";
      notify({ message: msg, tone: "error" });
    } finally {
      setAssigning(false);
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

  const exportSelectedDatasetJson = () => {
    if (!selectedDataset) return;
    const payload = {
      dataset: selectedDataset,
      items: sortedDatasetItems.map((item) => ({
        image_id: item.image_id,
        image_uri: item.image_uri,
        image_description: item.image_description || "",
        ground_truth_label: item.ground_truth_label || null,
        segment_tags: normalizeSegmentTags(item.segment_tags),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeImageId(selectedDataset.name || "dataset")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSelectedDatasetCsv = () => {
    if (!selectedDataset) return;
    const headers = ["imageId", "imageUrl", "groundTruthLabel", "attributes", "imageDescription"];
    const rows = sortedDatasetItems.map((item) => [
      item.image_id || "",
      item.image_uri || "",
      item.ground_truth_label || "",
      JSON.stringify(normalizeSegmentTags(item.segment_tags).filter((t) => t !== "Baseline")),
      item.image_description || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => csvEscape(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeImageId(selectedDataset.name || "dataset")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const autoSplitMasterDataset = async () => {
    if (!selectedDataset || selectedDataset.split_type !== "MASTER") return;

    const imageIdValidation = validateDatasetItemImageIds(datasetItems);
    if (!imageIdValidation.ok) {
      notify({ message: imageIdValidation.error, tone: "error" });
      return;
    }
    if (datasetItems.length === 0) {
      notify({ message: "MASTER dataset must contain images before it can be split.", tone: "error" });
      return;
    }

    const unlabeled = datasetItems.find((item) => !item.ground_truth_label);
    if (unlabeled) {
      notify({
        message: `Every MASTER item needs a ground-truth label before auto-splitting. Missing label on ${unlabeled.image_id}.`,
        tone: "error",
      });
      return;
    }

    const baseName = deriveMasterSplitBaseName(selectedDataset.name);
    const derivedNames = [`${baseName} (TRAIN)`, `${baseName} (TEST)`, `${baseName} (EVALUATE)`];
    const duplicateNames = derivedNames.filter((name) =>
      datasets.some((dataset) => dataset.dataset_id !== selectedDataset.dataset_id && dataset.name === name)
    );

    const confirmed = await confirm({
      title: "Auto-Split MASTER Dataset",
      message:
        duplicateNames.length > 0
          ? `This will keep "${selectedDataset.name}" as MASTER and create TRAIN, TEST, and EVALUATE datasets. Matching dataset names already exist: ${duplicateNames.join(", ")}. Continue anyway?`
          : `This will keep "${selectedDataset.name}" as MASTER and create TRAIN, TEST, and EVALUATE datasets from its current labels and image attributes.`,
      confirmLabel: "Create Split Datasets",
    });
    if (!confirmed) return;

    setAutoSplittingMaster(true);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_split_datasets",
          name_prefix: baseName,
          detection_id: selectedDataset.detection_id,
          items: datasetItems.map((item) => ({
            image_id: item.image_id.trim(),
            image_uri: item.image_uri,
            image_description: item.image_description || "",
            ground_truth_label: item.ground_truth_label,
            segment_tags: normalizeSegmentTags(item.segment_tags),
          })),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to auto-split MASTER dataset");
      }

      await loadDatasets();
      await loadDatasetItems(selectedDataset.dataset_id);
      triggerRefresh();

      const created = Array.isArray(payload?.created) ? payload.created : [];
      const summary = created
        .map((row: any) => `${splitTypeLabel(String(row?.split_type || ""))}=${Number(row?.size || 0)}`)
        .join(", ");
      notify({
        message: summary
          ? `Created split datasets from MASTER: ${summary}.`
          : "Created split datasets from MASTER.",
        tone: "success",
      });
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "Failed to auto-split MASTER dataset",
        tone: "error",
      });
    } finally {
      setAutoSplittingMaster(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">Saved Datasets</h2>
          <p className="app-page-copy">
            Review uploaded datasets, manage detection assignment, edit image-level labels and
            attributes, and export dataset contents for downstream analysis.
          </p>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="app-btn app-btn-primary app-btn-lg"
        >
          {showUpload ? "Cancel" : "Create Dataset"}
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

      <div className="flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-1">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setStatusFilter(tab.id); setDatasetPage(1); }}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                statusFilter === tab.id
                  ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)] ring-1 ring-[rgba(182,223,255,0.22)]"
                  : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto mr-1">
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-field-bg)] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-[var(--app-text-subtle)]" />
            <input
              type="text"
              placeholder="Search datasets..."
              className="bg-transparent text-sm text-[var(--app-text)] placeholder:text-[var(--app-text-subtle)] outline-none w-44"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setDatasetPage(1); }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setDatasetPage(1); }} className="text-[var(--app-text-subtle)] hover:text-[var(--app-text)]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searchFocused && searchQuery.trim().length > 0 && (() => {
            const q = searchQuery.trim().toLowerCase();
            const suggestions: { label: string; type: "dataset" | "detection" }[] = [];
            const seen = new Set<string>();
            for (const g of displayGroups) {
              const name = g.parent.name || "";
              if (name.toLowerCase().includes(q) && !seen.has(name)) {
                seen.add(name);
                suggestions.push({ label: name, type: "dataset" });
              }
            }
            for (const [, dName] of detectionNameById) {
              if (dName.toLowerCase().includes(q) && !seen.has(dName)) {
                seen.add(dName);
                suggestions.push({ label: dName, type: "detection" });
              }
            }
            if (suggestions.length === 0) return null;
            return (
              <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-48 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-strong)] shadow-lg">
                {suggestions.slice(0, 8).map((s) => (
                  <button
                    key={`${s.type}-${s.label}`}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-[var(--app-table-row-hover)] transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); setSearchQuery(s.label); setDatasetPage(1); }}
                  >
                    <span className="text-[10px] uppercase text-[var(--app-text-subtle)] w-14">{s.type === "dataset" ? "Name" : "Detection"}</span>
                    <span className="text-[var(--app-text)] truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="app-card overflow-hidden">
        <div>
          <table className="app-table app-table-fixed">
            <colgroup>
              <col style={{ width: "30%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)]" onClick={() => { if (datasetSortKey === "name") setDatasetSortDir(d => d === "asc" ? "desc" : "asc"); else { setDatasetSortKey("name"); setDatasetSortDir("asc"); } setDatasetPage(1); }}>
                  Dataset {datasetSortKey === "name" && (datasetSortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)]" onClick={() => { if (datasetSortKey === "detection") setDatasetSortDir(d => d === "asc" ? "desc" : "asc"); else { setDatasetSortKey("detection"); setDatasetSortDir("asc"); } setDatasetPage(1); }}>
                  Detection {datasetSortKey === "detection" && (datasetSortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)]" onClick={() => { if (datasetSortKey === "split") setDatasetSortDir(d => d === "asc" ? "desc" : "asc"); else { setDatasetSortKey("split"); setDatasetSortDir("asc"); } setDatasetPage(1); }}>
                  Split {datasetSortKey === "split" && (datasetSortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="app-table-col-center">Size</th>
                <th className="app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)]" onClick={() => { if (datasetSortKey === "status") setDatasetSortDir(d => d === "asc" ? "desc" : "asc"); else { setDatasetSortKey("status"); setDatasetSortDir("asc"); } setDatasetPage(1); }}>
                  Status {datasetSortKey === "status" && (datasetSortDir === "asc" ? "↑" : "↓")}
                </th>
                <th className="app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)]" onClick={() => { if (datasetSortKey === "updated") setDatasetSortDir(d => d === "asc" ? "desc" : "asc"); else { setDatasetSortKey("updated"); setDatasetSortDir("desc"); } setDatasetPage(1); }}>
                  Updated {datasetSortKey === "updated" && (datasetSortDir === "asc" ? "↑" : "↓")}
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedGroups.map((group) => {
                const { parent: d, children } = group;
                const hasChildren = children.length > 0;
                const isExpanded = expandedParents.has(d.dataset_id);
                const parentStatus = hasChildren ? derivedStatus(children) : (d.qa_status || "draft");

                return (
                  <React.Fragment key={d.dataset_id}>
                    <tr
                      className={`cursor-pointer border-t border-white/5 ${
                        selectedDatasetId === d.dataset_id
                          ? "bg-[rgba(118,190,255,0.10)] shadow-[inset_2px_0_0_var(--app-accent)]"
                          : "hover:bg-[rgba(92,184,255,0.04)]"
                      }`}
                      onClick={() => setSelectedDatasetId(d.dataset_id)}
                    >
                      <td className="text-[var(--app-text)]">
                        <div className="flex items-center gap-2">
                          {hasChildren && (
                            <button
                              className="p-0.5 rounded hover:bg-white/5"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedParents((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(d.dataset_id)) next.delete(d.dataset_id);
                                  else next.add(d.dataset_id);
                                  return next;
                                });
                              }}
                            >
                              {isExpanded ? <ChevronDown className="h-3 w-3 text-[var(--app-text-subtle)]" /> : <ChevronRight className="h-3 w-3 text-[var(--app-text-subtle)]" />}
                            </button>
                          )}
                          {hasChildren && <Link2 className="h-3 w-3 text-[var(--app-text-subtle)] shrink-0" />}
                          <span className="truncate">{d.name}</span>
                        </div>
                      </td>
                      <td className="app-table-muted">{detectionNameById.get(String(d.detection_id || "")) || "—"}</td>
                      <td>
                        <div className="app-table-left-slot">
                          <span className={splitTypeBadgeClass(d.split_type)}>{splitTypeLabel(d.split_type)}</span>
                        </div>
                      </td>
                      <td className="app-table-col-center text-[var(--app-text)]">{d.size}</td>
                      <td><span className={`app-badge ${(STATUS_DISPLAY[parentStatus] || STATUS_DISPLAY.draft).color}`}>{(STATUS_DISPLAY[parentStatus] || STATUS_DISPLAY.draft).label}</span></td>
                      <td className="app-table-subtle">{new Date(d.updated_at).toLocaleDateString()}</td>
                    </tr>
                    {hasChildren && isExpanded && children.map((child) => (
                      <tr
                        key={child.dataset_id}
                        className={`cursor-pointer border-t border-white/5 ${
                          selectedDatasetId === child.dataset_id
                            ? "bg-[rgba(118,190,255,0.10)] shadow-[inset_2px_0_0_var(--app-accent)]"
                            : "hover:bg-[rgba(92,184,255,0.04)]"
                        }`}
                        onClick={() => setSelectedDatasetId(child.dataset_id)}
                      >
                        <td className="text-[var(--app-text)]">
                          <div className="flex items-center gap-2 pl-8">
                            <span className="text-[var(--app-text-subtle)] text-[10px]">↳</span>
                            <span className="truncate text-[var(--app-text-muted)]">{child.name}</span>
                          </div>
                        </td>
                        <td className="app-table-muted">{detectionNameById.get(String(child.detection_id || "")) || "—"}</td>
                        <td>
                          <div className="app-table-left-slot">
                            <span className={splitTypeBadgeClass(child.split_type)}>{splitTypeLabel(child.split_type)}</span>
                          </div>
                        </td>
                        <td className="app-table-col-center text-[var(--app-text)]">{child.size}</td>
                        <td><span className={`app-badge ${(STATUS_DISPLAY[child.qa_status || "draft"] || STATUS_DISPLAY.draft).color}`}>{(STATUS_DISPLAY[child.qa_status || "draft"] || STATUS_DISPLAY.draft).label}</span></td>
                        <td className="app-table-subtle">{new Date(child.updated_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {filteredDatasets.length === 0 && (
                <tr>
                  <td colSpan={6} className="app-table-subtle px-3 py-6 text-center">
                    No datasets in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalGroups > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--app-border)] px-4 py-2">
            <select
              className="app-select py-0.5 text-[10px]"
              style={{ width: "70px" }}
              value={datasetPageSize}
              onChange={(e) => { setDatasetPageSize(parseInt(e.target.value)); setDatasetPage(1); }}
            >
              <option value="5">5 / page</option>
              <option value="10">10 / page</option>
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
            </select>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDatasetPage((p) => Math.max(1, p - 1))}
                  disabled={datasetPage <= 1}
                  className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                >Prev</button>
                <span className="text-[11px] text-[var(--app-text-muted)] px-2 tabular-nums">{datasetPage} / {totalPages}</span>
                <button
                  onClick={() => setDatasetPage((p) => Math.min(totalPages, p + 1))}
                  disabled={datasetPage >= totalPages}
                  className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                >Next</button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedDataset && (
        <div className="app-card-strong p-5 space-y-5">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div className="space-y-1">
              <div className="app-kicker">Dataset Details</div>
              <h3 className="text-lg font-semibold text-gray-100">{selectedDataset.name}</h3>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="app-btn app-btn-subtle app-btn-md flex items-center gap-1.5"
              >
                Actions
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showActionsMenu && (
                <>
                  <button className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-lg py-1">
                    {selectedDataset.split_type === "MASTER" && !isEditingDetails && (
                      <button
                        onClick={() => { setShowActionsMenu(false); void autoSplitMasterDataset(); }}
                        disabled={autoSplittingMaster || datasetItems.length === 0}
                        className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                      >
                        {autoSplittingMaster ? "Auto-Splitting..." : "Auto-Split MASTER"}
                      </button>
                    )}
                    <button
                      onClick={() => { setShowActionsMenu(false); if (isEditingDetails) { saveDatasetMeta(); } else { setIsEditingDetails(true); setSegmentOptionsDraft(selectedDetection ? (Array.isArray(selectedDetection.segment_taxonomy) ? selectedDetection.segment_taxonomy : []) : (Array.isArray(selectedDataset?.segment_taxonomy) ? selectedDataset.segment_taxonomy : [])); } }}
                      disabled={isSavingDetails}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                    >
                      {isSavingDetails ? "Saving..." : isEditingDetails ? "Save Changes" : "Edit Details"}
                    </button>
                    {isEditingDetails && (
                      <button
                        onClick={() => { setShowActionsMenu(false); void cancelEditingDetails(); }}
                        disabled={isSavingDetails}
                        className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                      >
                        Cancel Edit
                      </button>
                    )}
                    <button
                      onClick={() => { setShowActionsMenu(false); exportSelectedDatasetCsv(); }}
                      disabled={datasetItems.length === 0}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={() => { setShowActionsMenu(false); exportSelectedDatasetJson(); }}
                      disabled={datasetItems.length === 0}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick={() => { setShowActionsMenu(false); openAssignModal(); }}
                      disabled={datasetItems.length === 0}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--app-text)] hover:bg-[var(--app-table-row-hover)] disabled:opacity-40"
                    >
                      Assign Annotators
                    </button>
                    <div className="border-t border-[var(--app-border)] my-1" />
                    <button
                      onClick={() => { setShowActionsMenu(false); deleteDataset(); }}
                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[var(--app-table-row-hover)]"
                    >
                      Delete Dataset
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {isEditingDetails ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div>
                <label className="app-label block mb-1">Dataset Name</label>
                <input
                  className="app-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
              </div>
              <div>
                <label className="app-label block mb-1">Detection</label>
                <select
                  className="app-select"
                  value={editingDetectionId}
                  onChange={(e) => setEditingDetectionId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {detections.map((d) => (
                    <option key={d.detection_id} value={d.detection_id}>
                      {d.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="app-label block mb-1">Split Type</label>
                <select
                  className="app-select"
                  value={editingSplit}
                  onChange={(e) => setEditingSplit(e.target.value as SplitType)}
                >
                  <option value="MASTER">MASTER</option>
                  <option value="GOLDEN">TEST</option>
                  <option value="ITERATION">TRAIN</option>
                  <option value="HELD_OUT_EVAL">EVALUATE</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 items-end gap-6">
              <div>
                <div className="app-label mb-1">Detection</div>
                <div className="text-sm text-gray-300">{detectionNameById.get(editingDetectionId) || "Unassigned"}</div>
              </div>
              <div>
                <div className="app-label mb-1">Split Type</div>
                <div className="text-sm text-gray-300">{splitTypeLabel(editingSplit)}</div>
              </div>
              <div>
                <div className="app-label mb-1">Status</div>
                <div><span className={`app-badge ${(STATUS_DISPLAY[selectedDatasetStatus] || STATUS_DISPLAY.draft).color}`}>{(STATUS_DISPLAY[selectedDatasetStatus] || STATUS_DISPLAY.draft).label}</span></div>
              </div>
              <div>
                <div className="app-label mb-1">Labeled</div>
                <div className="text-sm text-gray-300">{datasetItems.filter((i) => i.ground_truth_label != null).length}/{datasetItems.length} ({datasetItems.length > 0 ? Math.round((datasetItems.filter((i) => i.ground_truth_label != null).length / datasetItems.length) * 100) : 0}%)</div>
              </div>
            </div>
          )}

          {isEditingDetails && (
            <div className="space-y-3 border-t border-white/8 pt-4">
              <div className="flex items-center justify-between">
                <div className="app-label">Image Attributes</div>
                <div className="text-[11px] text-gray-500">{segmentOptionsDraft.length} total</div>
              </div>
              <div className="min-h-8 px-0 py-1">
                <div className="flex flex-wrap gap-1.5">
                  {segmentOptionsDraft.map((segment) => (
                    <span key={segment} className="inline-flex items-center gap-1 rounded-lg bg-white/6 px-2 py-0.5 text-xs text-gray-200">
                      {segment}
                      <button type="button" className="text-gray-400 hover:text-red-300" onClick={() => removeSegmentOption(segment)}>
                        &times;
                      </button>
                    </span>
                  ))}
                  {segmentOptionsDraft.length === 0 && <span className="text-xs text-gray-500">No image attributes yet.</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="app-input min-w-0 flex-1 px-3 py-1.5 text-sm"
                  placeholder="Add image attribute"
                  value={newSegmentOption}
                  onChange={(e) => setNewSegmentOption(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSegmentOption(); } }}
                />
                <button type="button" onClick={addSegmentOption} className="app-btn app-btn-secondary app-btn-sm">
                  Add
                </button>
                <button
                  type="button"
                  onClick={saveSegmentOptions}
                  disabled={savingSegments}
                  className="app-btn app-btn-secondary app-btn-sm disabled:opacity-50"
                >
                  {savingSegments ? "Saving..." : "Save Attributes"}
                </button>
              </div>
            </div>
          )}

          {!isEditingDetails && segmentOptions.length > 0 && (
            <div className="space-y-2 border-t border-white/8 pt-4">
              <div className="app-label">Image Attributes</div>
              <div className="flex flex-wrap gap-1.5">
                {segmentOptions.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-lg bg-white/6 text-xs text-gray-200">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Status action buttons */}
          <DatasetStatusBar
            dataset={selectedDataset}
            itemsTotal={datasetItems.length}
            itemsLabeled={datasetItems.filter((i) => i.ground_truth_label != null).length}
            onSubmit={async () => {
              try {
                const res = await fetch("/api/qa", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "submit", dataset_id: selectedDataset.dataset_id }),
                });
                if (!res.ok) {
                  const data = await res.json();
                  notify({ message: data.error || "Failed to submit", tone: "error" });
                  return;
                }
                notify({ message: "Dataset submitted for QA review", tone: "success" });
                await loadDatasets();
              } catch {
                notify({ message: "Failed to submit dataset", tone: "error" });
              }
            }}
            onStatusChange={async (newStatus: string, revisionNote?: string) => {
              try {
                const res = await fetch("/api/qa", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "update_status",
                    dataset_id: selectedDataset.dataset_id,
                    new_status: newStatus,
                    revision_note: revisionNote,
                  }),
                });
                if (!res.ok) {
                  const data = await res.json();
                  notify({ message: data.error || "Failed to update status", tone: "error" });
                  return;
                }
                notify({ message: `Status updated to ${newStatus.replace(/_/g, " ")}`, tone: "success" });
                await loadDatasets();
              } catch {
                notify({ message: "Failed to update status", tone: "error" });
              }
            }}
          />

          <div>
            <h4 className="app-label mb-2">Preview ({datasetItems.length} images)</h4>
            <div className="app-table-wrap max-h-[360px] overflow-auto">
              <table className="app-table app-table-fixed text-xs">
                <colgroup>
                  <col style={{ width: "11rem" }} />
                  <col style={{ width: "12rem" }} />
                  <col />
                  <col style={{ width: "10rem" }} />
                  <col style={{ width: "16rem" }} />
                  {isEditingDetails && <col style={{ width: "5rem" }} />}
                </colgroup>
                <thead className="sticky top-0">
                  <tr>
                    <th className="app-table-col-label">Preview</th>
                    <th className="app-table-col-label">
                      <button type="button" onClick={() => toggleItemSort("image_id")} className="hover:text-gray-300">
                        Image ID {itemSortBy === "image_id" ? (itemSortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="app-table-col-label">Image Description</th>
                    <th className="app-table-col-center">
                      <button
                        type="button"
                        onClick={() => toggleItemSort("ground_truth_label")}
                        className="hover:text-gray-300"
                      >
                        Ground Truth Label {itemSortBy === "ground_truth_label" ? (itemSortDir === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="app-table-col-label">Attributes</th>
                    {isEditingDetails && <th className="app-table-col-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedDatasetItems.map((item, index) => (
                    <tr key={item.item_id}>
                      <td className="w-44">
                        <img
                          src={item.image_uri}
                          alt={item.image_id}
                          className="block h-24 w-36 min-w-36 max-w-36 object-cover rounded border border-gray-700 cursor-pointer"
                          onClick={() => setSelectedPreviewIndex(index)}
                        />
                      </td>
                      <td>
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
                      <td>
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
                      <td className="app-table-col-center">
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
                          <div className="app-table-center-slot py-1 text-xs">
                            <GroundTruthBadge value={item.ground_truth_label || null} />
                          </div>
                        )}
                      </td>
                      <td className="min-w-[260px]">
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
                        <td className="app-table-col-right">
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
          selectedPreviewIndex != null && sortedDatasetItems[selectedPreviewIndex] ? (() => {
            const currentItem = sortedDatasetItems[selectedPreviewIndex];
            return (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Image ID</label>
                {isEditingDetails ? (
                  <input
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono text-gray-300"
                    value={currentItem.image_id}
                    onChange={(e) =>
                      updateItemField(currentItem.item_id, {
                        image_id: sanitizeImageId(e.target.value),
                      })
                    }
                  />
                ) : (
                  <div className="w-full px-0 py-1.5 text-xs font-mono text-gray-300">
                    {currentItem.image_id}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Image Description</label>
                {isEditingDetails ? (
                  <textarea
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 h-28"
                    value={currentItem.image_description || ""}
                    onChange={(e) =>
                      updateItemField(currentItem.item_id, {
                        image_description: e.target.value,
                      })
                    }
                  />
                ) : (
                  <div className="w-full min-h-28 px-0 py-1.5 text-xs text-gray-300 whitespace-pre-wrap">
                    {currentItem.image_description || "No description."}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ground Truth</label>
                {isEditingDetails ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateItemField(currentItem.item_id, { ground_truth_label: "DETECTED" })}
                      className={`px-3 py-1.5 rounded text-xs border ${
                        currentItem.ground_truth_label === "DETECTED"
                          ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)] border-[color:color-mix(in_srgb,var(--app-purple)_36%,transparent)]"
                          : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                      }`}
                    >
                      DETECTED
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItemField(currentItem.item_id, { ground_truth_label: "NOT_DETECTED" })}
                      className={`px-3 py-1.5 rounded text-xs border ${
                        currentItem.ground_truth_label === "NOT_DETECTED"
                          ? "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)] border-[color:color-mix(in_srgb,var(--app-not-detected)_36%,transparent)]"
                          : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                      }`}
                    >
                      NOT_DETECTED
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItemField(currentItem.item_id, { ground_truth_label: null })}
                      className={`px-3 py-1.5 rounded text-xs border ${
                        !currentItem.ground_truth_label
                          ? "bg-gray-800 text-gray-100 border-gray-500"
                          : "bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800"
                      }`}
                    >
                      UNSET
                    </button>
                  </div>
                ) : (
                  <div className="w-full px-0 py-1.5 text-xs text-gray-300">
                    <GroundTruthBadge value={currentItem.ground_truth_label || null} />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Attributes</label>
                {isEditingDetails ? (
                  <SegmentTagsEditor
                    value={normalizeSegmentTags(currentItem.segment_tags)}
                    options={segmentOptions}
                    onChange={(next) =>
                      updateItemField(currentItem.item_id, { segment_tags: next } as Partial<DatasetItem>)
                    }
                  />
                ) : (
                  <SegmentTagList value={normalizeSegmentTags(currentItem.segment_tags)} />
                )}
              </div>
            </div>
            );
          })() : null
        }
      />

      {flagModalItemId && (
        <SavedDatasetFlagModal
          onSubmit={(reason) => createItemFlag(flagModalItemId, reason)}
          onCancel={() => setFlagModalItemId(null)}
        />
      )}

      {resolveModalFlagId && (
        <SavedDatasetResolveModal
          flag={Object.values(flagsByItemId).find((f) => f.flag_id === resolveModalFlagId)!}
          onSubmit={(action, note) => resolveItemFlag(resolveModalFlagId, action, note)}
          onCancel={() => setResolveModalFlagId(null)}
        />
      )}

      {showAssignModal && selectedDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-card-strong p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-gray-100">Assign Annotators</h3>
            <p className="text-sm text-gray-400">
              Create annotation copies of &ldquo;{selectedDataset.name}&rdquo; for selected annotators.
            </p>
            <div>
              <label className="app-label block mb-2">Select annotators</label>
              <div className="max-h-48 overflow-y-auto space-y-1.5 border border-[var(--app-border)] rounded-md p-2">
                {availableAnnotators.length === 0 && (
                  <p className="text-xs text-[var(--app-text-muted)] py-2 text-center">No registered annotators found.</p>
                )}
                {availableAnnotators.map((name) => {
                  const isAlready = alreadyAssignedAnnotators.includes(name);
                  return (
                    <label key={name} className={`flex items-center gap-2 text-sm cursor-pointer px-2 py-1 rounded hover:bg-white/5 ${isAlready ? "opacity-40 pointer-events-none" : "text-gray-300"}`}>
                      <input
                        type="checkbox"
                        disabled={isAlready}
                        checked={assignAnnotators.includes(name)}
                        onChange={(e) => {
                          if (e.target.checked) setAssignAnnotators((prev) => [...prev, name]);
                          else setAssignAnnotators((prev) => prev.filter((n) => n !== name));
                        }}
                        className="rounded border-gray-600"
                      />
                      {name}
                      {isAlready && <span className="text-[10px] text-[var(--app-text-subtle)]">(already assigned)</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={assignResetLabels}
                onChange={(e) => setAssignResetLabels(e.target.checked)}
                className="rounded border-gray-600"
              />
              Reset ground truth labels
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={assignResetSegments}
                onChange={(e) => setAssignResetSegments(e.target.checked)}
                className="rounded border-gray-600"
              />
              Reset segment attributes
            </label>
            <div className="flex gap-2 pt-2">
              <button
                onClick={submitAssignAnnotators}
                disabled={assigning || assignAnnotators.length === 0}
                className="app-btn app-btn-primary app-btn-md flex-1 disabled:opacity-50"
              >
                {assigning ? "Creating..." : `Create ${assignAnnotators.length} Assignment${assignAnnotators.length !== 1 ? "s" : ""}`}
              </button>
              <button
                onClick={() => setShowAssignModal(false)}
                disabled={assigning}
                className="app-btn app-btn-subtle app-btn-md"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedDatasetFlagModal({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="app-card-strong w-full max-w-md p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--app-text)]">Flag for Secondary Review</h3>
        <p className="text-xs text-[var(--app-text-muted)]">What is your question or concern about this image?</p>
        <textarea
          className="app-input w-full px-3 py-2 text-sm h-24"
          placeholder="Describe the issue or question..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="app-btn app-btn-subtle app-btn-sm text-xs">Cancel</button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={!reason.trim()}
            className="app-btn app-btn-primary app-btn-sm text-xs"
          >
            Submit Flag
          </button>
        </div>
      </div>
    </div>
  );
}

function SavedDatasetResolveModal({
  flag,
  onSubmit,
  onCancel,
}: {
  flag: import("@/types").ReviewFlag;
  onSubmit: (action: string, note: string) => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState("label_confirmed");
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="app-card-strong w-full max-w-md p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--app-text)]">Resolve Flag</h3>
        <div className="rounded border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-3">
          <p className="text-xs text-[var(--app-text-muted)]">{flag.reason}</p>
        </div>
        <div>
          <label className="app-label mb-1 block text-xs">Resolution Action</label>
          <select className="app-select w-full px-2 py-1.5 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="label_confirmed">Label Confirmed</option>
            <option value="label_corrected">Label Corrected</option>
            <option value="attributes_corrected">Attributes Corrected</option>
            <option value="image_removed">Image Removed</option>
            <option value="needs_discussion">Needs Discussion</option>
          </select>
        </div>
        <div>
          <label className="app-label mb-1 block text-xs">Note (optional)</label>
          <textarea
            className="app-input w-full px-3 py-2 text-sm h-20"
            placeholder="Resolution note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="app-btn app-btn-subtle app-btn-sm text-xs">Cancel</button>
          <button onClick={() => onSubmit(action, note)} className="app-btn app-btn-primary app-btn-sm text-xs">
            Resolve
          </button>
        </div>
      </div>
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
  type UploadDatasetSplitType = "" | SplitType | "AUTO_SPLIT";
  const [detectionId, setDetectionId] = useState<string>("");
  const [name, setName] = useState("");
  const [splitType, setSplitType] = useState<UploadDatasetSplitType>("MASTER");
  const [mode, setMode] = useState<"csv" | "files">("files");
  const [csvRows, setCsvRows] = useState<
    Array<{
      image_id: string;
      image_url: string;
      ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
      segment_tags?: string[] | string;
    }>
  >([]);
  const [csvFileName, setCsvFileName] = useState("");
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
            setError("Each image needs an imageId");
            return;
          }
          if (imageIds.has(imageId)) {
            setError(`Duplicate imageId: ${imageId}`);
            return;
          }
          imageIds.add(imageId);
        }

        if (splitType === "AUTO_SPLIT") {
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
            if (detectionId) formData.append("detection_id", detectionId);
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
          if (!splitType) {
            setError("Choose MASTER, TRAIN, TEST, EVALUATE, or CUSTOM split.");
            return;
          }
          const formData = new FormData();
          formData.append("name", name.trim());
          if (detectionId) formData.append("detection_id", detectionId);
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
          const res = await fetch("/api/datasets", { method: "POST", body: formData });
          const payload = await res.json().catch(() => null);
          if (!res.ok) throw new Error(payload?.error || "Failed to create dataset");
        }
      } else if (mode === "csv") {
        const items = csvRows.map((row) => ({
          image_id: row.image_id,
          image_uri: row.image_url,
          ground_truth_label: row.ground_truth_label,
          segment_tags: normalizeSegmentTags(row.segment_tags),
        }));
        if (splitType === "AUTO_SPLIT") {
          if (items.some((item) => !item.ground_truth_label)) {
            setError("Auto-split requires all ground truth labels to be set.");
            return;
          }
          const res = await fetch("/api/datasets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_split_datasets",
              name_prefix: name.trim(),
              detection_id: detectionId || null,
              items,
            }),
          });
          const payload = await res.json().catch(() => null);
          if (!res.ok) throw new Error(payload?.error || "Failed to create split datasets");
        } else {
          if (!splitType) {
            setError("Choose MASTER, TRAIN, TEST, EVALUATE, or CUSTOM split.");
            return;
          }
          const res = await fetch("/api/datasets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              detection_id: detectionId || null,
              split_type: splitType,
              items,
            }),
          });
          const payload = await res.json().catch(() => null);
          if (!res.ok) throw new Error(payload?.error || "Failed to create dataset");
        }
      }
      onUploaded();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
      <div className="app-section space-y-4">
      <h3 className="text-sm font-medium text-gray-200">Upload New Dataset</h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
          <input
            className="app-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Detection</label>
          <select
            className="app-select"
            value={detectionId}
            onChange={(e) => setDetectionId(e.target.value)}
          >
            <option value="">Unassigned (no detection yet)</option>
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
            className="app-select"
            value={splitType}
            onChange={(e) => setSplitType(e.target.value as UploadDatasetSplitType)}
          >
            <option value="">Select split type</option>
            <option value="MASTER">MASTER</option>
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
          className={`app-btn app-btn-sm ${mode === "files" ? "app-btn-primary" : "app-btn-secondary"}`}
        >
          Upload Image Files
        </button>
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={`app-btn app-btn-sm ${mode === "csv" ? "app-btn-primary" : "app-btn-secondary"}`}
        >
          CSV Manifest
        </button>
      </div>

      {mode === "csv" ? (
        <div className="space-y-2">
          <input
            id="saved-datasets-csv-input"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              const input = e.target;
              if (!file) return;
              try {
                const parsed = await parseCsvManifest(file);
                setCsvRows(parsed);
                setCsvFileName(file.name);
                setError("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to parse CSV file.");
                setCsvRows([]);
                setCsvFileName("");
              }
              input.value = "";
            }}
            className="hidden"
          />
          <label
            htmlFor="saved-datasets-csv-input"
            className="inline-block px-3 py-2 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 cursor-pointer hover:bg-gray-800"
          >
            Choose CSV
          </label>
          {csvFileName && (
            <span className="ml-3 text-xs text-gray-400">1 file selected</span>
          )}
          <p className="text-[11px] text-gray-500">
            Columns: imageId, imageUrl, groundTruthLabel, attributes.{" "}
            <a href="/dataset-manifest-example.csv" download className="text-sky-400 hover:underline">Download template</a>
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
          {fileRows.length > 0 && (
            <span className="ml-3 text-xs text-gray-400">{fileRows.length} file{fileRows.length !== 1 ? "s" : ""} selected</span>
          )}
          {fileRows.length > 0 && (
            <div className="app-table-wrap max-h-72 overflow-y-auto">
              <table className="app-table app-table-fixed text-xs">
                <colgroup>
                  <col style={{ width: "8rem" }} />
                  <col />
                  <col style={{ width: "9rem" }} />
                  <col style={{ width: "14rem" }} />
                  <col style={{ width: "5.5rem" }} />
                </colgroup>
                <thead className="sticky top-0">
                  <tr>
                    <th className="app-table-col-label">Preview</th>
                    <th className="app-table-col-label">imageId</th>
                    <th className="app-table-col-center">Label</th>
                    <th className="app-table-col-label">Attributes</th>
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
                          className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer"
                          onClick={() => setExpandedIndex(fileRows.findIndex((f) => f.id === row.id))}
                        />
                      </td>
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
                      <td className="min-w-[220px]">
                        <SegmentTagsEditor
                          value={normalizeSegmentTags(row.segment_tags)}
                          options={segmentOptions}
                          onChange={(next) =>
                            setFileRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, segment_tags: next } : r)))
                          }
                        />
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

      {mode === "csv" && csvRows.length > 0 && (
        <div className="app-table-wrap max-h-72 overflow-auto">
          <table className="app-table app-table-fixed text-xs">
            <colgroup>
              <col style={{ width: "12rem" }} />
              <col />
              <col style={{ width: "9rem" }} />
              <col style={{ width: "14rem" }} />
            </colgroup>
            <thead className="sticky top-0">
              <tr>
                <th className="app-table-col-label">Image ID</th>
                <th className="app-table-col-label">Image URL</th>
                <th className="app-table-col-center">Ground Truth</th>
                <th className="app-table-col-label">Attributes</th>
              </tr>
            </thead>
            <tbody>
              {csvRows.map((row, idx) => (
                <tr key={`${row.image_id}_${idx}`} className="align-top">
                  <td className="font-mono text-gray-300">{row.image_id}</td>
                  <td className="text-gray-400 max-w-[320px] truncate" title={row.image_url}>
                    {row.image_url}
                  </td>
                  <td className="app-table-col-center">
                    <select
                      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
                      value={row.ground_truth_label || ""}
                      onChange={(e) => {
                        const nextLabel = (e.target.value || null) as "DETECTED" | "NOT_DETECTED" | null;
                        setCsvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, ground_truth_label: nextLabel } : r))
                        );
                      }}
                    >
                      <option value="">UNSET</option>
                      <option value="DETECTED">DETECTED</option>
                      <option value="NOT_DETECTED">NOT_DETECTED</option>
                    </select>
                  </td>
                  <td className="min-w-[220px]">
                    <SegmentTagsEditor
                      value={normalizeSegmentTags(row.segment_tags)}
                      options={segmentOptions}
                      onChange={(next) => {
                        setCsvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, segment_tags: next } : r)));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2">
          <span className="font-semibold text-red-300 text-xs">Upload rejected:</span>{" "}
          <span className="text-xs text-red-200/90">{error}</span>
        </div>
      )}

      {splitType === "MASTER" && (
        <p className="text-xs text-gray-400">
          MASTER is the curated source dataset for labeling and image attributes. After it is fully labeled, use Auto-Split in Saved Datasets to create TRAIN, TEST, and EVALUATE datasets while keeping MASTER unchanged.
        </p>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="app-btn app-btn-primary disabled:opacity-50"
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

function deriveMasterSplitBaseName(name: string) {
  return String(name || "")
    .trim()
    .replace(/\s+\((MASTER|TRAIN|TEST|EVAL|EVALUATE)\)\s*$/i, "")
    .trim();
}

function validateDatasetItemImageIds(
  items: DatasetItem[]
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const item of items) {
    const imageId = String(item.image_id ?? "").trim();
    if (!imageId) return { ok: false, error: "Image ID cannot be blank." };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate imageId: ${imageId}` };
    seen.add(imageId);
  }
  return { ok: true };
}

async function parseCsvManifest(file: File): Promise<Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
  segment_tags?: string[] | string;
}>> {
  const text = await file.text();
  const rows = parseCsvText(text);
  if (rows.length === 0) throw new Error("CSV file is empty or has no data rows.");
  return normalizeManifestRows(rows, "CSV");
}

function parseCsvText(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      current.push(field); field = "";
    } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
      current.push(field); field = "";
      lines.push(current); current = [];
      if (ch === "\r") i++;
    } else if (ch === "\r") {
      current.push(field); field = "";
      lines.push(current); current = [];
    } else {
      field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); lines.push(current); }

  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
      return obj;
    });
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
  const seenImageIds = new Set<string>();

  for (let i = 0; i < rowsInput.length; i++) {
    const row = rowsInput[i] || {};
    const imageId = sanitizeImageId(String(row.image_id || row.imageId || ""));
    const imageUrl = String(row.image_url || row.imageUrl || row.image_uri || row.imageUri || "").trim();
    const rawLabel = String(row.ground_truth_label || row.ground_truth_labels || row.groundTruthLabel || row.groundTruthLabels || row.label || "").trim().toUpperCase();
    const segmentTags = (row.segment_tags ?? row.segmentTags ?? row.attribute_tags ?? row.attributeTags ?? row.attributes ?? row.segments ?? "") as string[] | string;
    if (!imageId) {
      throw new Error(`${sourceLabel} row ${i + 1} has blank imageId.`);
    }
    if (seenImageIds.has(imageId)) {
      throw new Error(`${sourceLabel} has duplicate imageId "${imageId}" (row ${i + 1}).`);
    }
    seenImageIds.add(imageId);
    if (!imageUrl) {
      throw new Error(`${sourceLabel} row ${i + 1} has blank imageUrl.`);
    }
    try {
      new URL(imageUrl);
    } catch {
      throw new Error(`${sourceLabel} row ${i + 1} has invalid imageUrl: "${imageUrl}".`);
    }
    const urlExt = imageUrl.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || "";
    const supportedExts = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "svg"]);
    if (urlExt && !supportedExts.has(urlExt)) {
      throw new Error(`${sourceLabel} row ${i + 1} has unsupported file type ".${urlExt}" in imageUrl. Supported: jpg, png, gif, webp, bmp, tiff, svg.`);
    }
    let label: "DETECTED" | "NOT_DETECTED" | null = null;
    if (rawLabel) {
      if (rawLabel !== "DETECTED" && rawLabel !== "NOT_DETECTED") {
        throw new Error(`${sourceLabel} row ${i + 1} has invalid groundTruthLabel: "${rawLabel}". Must be DETECTED or NOT_DETECTED.`);
      }
      label = rawLabel as "DETECTED" | "NOT_DETECTED";
    }
    const rawSegStr = typeof segmentTags === "string" ? segmentTags.trim() : "";
    if (rawSegStr && rawSegStr.startsWith("[")) {
      try {
        const parsed = JSON.parse(rawSegStr);
        if (!Array.isArray(parsed)) {
          throw new Error(`${sourceLabel} row ${i + 1} has malformed attributes: expected a JSON array.`);
        }
        if (parsed.some((v: unknown) => typeof v !== "string")) {
          throw new Error(`${sourceLabel} row ${i + 1} has malformed attributes: all values must be strings.`);
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error(`${sourceLabel} row ${i + 1} has malformed attributes: invalid JSON array.`);
        }
        throw e;
      }
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
  if (value == null) return ["Baseline"];
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
  return tags.length > 0 ? tags : ["Baseline"];
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
    <AttributePills
      options={options}
      selected={value}
      onToggle={(attr) =>
        onChange(value.includes(attr) ? value.filter((v) => v !== attr) : [...value, attr])
      }
    />
  );
}

function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, "\"\"")}"`;
  return str;
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
  if (!value) return <span className="app-badge app-badge-muted">Unset</span>;
  return <DecisionBadge decision={value} />;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.keys(STATUS_LABELS).map((k) => [k, { label: STATUS_LABELS[k], color: STATUS_BADGE_CLASSES[k] || "app-badge-muted" }])
);

function derivedStatus(children: Dataset[]): string {
  return derivedParentStatus(children.map((c) => c.qa_status || "draft"));
}

function DatasetStatusBar({
  dataset,
  itemsTotal,
  itemsLabeled,
  onSubmit,
  onStatusChange,
}: {
  dataset: Dataset;
  itemsTotal: number;
  itemsLabeled: number;
  onSubmit: () => Promise<void>;
  onStatusChange: (newStatus: string, revisionNote?: string) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  const status = dataset.qa_status || "draft";
  const allLabeled = itemsTotal > 0 && itemsLabeled >= itemsTotal;

  const canSubmit = ["in_annotation", "needs_revision", "assigned"].includes(status) && allLabeled;
  const canStartQa = status === "submitted";
  const canApprove = false;
  const canReturnForRevision = false;

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit();
    setSubmitting(false);
  };

  const hasActions = canSubmit || canStartQa || canApprove || canReturnForRevision || (dataset.revision_note && status === "needs_revision");
  if (!hasActions && !showRevisionInput) return null;

  return (
    <div className="space-y-2">
      {dataset.revision_note && status === "needs_revision" && (
        <div className="text-xs text-amber-400">Revision note: {dataset.revision_note}</div>
      )}

      {(canSubmit || canStartQa || canApprove || canReturnForRevision) && (
        <div className="flex items-center gap-2">
          {canSubmit && (
            <button onClick={handleSubmit} disabled={submitting} className="app-btn app-btn-primary app-btn-sm disabled:opacity-50">
              {submitting ? "Submitting..." : "Submit for QA"}
            </button>
          )}
          {canStartQa && (
            <button onClick={() => onStatusChange("in_qa")} className="app-btn app-btn-primary app-btn-sm">Start QA Review</button>
          )}
          {canApprove && (
            <button onClick={() => onStatusChange("approved")} className="app-btn app-btn-success app-btn-sm">Approve</button>
          )}
          {canReturnForRevision && !showRevisionInput && (
            <button onClick={() => setShowRevisionInput(true)} className="app-btn app-btn-warning app-btn-sm">Return for Revision</button>
          )}
        </div>
      )}

      {showRevisionInput && (
        <div className="flex items-center gap-2">
          <input
            className="app-input flex-1 text-sm"
            placeholder="Revision note (required)..."
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
          />
          <button
            onClick={async () => {
              if (!revisionNote.trim()) return;
              await onStatusChange("needs_revision", revisionNote.trim());
              setShowRevisionInput(false);
              setRevisionNote("");
            }}
            disabled={!revisionNote.trim()}
            className="app-btn app-btn-warning app-btn-sm disabled:opacity-50"
          >
            Send Back
          </button>
          <button
            onClick={() => { setShowRevisionInput(false); setRevisionNote(""); }}
            className="app-btn app-btn-subtle app-btn-sm"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
