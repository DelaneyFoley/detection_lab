"use client";

import ExcelJS from "exceljs";
import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from "react";
import { useAppStore } from "@/lib/store";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { InfoTip } from "@/components/shared/InfoTip";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { DecisionBadge } from "@/components/shared/DecisionBadge";
import type {
  Detection,
  DetectionCategory,
  MetricsSummary,
  MetricThresholds,
  PrimaryMetric,
  PromptStructure,
  PromptVersion,
  PromptComposition,
  ProductionSnapshot,
  ProvenanceKind,
  SiblingDetection,
  VersionNoteEntry,
  VersionNoteEntryOrigin,
} from "@/types";
import {
  computeProvenanceKind,
  compileTargetMemberDescription,
} from "@/lib/productionMirror";
import { useProductionMirror } from "@/lib/useProductionMirror";
import { compileAggregatePrompt, extractPreamble } from "@/lib/inference/aggregateCompile";
import {
  buildUserPromptTemplate,
  buildVersionLabel,
  compileUserPrompt,
  DEFAULT_CATEGORY_PROMPT_TEMPLATES,
  DEFAULT_DETECTION_CATEGORY,
  DETECTION_CATEGORY_LABELS,
  DETECTION_CATEGORY_OPTIONS,
  nextVersionNumber,
  parseVersionLabel,
} from "@/lib/detectionPrompts";
import { localDateTime } from "@/lib/dateFmt";
import { DEFAULT_IMAGE_ATTRIBUTES } from "@/lib/defaultAttributes";

type AdminPromptSettings = {
  incorrect_capture_system_prompt: string;
  incorrect_capture_user_prompt: string;
  hazard_identification_system_prompt: string;
  hazard_identification_user_prompt: string;
};

// Narrow row shape for `/api/runs?detection_id=...` responses consumed here.
// Kept local because this component doesn't need the full `Run` interface.
type RunRow = {
  run_id: string;
  prompt_version_id: string;
  detection_id?: string;
  dataset_id?: string;
  status: string;
  split_type?: string;
  created_at: string;
  total_images?: number;
  metrics_summary?: MetricsSummary | null;
};

// `prompt_structure` occasionally carries `fixed_guidance` (populated by the
// prompt-iteration pipeline) alongside the fields declared in `PromptStructure`.
type ExtendedPromptStructure = PromptStructure & { fixed_guidance?: string };

type QuickTestResult = {
  image_name: string;
  predicted_decision: "DETECTED" | "NOT_DETECTED" | null;
  confidence: number | null;
  evidence: string | null;
  parse_ok: boolean;
  raw_response: string;
  parse_error_reason: string | null;
  parse_fix_suggestion: string | null;
  inference_runtime_ms: number | null;
  parse_retry_count: number | null;
  siblings?: SiblingDetection[];
};

const promptStructureOf = (
  p: { prompt_structure?: PromptStructure | ExtendedPromptStructure } | null | undefined
): ExtendedPromptStructure =>
  (p?.prompt_structure as ExtendedPromptStructure | undefined) || ({} as ExtendedPromptStructure);

// Shared Tailwind class blobs used across many form controls in this file.
// Kept in-module (not shared with other components) — extraction is purely to
// remove the 20+ duplicate literal strings.
const INPUT_CLS = "w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm";
const INPUT_CLS_SMALL = "w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm";
const LABEL_CLS = "text-xs text-gray-400 block mb-1";

/**
 * Delete a single prompt version via the /api/prompts DELETE endpoint.
 * Returns true on success. Used in single-delete, group-delete, and bulk-delete
 * flows to remove duplication of the same fetch call.
 */
async function deletePromptVersionRequest(promptVersionId: string): Promise<boolean> {
  const res = await fetch("/api/prompts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_version_id: promptVersionId }),
  });
  return res.ok;
}

export function DetectionSetup({
  detections,
  selectedDetection,
  onRefresh,
  createTrigger,
}: {
  detections: Detection[];
  selectedDetection: Detection | null;
  onRefresh: () => void;
  createTrigger?: number;
}) {
  const { apiKey, selectedModel, refreshCounter, triggerRefresh, setSelectedDetectionId, setSelectedPromptForDetection } = useAppStore();
  const { notify, confirm } = useAppFeedback();
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [groupMetadata, setGroupMetadata] = useState<Array<{ base_name: string; description: string; updated_at: string }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [labelPolicySections, setLabelPolicySections] = useState({
    detected: "",
    notDetected: "",
  });
  const [decisionRubricCriteria, setDecisionRubricCriteria] = useState<string[]>([]);
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [promptFormInitialData, setPromptFormInitialData] = useState<Partial<PromptVersion> | undefined>(undefined);
  const [promptFormSuggestedVersionLabel, setPromptFormSuggestedVersionLabel] = useState<string>("");
  const [formLabelPolicySections, setFormLabelPolicySections] = useState({
    detected: "",
    notDetected: "",
  });
  const [showLabelPolicy, setShowLabelPolicy] = useState(true);
  const [showDecisionRubric, setShowDecisionRubric] = useState(true);
  const [draggingSegmentIndex, setDraggingSegmentIndex] = useState<number | null>(null);
  const [segmentDropTargetIndex, setSegmentDropTargetIndex] = useState<number | null>(null);
  const [editVersionName, setEditVersionName] = useState("");
  const [editPromptSource, setEditPromptSource] = useState<PromptVersion | null>(null);
  const [editingFromVersionRow, setEditingFromVersionRow] = useState(false);
  const [createMode, setCreateMode] = useState<"blank" | "assist" | "mirror">("blank");
  const [assistInput, setAssistInput] = useState("");
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [createVersionName, setCreateVersionName] = useState("Detection baseline");
  const [lastHandledCreateTrigger, setLastHandledCreateTrigger] = useState(0);
  const [adminPromptSettings, setAdminPromptSettings] = useState<AdminPromptSettings>({
    incorrect_capture_system_prompt: DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.system_prompt,
    incorrect_capture_user_prompt: DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.user_prompt_template,
    hazard_identification_system_prompt: DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.system_prompt,
    hazard_identification_user_prompt: DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.user_prompt_template,
  });
  const [quickTestFiles, setQuickTestFiles] = useState<Array<{ id: string; file: File; preview: string }>>([]);
  const [quickTesting, setQuickTesting] = useState(false);
  const [quickTestProgress, setQuickTestProgress] = useState("");
  const [quickTestError, setQuickTestError] = useState("");
  const [quickTestPreviewIndex, setQuickTestPreviewIndex] = useState<number | null>(null);
  const [quickTestResults, setQuickTestResults] = useState<QuickTestResult[]>([]);
  const promptEditorDraftKeyRef = useRef("");
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [groupDescDraft, setGroupDescDraft] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupSelectedVersionIds, setGroupSelectedVersionIds] = useState<Set<string>>(new Set());
  const [savingGroupDesc, setSavingGroupDesc] = useState(false);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [promptSearch, setPromptSearch] = useState("");
  const [groupManageMode, setGroupManageMode] = useState(false);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [bulkDeletingGroups, setBulkDeletingGroups] = useState(false);

  // Form state for create/edit detection
  const [form, setForm] = useState({
    detection_code: "",
    display_name: "",
    description: "",
    detection_category: DEFAULT_DETECTION_CATEGORY as DetectionCategory,
    label_policy: "",
    user_prompt_addendum: "",
    decision_rubric: [""],
    segment_taxonomy: [...DEFAULT_IMAGE_ATTRIBUTES],
    production_label: "",
    metric_thresholds: { primary_metric: "f1", min_precision: 0.8, min_recall: 0.8, min_f1: 0.8 } as MetricThresholds,
  });

  // Production-replication state for the Production Replication detection-creation mode.
  const createTargetDescription = compileTargetMemberDescription({
    labelPolicy: form.label_policy,
    decisionRubric: form.decision_rubric
      .filter((r) => r.trim())
      .map((r, i) => `${i + 1}. ${r.trim()}`)
      .join("\n"),
    userPromptAddendum: form.user_prompt_addendum,
  });
  const createMirror = useProductionMirror({
    active: mode === "create" && createMode === "mirror",
    productionLabel: form.production_label,
    targetDescription: createTargetDescription,
  });

  const loadRelated = useCallback(async () => {
    if (!selectedDetection) return;
    const [promptsRes, runsRes, groupsRes] = await Promise.all([
      fetch(`/api/prompts?detection_id=${selectedDetection.detection_id}`),
      fetch(`/api/runs?detection_id=${selectedDetection.detection_id}`),
      fetch(`/api/prompts/groups?detection_id=${selectedDetection.detection_id}`),
    ]);
    setPrompts(await safeJsonArray<PromptVersion>(promptsRes, "prompts"));
    setRuns(await safeJsonArray<RunRow>(runsRes, "runs"));
    const groupsData = await safeJsonObject<{ groups?: Array<{ base_name: string; description: string; updated_at: string }> }>(groupsRes);
    setGroupMetadata(groupsData?.groups || []);
  }, [selectedDetection]);

  // Consolidates the repeated three-line refresh pattern (loadRelated + parent
  // onRefresh + global triggerRefresh) used after any mutation that changes
  // prompt/run/group state.
  const refreshAll = useCallback(async () => {
    await loadRelated();
    onRefresh();
    triggerRefresh();
  }, [loadRelated, onRefresh, triggerRefresh]);

  useEffect(() => {
    loadRelated();
  }, [loadRelated, refreshCounter]);

  useEffect(() => {
    const loadAdminPrompts = async () => {
      try {
        const res = await fetch("/api/admin/prompts");
        const data = await safeJsonObject<Partial<AdminPromptSettings>>(res);
        if (!data) return;
        setAdminPromptSettings({
          incorrect_capture_system_prompt:
            String(data.incorrect_capture_system_prompt || DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.system_prompt),
          incorrect_capture_user_prompt:
            String(data.incorrect_capture_user_prompt || DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.user_prompt_template),
          hazard_identification_system_prompt:
            String(data.hazard_identification_system_prompt || DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.system_prompt),
          hazard_identification_user_prompt:
            String(data.hazard_identification_user_prompt || DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.user_prompt_template),
        });
      } catch {
        // Keep defaults when admin templates fail to load.
      }
    };
    loadAdminPrompts();
  }, []);

  const getCategoryTemplates = useCallback(
    (category: DetectionCategory) => {
      if (category === "INCORRECT_CAPTURE") {
        return {
          system_prompt: adminPromptSettings.incorrect_capture_system_prompt,
          user_prompt_template: adminPromptSettings.incorrect_capture_user_prompt,
        };
      }
      return {
        system_prompt: adminPromptSettings.hazard_identification_system_prompt,
        user_prompt_template: adminPromptSettings.hazard_identification_user_prompt,
      };
    },
    [adminPromptSettings]
  );

  useEffect(() => {
    if (prompts.length === 0) {
      if (selectedPromptId) setSelectedPromptId("");
      return;
    }
    const exists = prompts.some((p) => p.prompt_version_id === selectedPromptId);
    if (exists) return;
    setSelectedPromptId(prompts[0].prompt_version_id);
  }, [prompts, selectedPromptId]);

  // Sync selected prompt version to the store so Build & Run Datasets defaults to it.
  useEffect(() => {
    if (!selectedDetection?.detection_id || !selectedPromptId) return;
    setSelectedPromptForDetection(selectedDetection.detection_id, selectedPromptId);
  }, [selectedDetection?.detection_id, selectedPromptId, setSelectedPromptForDetection]);

  // Auto-select the approved prompt only on the first load of a detection, so
  // toggling tabs (which reloads prompts) doesn't override a manual selection.
  const approvedAutoSelectRef = useRef<string | null>(null);
  useEffect(() => {
    const detId = selectedDetection?.detection_id;
    if (!detId || approvedAutoSelectRef.current === detId) return;
    if (!selectedDetection?.approved_prompt_version) return;
    const approved = prompts.find((p) => p.prompt_version_id === selectedDetection.approved_prompt_version);
    if (approved) {
      setSelectedPromptId(approved.prompt_version_id);
      approvedAutoSelectRef.current = detId;
    }
  }, [prompts, selectedDetection?.detection_id, selectedDetection?.approved_prompt_version]);

  useEffect(() => {
    if (!selectedPromptId) return;
    const p = prompts.find((v) => v.prompt_version_id === selectedPromptId);
    if (!p) return;
    const key = parseVersionLabel(p.version_label).base.toLowerCase();
    setExpandedGroupKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [selectedPromptId, prompts]);

  useEffect(() => {
    return () => {
      quickTestFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, [quickTestFiles]);

  useEffect(() => {
    if (quickTestPreviewIndex == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      const isTypingTarget =
        !!target && (target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
      if (isTypingTarget) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setQuickTestPreviewIndex((i) => (i == null ? null : Math.max(0, i - 1)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setQuickTestPreviewIndex((i) =>
          i == null ? null : Math.min(quickTestFiles.length - 1, i + 1)
        );
      } else if (event.key === "Escape") {
        event.preventDefault();
        setQuickTestPreviewIndex(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quickTestPreviewIndex, quickTestFiles.length]);

  const handleCreateDetection = async () => {
    if (!form.detection_code.trim()) {
      notify({ message: "Detection code is required.", tone: "warning" });
      return;
    }
    if (!form.display_name.trim()) {
      notify({ message: "Display name is required.", tone: "warning" });
      return;
    }
    if (createMode === "mirror") {
      if (!createMirror.selectedContext || !createMirror.snapshot || !createMirror.composition) {
        notify({ message: "Select a production context to import before creating a Production Replication detection.", tone: "warning" });
        return;
      }
      if (!createMirror.composition.members.some((m) => m.is_target)) {
        notify({ message: "Select a Target detection before creating a Production Replication detection.", tone: "warning" });
        return;
      }
    }
    const cleanedRubric = form.decision_rubric.filter((r) => r.trim());
    const cleanedSegmentTaxonomy = form.segment_taxonomy.map((s) => s.trim()).filter(Boolean);
    setSavingPrompt(true);
    try {
    const res = await fetch("/api/detections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        decision_rubric: cleanedRubric,
        segment_taxonomy: cleanedSegmentTaxonomy,
        production_label:
          (createMode === "mirror" ? createMirror.targetLabel.trim() : form.production_label.trim()) || null,
      }),
    });
    const data = await safeJsonObject<{ detection_id?: string; error?: string }>(res);
    if (!res.ok || !data?.detection_id) {
      notify({ message: data?.error || "Failed to create detection.", tone: "error" });
      return;
    }

    const decisionRubricText = cleanedRubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const isMirror = createMode === "mirror";
    const promptBody: Record<string, unknown> = {
      detection_id: data.detection_id,
      version_label: buildVersionLabel(createVersionName || "Detection baseline", []),
      prompt_structure: {
        detection_identity: `${form.display_name} (${form.detection_code})`,
        label_policy: form.label_policy,
        decision_rubric: decisionRubricText,
        user_prompt_addendum: form.user_prompt_addendum,
        output_schema: `{"detection_code":"${form.detection_code}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`,
        examples: "",
      },
      model:
        isMirror && createMirror.composition
          ? createMirror.composition.google_model || selectedModel || "gemini-2.5-flash"
          : selectedModel || "gemini-2.5-flash",
      temperature: 0,
      top_p: 1,
      max_output_tokens: 1024,
      change_notes: isMirror
        ? "Initial production replication baseline"
        : createMode === "assist"
          ? "Generated with Prompt Assist"
          : "Initial baseline prompt",
      created_by: "user",
      mode: isMirror ? "PRODUCTION_MODE" : "DEVELOPMENT_MODE",
    };
    if (isMirror && createMirror.snapshot && createMirror.composition) {
      promptBody.context_name = createMirror.selectedContext;
      promptBody.production_label = createMirror.targetLabel || null;
      promptBody.production_snapshot_id = createMirror.snapshot.snapshot_id;
      promptBody.provenance_kind = computeProvenanceKind(createMirror.snapshot, createMirror.composition);
      promptBody.composition = createMirror.composition;
    }
    const promptRes = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(promptBody),
    });
    if (!promptRes.ok) {
      const promptErr = await safeJsonObject<{ error?: string }>(promptRes);
      notify({
        message: promptErr?.error || "Detection saved, but failed to create baseline prompt version.",
        tone: "error",
      });
    }

    setSelectedDetectionId(data.detection_id);
    setMode("view");
    createMirror.reset();
    setCreateMode("blank");
    onRefresh();
    triggerRefresh();
    } finally {
      setSavingPrompt(false);
    }
  };

  const generateWithPromptAssist = async () => {
    if (!assistInput.trim()) {
      setAssistError("Describe the detection to generate a template.");
      return;
    }

    setAssistLoading(true);
    setAssistError(null);
    try {
      const res = await fetch("/api/gemini/detection-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          request: assistInput.trim(),
          detection_category: form.detection_category,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data) {
        setAssistError(data?.error || "Prompt Assist failed.");
        return;
      }

      const rubric = Array.isArray(data.decision_rubric)
        ? data.decision_rubric.map((r: string) => String(r || "").trim()).filter(Boolean)
        : [];
      const imageAttributes = Array.isArray(data.image_attributes)
        ? data.image_attributes.map((value: string) => String(value || "").trim()).filter(Boolean)
        : [];
      const detected = String(data.label_policy_detected || "").trim();
      const notDetected = String(data.label_policy_not_detected || "").trim();

      setForm((prev) => ({
        ...prev,
        detection_code: String(data.detection_code || prev.detection_code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, ""),
        display_name: String(data.display_name || prev.display_name || ""),
        description: String(data.description || prev.description || ""),
        detection_category: (data.detection_category as DetectionCategory) || prev.detection_category,
        label_policy: composeLabelPolicySections({ detected, notDetected }),
        user_prompt_addendum: String(data.user_prompt_addendum || prev.user_prompt_addendum || ""),
        decision_rubric: rubric.length > 0 ? rubric : prev.decision_rubric,
        segment_taxonomy: imageAttributes.length > 0 ? imageAttributes : prev.segment_taxonomy,
      }));
      setFormLabelPolicySections({ detected, notDetected });
      if (detected || notDetected) setShowLabelPolicy(true);
      if (rubric.length > 0) setShowDecisionRubric(true);
      if (String(data.version_label || "").trim()) {
        setCreateVersionName(String(data.version_label).trim());
      }
    } catch (error) {
      setAssistError(error instanceof Error ? error.message : "Prompt Assist failed.");
    } finally {
      setAssistLoading(false);
    }
  };

  const handleUpdateDetection = async () => {
    if (!selectedDetection) return;
    setSavingPrompt(true);
    try {
    await fetch("/api/detections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detection_id: selectedDetection.detection_id,
        description: form.description,
        segment_taxonomy: form.segment_taxonomy.map((s) => s.trim()).filter(Boolean),
        metric_thresholds: form.metric_thresholds,
        approved_prompt_version: selectedDetection.approved_prompt_version,
      }),
    });
    setEditingFromVersionRow(false);
    setMode("view");
    await refreshAll();
    } finally {
      setSavingPrompt(false);
    }
  };

  const deletePromptVersion = async (promptVersionId: string) => {
    if (!selectedDetection) return;
    if (
      !(await confirm({
        title: "Delete Prompt Version",
        message: "Delete this prompt version and its run artifacts? This cannot be undone.",
        confirmLabel: "Delete Prompt",
        tone: "danger",
      }))
    ) {
      return;
    }

    const ok = await deletePromptVersionRequest(promptVersionId);

    if (!ok) {
      notify({ message: "Failed to delete prompt version.", tone: "error" });
      return;
    }

    if (selectedPromptId === promptVersionId) {
      setSelectedPromptId("");
    }

    await refreshAll();
  };

  const deletePromptGroup = async (
    baseName: string,
    versionIds: string[],
  ) => {
    if (!selectedDetection) return;
    if (
      !(await confirm({
        title: "Delete Prompt Group",
        message: `Delete "${baseName}" and all ${versionIds.length} version${
          versionIds.length === 1 ? "" : "s"
        }? This also removes their run artifacts and cannot be undone.`,
        confirmLabel: "Delete Group",
        tone: "danger",
      }))
    ) {
      return;
    }

    const failures: string[] = [];
    for (const id of versionIds) {
      const ok = await deletePromptVersionRequest(id);
      if (!ok) failures.push(id);
    }

    if (failures.length) {
      notify({
        message: `Failed to delete ${failures.length} version${failures.length === 1 ? "" : "s"}.`,
        tone: "error",
      });
    }

    await fetch("/api/prompts/groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detection_id: selectedDetection.detection_id,
        base_name: baseName,
      }),
    });

    if (versionIds.includes(selectedPromptId)) setSelectedPromptId("");
    await refreshAll();
  };

  const buildPromptSeed = (source: PromptVersion | null): Partial<PromptVersion> | undefined =>
    source
      ? {
          prompt_version_id: source.prompt_version_id,
          prompt_structure: source.prompt_structure,
          model: source.model,
          temperature: source.temperature,
          top_p: source.top_p,
          max_output_tokens: source.max_output_tokens,
          mode: source.mode,
          context_name: source.context_name,
          production_label: source.production_label,
          production_snapshot_id: source.production_snapshot_id,
          provenance_kind: source.provenance_kind,
          composition: source.composition,
        }
      : undefined;

  const startEditFromVersion = (promptVersionId: string) => {
    if (!selectedDetection) return;
    const source = prompts.find((p) => p.prompt_version_id === promptVersionId);
    if (!source) return;
    setPromptFormInitialData(buildPromptSeed(source));
    setPromptFormSuggestedVersionLabel(`v${prompts.length + 1}.0`);
    setShowPromptForm(true);
  };

  const saveGroupEdit = async (group: {
    baseName: string;
    baseNameKey: string;
    description: string;
  }) => {
    if (!selectedDetection) return;
    const newName = groupNameDraft.trim();
    const newDesc = groupDescDraft;
    if (!newName) {
      notify({ message: "Group name cannot be empty.", tone: "error" });
      return;
    }
    setSavingGroupDesc(true);
    try {
      const nameChanged = newName.toLowerCase() !== group.baseName.toLowerCase();
      if (nameChanged) {
        const res = await fetch("/api/prompts/groups/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detection_id: selectedDetection.detection_id,
            old_base_name: group.baseName,
            new_base_name: newName,
          }),
        });
        const payload = await safeJsonObject<{ ok?: boolean; error?: string; collisions?: string[] }>(res);
        if (!res.ok) {
          notify({ message: payload?.error || "Failed to rename group.", tone: "error" });
          return;
        }
      }
      const descRes = await fetch("/api/prompts/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_id: selectedDetection.detection_id,
          base_name: newName,
          description: newDesc,
        }),
      });
      const descPayload = await safeJsonObject<{ ok?: boolean; error?: string }>(descRes);
      if (!descRes.ok) {
        notify({ message: descPayload?.error || "Failed to save description.", tone: "error" });
        return;
      }
      await refreshAll();
      setEditingGroupKey(null);
      setGroupSelectedVersionIds(new Set());
    } finally {
      setSavingGroupDesc(false);
    }
  };

  const bulkDeleteSelectedVersions = async () => {
    if (!selectedDetection || groupSelectedVersionIds.size === 0) return;
    const ids = [...groupSelectedVersionIds];
    if (
      !(await confirm({
        title: "Delete Selected Versions",
        message: `Delete ${ids.length} version${ids.length === 1 ? "" : "s"} and their run artifacts? This cannot be undone.`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    const failures: string[] = [];
    for (const id of ids) {
      const ok = await deletePromptVersionRequest(id);
      if (!ok) failures.push(id);
    }
    if (failures.length) {
      notify({
        message: `Failed to delete ${failures.length} version${failures.length === 1 ? "" : "s"}.`,
        tone: "error",
      });
    }
    if (ids.includes(selectedPromptId)) setSelectedPromptId("");
    setGroupSelectedVersionIds(new Set());
    await refreshAll();
  };

  const bulkDeleteSelectedGroups = async () => {
    if (!selectedDetection || selectedGroupKeys.size === 0) return;
    const groups = promptGroups.filter((g) => selectedGroupKeys.has(g.baseNameKey));
    if (groups.length === 0) return;
    const versionCount = groups.reduce((n, g) => n + g.versions.length, 0);
    if (
      !(await confirm({
        title: "Delete Prompt Groups",
        message: `Delete ${groups.length} group${groups.length === 1 ? "" : "s"} and all ${versionCount} version${
          versionCount === 1 ? "" : "s"
        }? This also removes their run artifacts and cannot be undone.`,
        confirmLabel: "Delete Groups",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBulkDeletingGroups(true);
    try {
      const failures: string[] = [];
      const removedVersionIds: string[] = [];
      for (const g of groups) {
        for (const v of g.versions) {
          const ok = await deletePromptVersionRequest(v.prompt_version_id);
          if (!ok) failures.push(v.prompt_version_id);
          else removedVersionIds.push(v.prompt_version_id);
        }
        await fetch("/api/prompts/groups", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detection_id: selectedDetection.detection_id,
            base_name: g.baseName,
          }),
        });
      }
      if (failures.length) {
        notify({
          message: `Failed to delete ${failures.length} version${failures.length === 1 ? "" : "s"}.`,
          tone: "error",
        });
      }
      if (removedVersionIds.includes(selectedPromptId)) setSelectedPromptId("");
      setSelectedGroupKeys(new Set());
      setGroupManageMode(false);
      await refreshAll();
    } finally {
      setBulkDeletingGroups(false);
    }
  };

  const populateEditForm = (sourcePrompt: PromptVersion | null) => {
    if (!selectedDetection) return;
    const sourceStructure = promptStructureOf(sourcePrompt);
    const versionLabelPolicy =
      typeof sourceStructure.label_policy === "string" && sourceStructure.label_policy.trim()
        ? sourceStructure.label_policy
        : selectedDetection.label_policy || "";
    const versionRubric =
      typeof sourceStructure.decision_rubric === "string" && sourceStructure.decision_rubric.trim()
        ? parseDecisionRubricCriteria(sourceStructure.decision_rubric)
        : selectedDetection.decision_rubric;
    const versionAddendum =
      typeof sourceStructure.user_prompt_addendum === "string"
        ? sourceStructure.user_prompt_addendum
        : selectedDetection.user_prompt_addendum || "";
    const parsedLabelPolicy = parseLabelPolicySections(versionLabelPolicy);
    setForm({
      detection_code: selectedDetection.detection_code,
      display_name: selectedDetection.display_name,
      description: selectedDetection.description,
      detection_category: selectedDetection.detection_category,
      label_policy: versionLabelPolicy,
      user_prompt_addendum: versionAddendum,
      decision_rubric: versionRubric.length > 0 ? versionRubric : [""],
      segment_taxonomy:
        Array.isArray(selectedDetection.segment_taxonomy) && selectedDetection.segment_taxonomy.length > 0
          ? selectedDetection.segment_taxonomy
          : [""],
      production_label: selectedDetection.production_label || "",
      metric_thresholds: selectedDetection.metric_thresholds,
    });
    setFormLabelPolicySections(parsedLabelPolicy);
    setShowLabelPolicy(
      Boolean(parsedLabelPolicy.detected.trim() || parsedLabelPolicy.notDetected.trim())
    );
    setShowDecisionRubric(versionRubric.filter((r) => r.trim()).length > 0);
    setEditPromptSource(sourcePrompt);
    setEditVersionName(sourcePrompt ? parseVersionLabel(sourcePrompt.version_label).base : "Detection baseline");
  };

  const startEdit = () => {
    if (!selectedDetection) return;
    const sourcePrompt = prompts.find((p) => p.prompt_version_id === selectedPromptId) || prompts[0] || null;
    populateEditForm(sourcePrompt);
    setEditingFromVersionRow(false);
    setMode("edit");
  };

  const startCreate = useCallback(() => {
    setForm({
      detection_code: "",
      display_name: "",
      description: "",
      detection_category: DEFAULT_DETECTION_CATEGORY,
      label_policy: "",
      user_prompt_addendum: "",
      decision_rubric: [""],
      segment_taxonomy: [...DEFAULT_IMAGE_ATTRIBUTES],
      production_label: "",
      metric_thresholds: { primary_metric: "f1", min_precision: 0.8, min_recall: 0.8, min_f1: 0.8 },
    });
    setFormLabelPolicySections({ detected: "", notDetected: "" });
    setShowLabelPolicy(true);
    setShowDecisionRubric(true);
    setEditPromptSource(null);
    setEditVersionName("");
    setEditingFromVersionRow(false);
    setCreateMode("blank");
    createMirror.reset();
    setAssistInput("");
    setAssistError(null);
    setCreateVersionName("Detection baseline");
    setMode("create");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts.length]);

  useEffect(() => {
    if (!createTrigger) return;
    if (createTrigger === lastHandledCreateTrigger) return;
    startCreate();
    setLastHandledCreateTrigger(createTrigger);
  }, [createTrigger, lastHandledCreateTrigger, startCreate]);

  const updateFormLabelPolicySection = (key: "detected" | "notDetected", value: string) => {
    setFormLabelPolicySections((prev) => {
      const next = { ...prev, [key]: value };
      setForm((current) => ({
        ...current,
        label_policy: composeLabelPolicySections(next),
      }));
      return next;
    });
  };

  const removeLabelPolicySection = () => {
    setFormLabelPolicySections({ detected: "", notDetected: "" });
    setForm((current) => ({ ...current, label_policy: "" }));
    setShowLabelPolicy(false);
  };
  const addLabelPolicySection = () => {
    setShowLabelPolicy(true);
  };
  const removeDecisionRubricSection = () => {
    setForm((current) => ({ ...current, decision_rubric: [""] }));
    setShowDecisionRubric(false);
  };
  const addDecisionRubricSection = () => {
    setForm((current) => ({
      ...current,
      decision_rubric: current.decision_rubric.length > 0 ? current.decision_rubric : [""],
    }));
    setShowDecisionRubric(true);
  };

  const openNewPromptForm = () => {
    const seed = prompts.find((p) => p.prompt_version_id === selectedPromptId) || prompts[0] || null;
    setPromptFormInitialData(buildPromptSeed(seed));
    setPromptFormSuggestedVersionLabel(`v${prompts.length + 1}.0`);
    setShowPromptForm(true);
  };

  const onPickQuickTestFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;
    setQuickTestError("");

    const roomLeft = Math.max(0, 10 - quickTestFiles.length);
    if (roomLeft <= 0) {
      setQuickTestError("Quick Test supports up to 10 images.");
      event.currentTarget.value = "";
      return;
    }

    const accepted = picked.slice(0, roomLeft);
    if (accepted.length < picked.length) {
      setQuickTestError("Only the first 10 images were kept for Quick Test.");
    }

    const nextRows = accepted.map((file, i) => ({
      id: `${Date.now()}_${i}_${file.name}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    setQuickTestFiles((prev) => [...prev, ...nextRows]);
    event.currentTarget.value = "";
  };

  const removeQuickTestFile = (id: string) => {
    setQuickTestFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const resetQuickTest = () => {
    setQuickTestFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.preview));
      return [];
    });
    setQuickTestResults([]);
    setQuickTestProgress("");
    setQuickTestError("");
    setQuickTestPreviewIndex(null);
  };

  const runQuickTest = async () => {
    if (!selectedDetection) return;
    setQuickTestError("");
    if (!selectedPromptId) {
      setQuickTestError("Select a prompt version first.");
      return;
    }
    if (quickTestFiles.length === 0) {
      setQuickTestError("Upload at least one image.");
      return;
    }
    if (quickTestFiles.length > 10) {
      setQuickTestError("Quick Test supports up to 10 images.");
      return;
    }

    setQuickTesting(true);
    setQuickTestProgress("");
    try {
      const total = quickTestFiles.length;
      const aggregatedResults: QuickTestResult[] = [];
      for (let i = 0; i < quickTestFiles.length; i++) {
        setQuickTestProgress(`Quick Test progress: ${i}/${total} images`);
        const formData = new FormData();
        formData.append("prompt_version_id", selectedPromptId);
        formData.append("detection_id", selectedDetection.detection_id);
        formData.append("api_key", apiKey || "");
        formData.append("model_override", selectedModel || "");
        formData.append("files", quickTestFiles[i].file, quickTestFiles[i].file.name);

        const res = await fetch("/api/runs/quick-test", {
          method: "POST",
          body: formData,
        });
        const data = await safeJsonObject<{ results?: QuickTestResult[]; error?: string }>(res);
        if (!res.ok) {
          throw new Error(data?.error || "Quick Test failed.");
        }
        if (Array.isArray(data?.results)) {
          aggregatedResults.push(...data.results);
        }
      }
      setQuickTestProgress(`Quick Test progress: ${total}/${total} images`);
      setQuickTestResults(aggregatedResults);
    } catch (error: unknown) {
      setQuickTestError(error instanceof Error ? error.message : "Quick Test failed.");
    } finally {
      setQuickTestProgress("");
      setQuickTesting(false);
    }
  };

  const exportQuickTestToExcel = async () => {
    if (quickTestResults.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Quick Test Results");

    sheet.columns = [
      { header: "Image", key: "image", width: 22 },
      { header: "Image ID", key: "image_id", width: 28 },
      { header: "Predicted Label", key: "predicted_label", width: 18 },
      { header: "Confidence", key: "confidence", width: 12 },
      { header: "Evidence", key: "evidence", width: 60 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    for (let i = 0; i < quickTestResults.length; i++) {
      const result = quickTestResults[i];
      const rowIndex = i + 2;

      sheet.addRow({
        image: "",
        image_id: result.image_name,
        predicted_label: result.predicted_decision || "N/A",
        confidence: result.confidence != null ? Math.round(result.confidence * 100) / 100 : "",
        evidence: result.evidence || "",
      });

      const row = sheet.getRow(rowIndex);
      row.height = 90;
      row.alignment = { vertical: "middle", wrapText: true };

      const matchingFile = quickTestFiles.find((f) => f.file.name === result.image_name);
      if (matchingFile) {
        try {
          const buffer = await matchingFile.file.arrayBuffer();
          const ext = matchingFile.file.type.includes("png") ? "png" : "jpeg";
          const imageId = workbook.addImage({
            buffer,
            extension: ext,
          });
          sheet.addImage(imageId, {
            tl: { col: 0, row: rowIndex - 1 },
            ext: { width: 120, height: 90 },
          });
        } catch {
          // Skip image embedding on failure
        }
      }
    }

    const xlsxBuffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([xlsxBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quick_test_${selectedDetection?.detection_code || "export"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const approvalEligibilityByPrompt = useMemo(() => {
    const byPrompt = new Map<
      string,
      { eligible: boolean; latestEvalRun: RunRow | null; latestPassingRun: RunRow | null; reason: string }
    >();
    const thresholds = selectedDetection?.metric_thresholds || form.metric_thresholds;
    for (const prompt of prompts) {
      const evalRuns = runs
        .filter(
          (r) =>
            r.prompt_version_id === prompt.prompt_version_id &&
            r.split_type === "HELD_OUT_EVAL" &&
            r.status === "completed" &&
            !!r.metrics_summary
        )
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

      const latestEvalRun = evalRuns[0] || null;
      const latestPassingRun = evalRuns.find((r) => metricsMeetThresholds(r.metrics_summary || null, thresholds)) || null;
      if (!latestEvalRun) {
        byPrompt.set(prompt.prompt_version_id, {
          eligible: false,
          latestEvalRun: null,
          latestPassingRun: null,
          reason: "Needs a completed EVAL run.",
        });
        continue;
      }
      if (!latestPassingRun) {
        byPrompt.set(prompt.prompt_version_id, {
          eligible: false,
          latestEvalRun,
          latestPassingRun: null,
          reason: "EVAL run did not meet thresholds.",
        });
        continue;
      }
      byPrompt.set(prompt.prompt_version_id, {
        eligible: true,
        latestEvalRun,
        latestPassingRun,
        reason: "Eligible for approval.",
      });
    }
    return byPrompt;
  }, [prompts, runs, selectedDetection?.metric_thresholds, form.metric_thresholds]);

  const approvedPromptIsEligible = useMemo(() => {
    if (!selectedDetection?.approved_prompt_version) return false;
    return approvalEligibilityByPrompt.get(selectedDetection.approved_prompt_version)?.eligible === true;
  }, [selectedDetection?.approved_prompt_version, approvalEligibilityByPrompt]);

  // Best (max F1) run metrics per prompt version — used to mark the top performer
  // within each iteration cycle/model and to show performance on each card.
  const runBestByPrompt = useMemo(() => {
    const m = new Map<string, { f1: number; precision: number; recall: number; total: number }>();
    for (const r of runs) {
      if (r.status !== "completed" || !r.metrics_summary) continue;
      const f1 = Number(r.metrics_summary.f1 ?? 0);
      if (!Number.isFinite(f1)) continue;
      const prev = m.get(r.prompt_version_id);
      if (prev == null || f1 > prev.f1) {
        m.set(r.prompt_version_id, {
          f1,
          precision: Number(r.metrics_summary.precision ?? 0),
          recall: Number(r.metrics_summary.recall ?? 0),
          total: Number(r.metrics_summary.total ?? r.total_images ?? 0),
        });
      }
    }
    return m;
  }, [runs]);

  // Per prompt version: completed run count + sum of total_images across distinct
  // datasets it was run against (best proxy for "unique samples tested").
  const runCoverageByPrompt = useMemo(() => {
    const m = new Map<string, { runCount: number; uniqueSamples: number }>();
    const seenDatasets = new Map<string, Set<string>>();
    const sampleSum = new Map<string, number>();
    const runCount = new Map<string, number>();
    for (const r of runs) {
      if (r.status !== "completed") continue;
      const pid = r.prompt_version_id as string;
      runCount.set(pid, (runCount.get(pid) || 0) + 1);
      const ds = String(r.dataset_id || "");
      if (!ds) continue;
      const seen = seenDatasets.get(pid) || new Set<string>();
      if (!seen.has(ds)) {
        seen.add(ds);
        seenDatasets.set(pid, seen);
        const n = Number(r.metrics_summary?.total ?? r.total_images ?? 0);
        sampleSum.set(pid, (sampleSum.get(pid) || 0) + (Number.isFinite(n) ? n : 0));
      }
    }
    for (const [pid, c] of runCount.entries()) {
      m.set(pid, { runCount: c, uniqueSamples: sampleSum.get(pid) || 0 });
    }
    return m;
  }, [runs]);

  // Micro-averaged metrics across all completed runs of a prompt version.
  const runAvgByPrompt = useMemo(() => {
    const m = new Map<string, { f1: number; precision: number; recall: number; runCount: number; totalImages: number }>();
    const acc = new Map<string, { pSum: number; rSum: number; f1Sum: number; count: number; total: number }>();
    for (const r of runs) {
      if (r.status !== "completed" || !r.metrics_summary) continue;
      const f1 = Number(r.metrics_summary.f1 ?? 0);
      const precision = Number(r.metrics_summary.precision ?? 0);
      const recall = Number(r.metrics_summary.recall ?? 0);
      const total = Number(r.metrics_summary.total ?? r.total_images ?? 0);
      if (!Number.isFinite(f1)) continue;
      const cur = acc.get(r.prompt_version_id) || { pSum: 0, rSum: 0, f1Sum: 0, count: 0, total: 0 };
      cur.pSum += precision;
      cur.rSum += recall;
      cur.f1Sum += f1;
      cur.count += 1;
      cur.total += total;
      acc.set(r.prompt_version_id, cur);
    }
    for (const [pid, v] of acc.entries()) {
      if (v.count === 0) continue;
      m.set(pid, {
        f1: v.f1Sum / v.count,
        precision: v.pSum / v.count,
        recall: v.rSum / v.count,
        runCount: v.count,
        totalImages: v.total,
      });
    }
    return m;
  }, [runs]);

  // Group prompt versions by their base name (parsed from version_label), sorted
  // newest-first. Each group gets a description (from prompt_group_metadata) and
  // a "best version" — the version with the highest F1 across completed runs.
  const promptGroups = useMemo(() => {
    type GroupVersion = PromptVersion;
    type Group = {
      baseNameKey: string;
      baseName: string;
      versions: GroupVersion[];
      bestVersionId: string | null;
      bestVersionLabel: string | null;
      bestAvgMetrics: { f1: number; precision: number; recall: number; runCount: number; totalImages: number } | null;
      groupRollup: { precision: number | null; recall: number | null; f1: number | null; runCount: number; uniqueImages: number } | null;
      bestPrecisionId: string | null;
      bestRecallId: string | null;
      bestF1Id: string | null;
      description: string;
      newestCreatedAt: string;
    };
    const descByKey = new Map<string, string>();
    for (const row of groupMetadata) {
      descByKey.set(row.base_name.trim().toLowerCase(), row.description || "");
    }
    const groups = new Map<string, Group>();
    for (const p of prompts) {
      const { base } = parseVersionLabel(p.version_label);
      const key = base.toLowerCase();
      const existing = groups.get(key);
      if (existing) {
        existing.versions.push(p);
        if (p.created_at > existing.newestCreatedAt) {
          existing.newestCreatedAt = p.created_at;
          existing.baseName = base;
        }
      } else {
        groups.set(key, {
          baseNameKey: key,
          baseName: base,
          versions: [p],
          bestVersionId: null,
          bestVersionLabel: null,
          bestAvgMetrics: null,
          groupRollup: null,
          bestPrecisionId: null,
          bestRecallId: null,
          bestF1Id: null,
          description: descByKey.get(key) || "",
          newestCreatedAt: p.created_at,
        });
      }
    }
    for (const g of groups.values()) {
      g.versions.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      let bestId: string | null = null;
      let bestF1 = -Infinity;
      let bestPrecisionId: string | null = null;
      let bestPrecision = -Infinity;
      let bestRecallId: string | null = null;
      let bestRecall = -Infinity;
      let bestF1MetricId: string | null = null;
      let bestF1Metric = -Infinity;
      for (const v of g.versions) {
        const best = runBestByPrompt.get(v.prompt_version_id);
        if (!best) continue;
        if (best.f1 > bestF1) {
          bestF1 = best.f1;
          bestId = v.prompt_version_id;
        }
        if (best.precision > bestPrecision) {
          bestPrecision = best.precision;
          bestPrecisionId = v.prompt_version_id;
        }
        if (best.recall > bestRecall) {
          bestRecall = best.recall;
          bestRecallId = v.prompt_version_id;
        }
        if (best.f1 > bestF1Metric) {
          bestF1Metric = best.f1;
          bestF1MetricId = v.prompt_version_id;
        }
      }
      if (bestId) {
        g.bestVersionId = bestId;
        g.bestVersionLabel = g.versions.find((v) => v.prompt_version_id === bestId)?.version_label || null;
        g.bestAvgMetrics = runAvgByPrompt.get(bestId) || null;
      }
      g.bestPrecisionId = bestPrecisionId;
      g.bestRecallId = bestRecallId;
      g.bestF1Id = bestF1MetricId;
      let totalRuns = 0;
      let totalImages = 0;
      let pSum = 0;
      let rSum = 0;
      let f1Sum = 0;
      let weightSum = 0;
      for (const v of g.versions) {
        const cov = runCoverageByPrompt.get(v.prompt_version_id);
        totalRuns += cov?.runCount ?? 0;
        totalImages += cov?.uniqueSamples ?? 0;
        const avg = runAvgByPrompt.get(v.prompt_version_id);
        if (avg && avg.totalImages > 0) {
          pSum += avg.precision * avg.totalImages;
          rSum += avg.recall * avg.totalImages;
          f1Sum += avg.f1 * avg.totalImages;
          weightSum += avg.totalImages;
        }
      }
      g.groupRollup = {
        precision: weightSum > 0 ? pSum / weightSum : null,
        recall: weightSum > 0 ? rSum / weightSum : null,
        f1: weightSum > 0 ? f1Sum / weightSum : null,
        runCount: totalRuns,
        uniqueImages: totalImages,
      };
    }
    return [...groups.values()].sort(
      (a, b) => +new Date(b.newestCreatedAt) - +new Date(a.newestCreatedAt)
    );
  }, [prompts, groupMetadata, runBestByPrompt, runAvgByPrompt, runCoverageByPrompt]);

  const filteredGroups = useMemo(() => {
    const q = promptSearch.trim().toLowerCase();
    if (!q) return promptGroups;
    return promptGroups.filter((g) => {
      if (g.baseName.toLowerCase().includes(q)) return true;
      return g.versions.some((v) => v.version_label.toLowerCase().includes(q));
    });
  }, [promptGroups, promptSearch]);

  const anyGroupExpanded = useMemo(
    () => filteredGroups.some((g) => expandedGroupKeys.has(g.baseNameKey)),
    [filteredGroups, expandedGroupKeys],
  );

  const groupTopMetrics = useMemo(() => {
    let pKey: string | null = null;
    let rKey: string | null = null;
    let f1Key: string | null = null;
    let pVal = -Infinity;
    let rVal = -Infinity;
    let f1Val = -Infinity;
    for (const g of filteredGroups) {
      const r = g.groupRollup;
      if (!r) continue;
      if (r.precision != null && r.precision > pVal) {
        pVal = r.precision;
        pKey = g.baseNameKey;
      }
      if (r.recall != null && r.recall > rVal) {
        rVal = r.recall;
        rKey = g.baseNameKey;
      }
      if (r.f1 != null && r.f1 > f1Val) {
        f1Val = r.f1;
        f1Key = g.baseNameKey;
      }
    }
    return { pKey, rKey, f1Key };
  }, [filteredGroups]);

  const versionTopMetrics = useMemo(() => {
    let pId: string | null = null;
    let rId: string | null = null;
    let f1Id: string | null = null;
    let pVal = -Infinity;
    let rVal = -Infinity;
    let f1Val = -Infinity;
    for (const g of filteredGroups) {
      if (!expandedGroupKeys.has(g.baseNameKey)) continue;
      for (const v of g.versions) {
        const best = runBestByPrompt.get(v.prompt_version_id);
        if (!best) continue;
        if (best.precision > pVal) {
          pVal = best.precision;
          pId = v.prompt_version_id;
        }
        if (best.recall > rVal) {
          rVal = best.recall;
          rId = v.prompt_version_id;
        }
        if (best.f1 > f1Val) {
          f1Val = best.f1;
          f1Id = v.prompt_version_id;
        }
      }
    }
    return { pId, rId, f1Id };
  }, [filteredGroups, expandedGroupKeys, runBestByPrompt]);

  const approvedVersionLabel = useMemo(() => {
    const id = selectedDetection?.approved_prompt_version;
    if (!id) return null;
    const p = prompts.find((v) => v.prompt_version_id === id);
    if (!p) return null;
    const eligible = approvalEligibilityByPrompt.get(id)?.eligible;
    return { label: p.version_label, eligible: Boolean(eligible) };
  }, [selectedDetection?.approved_prompt_version, prompts, approvalEligibilityByPrompt]);

  const selectedVersionLabel = useMemo(() => {
    if (!selectedPromptId) return null;
    return prompts.find((p) => p.prompt_version_id === selectedPromptId)?.version_label || null;
  }, [selectedPromptId, prompts]);

  const PROMPT_GRID_COLS = "grid-cols-[minmax(0,1fr)_56px_64px_64px_64px_64px_88px_160px]";

  // Called directly from JSX (not passed as a prop to a memoized child), so
  // wrapping in useCallback would provide no perf benefit and would require
  // hoisting setApprovedPrompt/etc. to avoid TDZ in the deps array.
  const renderVersionRow = (
    p: PromptVersion,
    topMetrics: { p: boolean; r: boolean; f1: boolean },
    inGroupEdit: boolean,
  ) => {
    const eligibility = approvalEligibilityByPrompt.get(p.prompt_version_id);
    const isApproved = selectedDetection?.approved_prompt_version === p.prompt_version_id;
    const showApproved = isApproved && !!eligibility?.eligible;
    const perf = runBestByPrompt.get(p.prompt_version_id);
    const coverage = runCoverageByPrompt.get(p.prompt_version_id);
    const isSelected = p.prompt_version_id === selectedPromptId;
    const parsed = parseVersionLabel(p.version_label);
    const displayName = parsed.num != null ? `Version ${parsed.num}` : p.version_label;
    const checked = groupSelectedVersionIds.has(p.prompt_version_id);
    return (
      <div
        key={p.prompt_version_id}
        onClick={() => {
          if (inGroupEdit) {
            setGroupSelectedVersionIds((prev) => {
              const next = new Set(prev);
              if (next.has(p.prompt_version_id)) next.delete(p.prompt_version_id);
              else next.add(p.prompt_version_id);
              return next;
            });
            return;
          }
          setSelectedPromptId(p.prompt_version_id);
        }}
        className={`grid ${PROMPT_GRID_COLS} items-center gap-x-2 border-t border-white/5 px-3 py-2 text-xs transition-colors cursor-pointer hover:bg-white/[0.02] group ${
          isSelected ? "bg-white/5 shadow-[inset_3px_0_0_rgb(52,211,153)]" : ""
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 pl-6">
          {inGroupEdit && (
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setGroupSelectedVersionIds((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(p.prompt_version_id);
                  else next.delete(p.prompt_version_id);
                  return next;
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
              aria-label={`Select ${displayName}`}
            />
          )}
          <span className="truncate text-gray-200">{displayName}</span>
          {p.mode === "PRODUCTION_MODE" && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                p.provenance_kind === "modified_replication"
                  ? "bg-amber-600/20 text-amber-300"
                  : "bg-emerald-600/20 text-emerald-300"
              }`}
              title={
                p.provenance_kind === "modified_replication"
                  ? "Modified production replication"
                  : "Exact production replication"
              }
            >
              {p.provenance_kind === "modified_replication" ? "Mod replica" : "Prod replica"}
            </span>
          )}
          {isApproved && !showApproved && (
            <span className="shrink-0 text-[10px] text-yellow-400">APPROVAL_INVALID</span>
          )}
        </div>
        <div className="text-xs text-gray-400 text-right tabular-nums">{coverage?.runCount ?? 0}</div>
        <div className="text-xs text-gray-400 text-right tabular-nums">{coverage?.uniqueSamples ?? 0}</div>
        <div className={`text-xs text-right tabular-nums ${topMetrics.p ? "text-emerald-300" : "text-gray-200"}`}>
          {perf ? `${(perf.precision * 100).toFixed(0)}%` : "—"}
        </div>
        <div className={`text-xs text-right tabular-nums ${topMetrics.r ? "text-emerald-300" : "text-gray-200"}`}>
          {perf ? `${(perf.recall * 100).toFixed(0)}%` : "—"}
        </div>
        <div className="text-xs text-right tabular-nums">
          {perf ? (
            <span className={topMetrics.f1 ? "text-emerald-300" : "text-gray-200"}>
              {(perf.f1 * 100).toFixed(0)}%
            </span>
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </div>
        <div className="text-xs text-gray-500 text-right tabular-nums">
          {new Date(p.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
        <div className="flex items-center justify-between gap-2 pl-4">
          <div>
            {isApproved ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setApprovedPrompt(null);
                }}
                className="rounded px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10"
                title="Unapprove"
              >
                Approved
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setApprovedPrompt(p.prompt_version_id);
                }}
                disabled={!eligibility?.eligible}
                title={eligibility?.reason || "Not eligible"}
                className="rounded px-2 py-0.5 text-[11px] text-gray-300 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Approve
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEditFromVersion(p.prompt_version_id);
              }}
              className="hidden group-hover:inline-flex items-center rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
              title="Edit (creates next version)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deletePromptVersion(p.prompt_version_id);
              }}
              className="hidden group-hover:inline-flex items-center rounded p-1 text-gray-400 hover:bg-red-500/15 hover:text-red-300"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const setApprovedPrompt = async (promptVersionId: string | null) => {
    if (!selectedDetection) return;
    let overrideReason: string | null = null;
    if (promptVersionId) {
      const eligibility = approvalEligibilityByPrompt.get(promptVersionId);
      if (!eligibility?.eligible) {
        // Allow approving a complex detection below thresholds with a recorded justification.
        const entered =
          typeof window !== "undefined"
            ? window.prompt(
                `${eligibility?.reason || "This prompt has not met the held-out eval thresholds."}\n\nTo approve it anyway, enter a justification (saved as the detection's known failure-mode note). Leave blank to cancel:`
              )
            : null;
        if (!entered || !entered.trim()) {
          notify({ message: eligibility?.reason || "Prompt is not eligible for approval yet.", tone: "warning" });
          return;
        }
        overrideReason = entered.trim();
      }
    }

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
        decision_rubric: selectedDetection.decision_rubric,
        metric_thresholds: selectedDetection.metric_thresholds,
        approved_prompt_version: promptVersionId,
        ...(overrideReason ? { approval_override_reason: overrideReason } : {}),
      }),
    });
    const payload = await safeJsonObject<{ error?: string }>(res);
    if (!res.ok) {
      notify({ message: payload?.error || "Failed to update approved prompt.", tone: "error" });
      return;
    }
    if (overrideReason) {
      notify({ message: "Approved with a threshold override. Justification saved to the detection.", tone: "success" });
    }
    await refreshAll();
  };

  const quickTestPreviewByName = useMemo(() => {
    const map = new Map<string, number>();
    quickTestFiles.forEach((f, idx) => {
      if (!map.has(f.file.name)) map.set(f.file.name, idx);
    });
    return map;
  }, [quickTestFiles]);
  const currentQuickPreviewResult =
    quickTestPreviewIndex != null && quickTestFiles[quickTestPreviewIndex]
      ? quickTestResults.find((r) => r.image_name === quickTestFiles[quickTestPreviewIndex].file.name) || null
      : null;

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.prompt_version_id === selectedPromptId) || null,
    [prompts, selectedPromptId]
  );
  const activePromptForTopPanel = selectedPrompt || prompts[0] || null;
  const activeIsProduction = activePromptForTopPanel?.mode === "PRODUCTION_MODE";
  const activeExecutionMode = activeIsProduction ? "Production Replication" : "Development";
  const activeTargetDescription =
    (activePromptForTopPanel?.composition as PromptComposition | undefined)?.members?.find((m) => m.is_target)
      ?.description || "";
  const activePromptStructure = promptStructureOf(activePromptForTopPanel);
  const activePromptPolicy =
    activePromptStructure.label_policy || selectedDetection?.label_policy || "";
  const activePromptRubricText: string =
    activePromptStructure.decision_rubric ||
    (selectedDetection?.decision_rubric || []).map((r, i) => `${i + 1}. ${r}`).join("\n");
  const draftCategory =
    mode === "view" ? (selectedDetection?.detection_category || DEFAULT_DETECTION_CATEGORY) : form.detection_category;
  const currentCategoryTemplates = useMemo(
    () => getCategoryTemplates(draftCategory),
    [draftCategory, getCategoryTemplates]
  );
  const promptEditorSyncDepsKey = useMemo(
    () =>
      JSON.stringify({
        promptVersionId: activePromptForTopPanel?.prompt_version_id || "",
        versionLabel: activePromptForTopPanel?.version_label || "",
        systemPrompt: activePromptForTopPanel?.system_prompt || currentCategoryTemplates.system_prompt,
        userPromptTemplate:
          activePromptForTopPanel?.user_prompt_template ||
          buildUserPromptTemplate(currentCategoryTemplates.user_prompt_template, selectedDetection?.user_prompt_addendum || ""),
        detectionIdentity: activePromptStructure.detection_identity || "",
        outputSchema: activePromptStructure.output_schema || "",
        examples: activePromptStructure.examples || "",
        userPromptAddendum:
          activePromptStructure.user_prompt_addendum ||
          selectedDetection?.user_prompt_addendum ||
          "",
        policy: activePromptPolicy,
        rubric: activePromptRubricText,
        model: activePromptForTopPanel?.model || "gemini-2.5-flash",
        temperature: activePromptForTopPanel?.temperature ?? 0,
        topP: activePromptForTopPanel?.top_p ?? 1,
        maxOutputTokens: activePromptForTopPanel?.max_output_tokens ?? 1024,
        changeNotes: activePromptForTopPanel?.change_notes || "",
        detectionId: selectedDetection?.detection_id || "",
        detectionCode: selectedDetection?.detection_code || "",
        promptsLength: prompts.length,
      }),
    [
      activePromptForTopPanel,
      activePromptPolicy,
      activePromptRubricText,
      currentCategoryTemplates.system_prompt,
      currentCategoryTemplates.user_prompt_template,
      selectedDetection?.detection_id,
      selectedDetection?.detection_code,
      selectedDetection?.user_prompt_addendum,
      prompts.length,
    ]
  );
  const compiledPromptPreview = useMemo(() => {
    const detectionCode = mode === "view"
      ? selectedDetection?.detection_code || ""
      : form.detection_code || selectedDetection?.detection_code || "";
    if (!detectionCode) return "";

    let systemPrompt = "";
    let userTemplate = "";
    let policy = "";
    let rubric = "";
    let fixedGuidance = "";

    if (mode === "create") {
      systemPrompt = currentCategoryTemplates.system_prompt || "";
      userTemplate = buildUserPromptTemplate(currentCategoryTemplates.user_prompt_template, form.user_prompt_addendum);
      policy = (form.label_policy || "").trim();
      rubric = form.decision_rubric.filter((r) => r.trim()).map((r, i) => `${i + 1}. ${r.trim()}`).join("\n");
    } else if (mode === "edit") {
      systemPrompt = currentCategoryTemplates.system_prompt || "";
      userTemplate = buildUserPromptTemplate(currentCategoryTemplates.user_prompt_template, form.user_prompt_addendum);
      policy = (form.label_policy || "").trim();
      rubric = form.decision_rubric.filter((r) => r.trim()).map((r, i) => `${i + 1}. ${r.trim()}`).join("\n");
      fixedGuidance = (promptStructureOf(editPromptSource).fixed_guidance || "").trim();
    } else {
      const promptForRun = selectedPrompt || activePromptForTopPanel;
      if (!promptForRun) return "";
      const promptForRunStructure = promptStructureOf(promptForRun);
      systemPrompt = promptForRun.system_prompt || "";
      userTemplate = promptForRun.user_prompt_template || "";
      policy = (promptForRunStructure.label_policy || activePromptPolicy || "").trim();
      rubric = (promptForRunStructure.decision_rubric || activePromptRubricText || "").trim();
      fixedGuidance = (promptForRunStructure.fixed_guidance || "").trim();
    }

    const compiledUser = compileUserPrompt({
      userTemplate,
      detectionCode,
      fixedGuidance,
      labelPolicy: policy,
      decisionRubric: rubric,
    });

    return [
      `System Prompt:\n${systemPrompt}`.trim(),
      `User Prompt (Compiled):\n${compiledUser}`.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [
    mode,
    form.detection_code,
    form.label_policy,
    form.user_prompt_addendum,
    form.decision_rubric,
    selectedDetection,
    selectedPrompt,
    activePromptForTopPanel,
    activePromptPolicy,
    activePromptRubricText,
    currentCategoryTemplates,
    editPromptSource,
  ]);

  // For a PRODUCTION_MODE version the compiled preview must be the exact
  // aggregate that runs in production (preamble + numbered member blocks, no
  // system prompt), reconstructed from the version's frozen snapshot + composition.
  const [prodAggPreview, setProdAggPreview] = useState<string | null>(null);
  useEffect(() => {
    const p = selectedPrompt || activePromptForTopPanel;
    const comp = p?.composition as PromptComposition | undefined;
    if (mode !== "view" || !p || p.mode !== "PRODUCTION_MODE" || !p.production_snapshot_id || !comp) {
      setProdAggPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/contexts/snapshot?snapshot_id=${encodeURIComponent(p.production_snapshot_id!)}`
        );
        const data = await res.json();
        const snap = data?.snapshot as ProductionSnapshot | undefined;
        if (cancelled) return;
        if (!snap) {
          setProdAggPreview(null);
          return;
        }
        setProdAggPreview(
          compileAggregatePrompt(
            comp.preamble ?? extractPreamble(snap.built_prompt),
            comp.members.filter((m) => m.enabled).map((m) => ({ label: m.label, description: m.description }))
          )
        );
      } catch {
        if (!cancelled) setProdAggPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedPrompt, activePromptForTopPanel]);

  useEffect(() => {
    const nextDraft = {
      version_label: activePromptForTopPanel ? `${activePromptForTopPanel.version_label}-rev` : `v${prompts.length + 1}.0`,
      system_prompt:
        activePromptForTopPanel?.system_prompt ||
        currentCategoryTemplates.system_prompt,
      user_prompt_template:
        activePromptForTopPanel?.user_prompt_template ||
        buildUserPromptTemplate(currentCategoryTemplates.user_prompt_template, selectedDetection?.user_prompt_addendum || ""),
      prompt_structure: {
        detection_identity: activePromptStructure.detection_identity || "",
        label_policy: activePromptPolicy,
        decision_rubric: activePromptRubricText,
        user_prompt_addendum:
          activePromptStructure.user_prompt_addendum ||
          selectedDetection?.user_prompt_addendum ||
          "",
        output_schema:
          activePromptStructure.output_schema ||
          (selectedDetection
            ? `{"detection_code":"${selectedDetection.detection_code}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`
            : ""),
        examples: activePromptStructure.examples || "",
      },
      model: activePromptForTopPanel?.model || "gemini-2.5-flash",
      temperature: activePromptForTopPanel?.temperature ?? 0,
      top_p: activePromptForTopPanel?.top_p ?? 1,
      max_output_tokens: activePromptForTopPanel?.max_output_tokens ?? 1024,
      change_notes: activePromptForTopPanel?.change_notes || "",
    };
    const nextDraftKey = JSON.stringify(nextDraft);
    if (promptEditorDraftKeyRef.current === nextDraftKey) return;
    promptEditorDraftKeyRef.current = nextDraftKey;

    setLabelPolicySections(parseLabelPolicySections(nextDraft.prompt_structure.label_policy));
    setDecisionRubricCriteria(parseDecisionRubricCriteria(nextDraft.prompt_structure.decision_rubric));
  }, [promptEditorSyncDepsKey, activePromptForTopPanel, activePromptPolicy, activePromptRubricText, currentCategoryTemplates, prompts.length, selectedDetection]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header Actions */}
      {mode === "view" && (
        <div className="flex flex-col gap-4 px-2 pt-1 pb-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="app-page-title">Detection Setup</h2>
            <p className="app-page-copy">
              Define detection behavior, inspect the active prompt version, and manage prompt revisions used across your evaluation workflow.
            </p>
          </div>
          <div className="flex gap-2 lg:pt-1">
            <button onClick={startCreate} className="app-btn app-btn-primary app-btn-lg text-sm">
              New Detection
            </button>
          </div>
        </div>
      )}

      {/* Create/Edit Form */}
      {mode !== "view" && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="app-page-title">{mode === "create" ? "Create Detection" : editingFromVersionRow ? "Edit Prompt Version" : "Edit Detection"}</h3>
              <p className="app-section-copy mt-1">
                {mode === "create"
                  ? "Define rule templates, guidelines, and metrics baseline parameters."
                  : editingFromVersionRow
                  ? "Detection metadata is locked in this view. Edit the label policy, decision rubric, or addendum to save a new prompt version."
                  : "Update detection metadata and create a new prompt version when policy, rubric, or addendum changes."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => { setEditingFromVersionRow(false); setMode("view"); }}
                className="app-btn app-btn-subtle app-btn-md text-sm"
              >
                Cancel
              </button>
              <button
                onClick={mode === "create" ? handleCreateDetection : handleUpdateDetection}
                disabled={savingPrompt}
                className="app-btn app-btn-primary app-btn-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingPrompt
                  ? (mode === "create" ? "Saving…" : "Saving Changes…")
                  : (mode === "create" ? "Save Detection" : "Save Changes")}
              </button>
            </div>
          </div>

          {mode === "create" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => setCreateMode("blank")}
                  className={`relative text-left rounded-2xl border px-5 py-5 transition-colors ${
                    createMode === "blank"
                      ? "border-[#5cb8ff] bg-[rgba(35,74,108,0.14)] shadow-[0_0_0_1px_rgba(92,184,255,0.5)]"
                      : "border-white/10 bg-[rgba(6,13,20,0.68)] hover:bg-[rgba(10,20,31,0.94)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold text-white">Blank Template</div>
                    <span
                      className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                        createMode === "blank"
                          ? "border-[#5cb8ff] bg-[#5cb8ff]"
                          : "border-white/40"
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-sm leading-snug text-[var(--app-text-muted)]">
                    Author prompts, attributes, policy frameworks, and scoring benchmarks manually.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("assist")}
                  className={`relative text-left rounded-2xl border px-5 py-5 transition-colors ${
                    createMode === "assist"
                      ? "border-[#5cb8ff] bg-[rgba(35,74,108,0.14)] shadow-[0_0_0_1px_rgba(92,184,255,0.5)]"
                      : "border-white/10 bg-[rgba(6,13,20,0.68)] hover:bg-[rgba(10,20,31,0.94)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold text-white">Prompt Assist</div>
                    <span
                      className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                        createMode === "assist"
                          ? "border-[#5cb8ff] bg-[#5cb8ff]"
                          : "border-white/40"
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-sm leading-snug text-[var(--app-text-muted)]">
                    Input simple natural language parameters and auto-generate complex system criteria models.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("mirror")}
                  className={`relative text-left rounded-2xl border px-5 py-5 transition-colors ${
                    createMode === "mirror"
                      ? "border-[#5cb8ff] bg-[rgba(35,74,108,0.14)] shadow-[0_0_0_1px_rgba(92,184,255,0.5)]"
                      : "border-white/10 bg-[rgba(6,13,20,0.68)] hover:bg-[rgba(10,20,31,0.94)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-base font-semibold text-white">Production Replication</div>
                    <span
                      className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                        createMode === "mirror"
                          ? "border-[#5cb8ff] bg-[#5cb8ff]"
                          : "border-white/40"
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-sm leading-snug text-[var(--app-text-muted)]">
                    Bind this detection to a real production context and author it inside the production aggregate.
                  </div>
                </button>
              </div>

              {createMode === "assist" && (
                <div className="rounded-2xl border border-[rgba(92,184,255,0.4)] bg-[rgba(10,25,45,0.35)] p-5 space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5cb8ff]">
                    Describe the detection
                  </div>
                  <textarea
                    className="app-textarea h-24 px-3 py-2 text-sm"
                    value={assistInput}
                    onChange={(e) => setAssistInput(e.target.value)}
                    placeholder="Example: Detect severe rusting on exposed exterior plumbing and joints..."
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={generateWithPromptAssist}
                      disabled={assistLoading}
                      className="text-sm font-semibold text-[#5cb8ff] hover:text-[#8ed8ff] disabled:opacity-55"
                    >
                      {assistLoading ? "Generating..." : "Generate with Prompt Assist"}
                    </button>
                    {assistError && <span className="text-xs text-red-400">{assistError}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="app-card-strong space-y-4 p-6">
            <h4 className="text-lg font-semibold text-white">Detection Template</h4>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Detection Code</label>
                <input
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm disabled:opacity-50"
                  value={form.detection_code}
                  onChange={(e) => setForm({ ...form, detection_code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                  disabled={mode === "edit"}
                  placeholder="e.g. SMOKE_VISIBLE"
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Display Name</label>
                <input
                  className={INPUT_CLS}
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="e.g. Visible Smoke Detection"
                  disabled={mode === "edit" || editingFromVersionRow}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Detection Category</label>
                <select
                  className={INPUT_CLS}
                  value={form.detection_category}
                  onChange={(e) =>
                    setForm({ ...form, detection_category: e.target.value as DetectionCategory })
                  }
                  disabled={mode === "edit" || editingFromVersionRow}
                >
                  {DETECTION_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {mode === "create" && (
              <div>
                <label className={LABEL_CLS}>Version Name</label>
                <input
                  className={INPUT_CLS}
                  value={mode === "create" ? createVersionName : editVersionName}
                  onChange={(e) =>
                    mode === "create" ? setCreateVersionName(e.target.value) : setEditVersionName(e.target.value)
                  }
                  placeholder="Detection baseline"
                />
                {(() => {
                  const rawName = (mode === "create" ? createVersionName : editVersionName) || "";
                  const base = rawName.trim() || "Detection baseline";
                  const existing = mode === "create" ? [] : prompts.map((p) => p.version_label);
                  const num = nextVersionNumber(base, existing);
                  return (
                    <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                      Will save as{" "}
                      <span className="text-gray-300">{`${base}_V${num}`}</span>
                    </p>
                  );
                })()}
              </div>
              )}
            </div>

            {mode === "create" && createMode !== "mirror" && (
            <div>
              <label className={LABEL_CLS}>Production Label (target)</label>
              <input
                className={INPUT_CLS}
                value={form.production_label}
                onChange={(e) => setForm({ ...form, production_label: e.target.value })}
                placeholder="e.g. major corrosion"
                disabled={editingFromVersionRow}
              />
              <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                The exact production label that maps to DETECTED when this detection runs inside a
                production-context aggregate. Leave blank if it has no production label yet.
              </p>
            </div>
            )}

            <div>
              <label className={LABEL_CLS}>Description</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-20 disabled:opacity-50"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                disabled={editingFromVersionRow}
              />
            </div>

            {mode === "create" && createMode === "mirror" && (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5cb8ff]">
                  Production Replication
                </div>
                <p className="text-xs text-[var(--app-text-muted)]">
                  This detection&apos;s baseline version is saved as a Production Replication bound to the selected
                  context. Pick the context and target detection, then author the target description.
                </p>
                <ProductionModePanel
                  contextNames={createMirror.contextNames}
                  selectedContext={createMirror.selectedContext}
                  onSelectContext={createMirror.selectContext}
                  snapshot={createMirror.snapshot}
                  composition={createMirror.composition}
                  provenance={createMirror.provenance}
                  ctxLoading={createMirror.ctxLoading}
                  ctxError={createMirror.ctxError}
                  targetLabel={createMirror.targetLabel}
                  onChangeTargetLabel={createMirror.changeTargetLabel}
                  memberLabels={createMirror.snapshot ? createMirror.snapshot.ordered_members.map((m) => m.label) : []}
                  targetMatched={createMirror.targetMatched}
                  targetDescription={createMirror.currentTargetDescription}
                  onEditTargetDescription={createMirror.editTargetDescription}
                  onResetTargetBaseline={createMirror.resetTargetToBaseline}
                  preamble={createMirror.currentPreamble}
                  onEditPreamble={createMirror.editPreamble}
                  onResetPreamble={createMirror.resetPreamble}
                  onToggleMember={createMirror.toggleMember}
                  onToggleSupport={createMirror.toggleSupport}
                  onEditMemberDescription={createMirror.editMemberDescription}
                  onAddMember={createMirror.addMember}
                  onRemoveMember={createMirror.removeMember}
                  snapshotLabels={createMirror.snapshot ? createMirror.snapshot.ordered_members.map((m) => m.label) : []}
                  compiledPreview={createMirror.compiledPreview}
                />
              </div>
            )}

            {mode === "create" && createMode !== "mirror" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>System Prompt</label>
              <div className="app-card w-full px-3 py-2 text-sm min-h-24 whitespace-pre-wrap text-[var(--app-text)]">
                {currentCategoryTemplates.system_prompt}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">Managed in Admin by detection category.</div>
            </div>
            <div>
              <label className={LABEL_CLS}>User Prompt</label>
              <div className="app-card w-full px-3 py-2 text-sm min-h-32 whitespace-pre-wrap text-[var(--app-text)]">
                {currentCategoryTemplates.user_prompt_template || "No user prompt template."}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">Base template is Admin-managed. Detection-specific guidance goes in the addendum below.</div>
            </div>
          </div>
          )}

          {mode === "create" && createMode !== "mirror" && (
          <div>
            <label className={LABEL_CLS}>User Prompt Addendum</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm min-h-[6rem] resize-none overflow-hidden"
              value={form.user_prompt_addendum}
              onChange={(e) => {
                setForm({ ...form, user_prompt_addendum: e.target.value });
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
              placeholder="Optional detection-specific guidance appended to the category user prompt."
            />
          </div>
          )}

          {mode === "create" && createMode !== "mirror" && (showLabelPolicy ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400 block">Decision Policy</label>
                <button
                  type="button"
                  onClick={removeLabelPolicySection}
                  className="text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
                  <span className="text-xs text-gray-500 mt-2">DETECTED:</span>
                  <input
                    type="text"
                    className={INPUT_CLS}
                    value={formLabelPolicySections.detected}
                    onChange={(e) => updateFormLabelPolicySection("detected", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
                  <span className="text-xs text-gray-500 mt-2">NOT DETECTED:</span>
                  <input
                    type="text"
                    className={INPUT_CLS}
                    value={formLabelPolicySections.notDetected}
                    onChange={(e) => updateFormLabelPolicySection("notDetected", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={addLabelPolicySection}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add Decision Policy
              </button>
            </div>
          ))}

          {mode === "create" && createMode !== "mirror" && (showDecisionRubric ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-400 block">Decision Rubric (3-7 criteria)</label>
                <button
                  type="button"
                  onClick={removeDecisionRubricSection}
                  className="text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
              {form.decision_rubric.map((r, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <span className="text-xs text-gray-500 mt-2">{i + 1}.</span>
                  <input
                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm"
                    value={r}
                    onChange={(e) => {
                      const rubric = [...form.decision_rubric];
                      rubric[i] = e.target.value;
                      setForm({ ...form, decision_rubric: rubric });
                    }}
                  />
                  {form.decision_rubric.length > 1 && (
                    <button
                      onClick={() => setForm({ ...form, decision_rubric: form.decision_rubric.filter((_, j) => j !== i) })}
                      className="text-gray-500 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {form.decision_rubric.length < 7 && (
                <button
                  onClick={() => setForm({ ...form, decision_rubric: [...form.decision_rubric, ""] })}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  + Add criterion
                </button>
              )}
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={addDecisionRubricSection}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add Decision Rubric
              </button>
            </div>
          ))}

          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs text-gray-400 block">Image Attributes (optional)</label>
              <InfoTip label="What are image attributes?">
                Use attributes to tag conditions that can change model performance or hide the target, such as
                `snow_on_ground`, `dark_image`, `blurry_image`, `glare`, or `partial_view`. Pick reusable tags that
                help you balance datasets and compare results by slice later.
              </InfoTip>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">
              Define reusable tags for conditions, quality issues, and edge cases you want represented and measured.
            </p>
            {editingFromVersionRow ? (
              form.segment_taxonomy.filter((s) => s.trim()).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.segment_taxonomy.filter((s) => s.trim()).map((segment) => (
                    <span key={segment} className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-gray-200">
                      {segment}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500">No image attributes configured.</div>
              )
            ) : (
              <>
            {form.segment_taxonomy.map((segment, index) => (
              <div
                key={`segment_${index}`}
                className={`flex gap-2 mb-2 items-center rounded ${
                  segmentDropTargetIndex === index && draggingSegmentIndex !== index
                    ? "ring-1 ring-blue-500"
                    : ""
                } ${draggingSegmentIndex === index ? "opacity-50" : ""}`}
                onDragOver={(e) => {
                  if (draggingSegmentIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (segmentDropTargetIndex !== index) setSegmentDropTargetIndex(index);
                }}
                onDragLeave={() => {
                  if (segmentDropTargetIndex === index) setSegmentDropTargetIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = draggingSegmentIndex;
                  setSegmentDropTargetIndex(null);
                  setDraggingSegmentIndex(null);
                  if (from === null || from === index) return;
                  const next = [...form.segment_taxonomy];
                  const [moved] = next.splice(from, 1);
                  next.splice(index, 0, moved);
                  setForm({ ...form, segment_taxonomy: next });
                }}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(index));
                    setDraggingSegmentIndex(index);
                  }}
                  onDragEnd={() => {
                    setDraggingSegmentIndex(null);
                    setSegmentDropTargetIndex(null);
                  }}
                  className="cursor-grab select-none text-gray-500 hover:text-gray-300 text-sm px-1"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >
                  ⋮⋮
                </span>
                <span className="text-xs text-gray-500 mt-2 w-4">{index + 1}.</span>
                <input
                  className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm"
                  value={segment}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const next = [...form.segment_taxonomy];
                    if (raw.includes(",")) {
                      // Bulk entry: split on commas, commit all but the last part as new rows.
                      const parts = raw.split(",");
                      const tail = parts.pop() ?? "";
                      const additions = parts.map((p) => p.trim()).filter(Boolean);
                      next.splice(index, 1, ...additions, tail);
                    } else {
                      next[index] = raw;
                    }
                    setForm({ ...form, segment_taxonomy: next });
                  }}
                  placeholder="e.g. dark_image, blurry_image (comma-separated)"
                />
                {form.segment_taxonomy.length > 1 && (
                  <button
                    onClick={() =>
                      setForm({
                        ...form,
                        segment_taxonomy: form.segment_taxonomy.filter((_, i) => i !== index),
                      })
                    }
                    className="text-gray-500 hover:text-red-400 text-xs"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setForm({ ...form, segment_taxonomy: [...form.segment_taxonomy, ""] })}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + Add attribute
            </button>
              </>
            )}
          </div>

          {mode === "create" && createMode !== "mirror" && (
          <details className="app-card p-3">
            <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">
              Compiled Prompt Preview (used at run time)
            </summary>
            <pre className="mt-2 text-xs font-mono whitespace-pre-wrap text-gray-300 bg-gray-950/50 border border-gray-800 rounded p-3 max-h-72 overflow-auto">
              {compiledPromptPreview || "Set detection code and prompt content to preview the compiled prompt."}
            </pre>
          </details>
          )}

          {mode === "create" && (
            <div className="space-y-3">
              <label className="text-xs text-gray-400 block">Metric Thresholds</label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="text-xs text-gray-500">Primary Metric</label>
                  <select
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm mt-1"
                    value={form.metric_thresholds.primary_metric}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metric_thresholds: { ...form.metric_thresholds, primary_metric: e.target.value as PrimaryMetric },
                      })
                    }
                  >
                    <option value="precision">Precision</option>
                    <option value="recall">Recall</option>
                    <option value="f1">F1</option>
                  </select>
                </div>
                {(["min_precision", "min_recall", "min_f1"] as const).map((key) => (
                  <div key={key}>
                    <label className="text-xs text-gray-500">{key.replace("min_", "Min ")}</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm mt-1"
                      value={form.metric_thresholds[key] ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          metric_thresholds: { ...form.metric_thresholds, [key]: parseFloat(e.target.value) || undefined },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>

          {savingPrompt && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <span className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Generating AI change summary and adding to Version Notes…
              </span>
            </div>
          )}
        </div>
      )}

      {/* Prompt Version Editor (full page) */}
      {mode === "view" && selectedDetection && showPromptForm && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="app-kicker mb-1">Detection Setup</div>
              <h3 className="app-page-title">New Prompt Version</h3>
              <p className="mt-1 text-sm text-[var(--app-text-muted)]">{selectedDetection.display_name}</p>
            </div>
            <button
              onClick={() => setShowPromptForm(false)}
              className="app-btn app-btn-subtle app-btn-md whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
          <PromptForm
            key={promptFormInitialData?.prompt_version_id || "new"}
            detectionId={selectedDetection.detection_id}
            detectionCode={selectedDetection.detection_code}
            detectionCategory={selectedDetection.detection_category}
            detectionLabelPolicy={selectedDetection.label_policy}
            detectionDecisionRubric={selectedDetection.decision_rubric}
            userPromptAddendum={selectedDetection.user_prompt_addendum}
            productionLabel={selectedDetection.production_label ?? null}
            adminPromptSettings={adminPromptSettings}
            suggestedVersionLabel={promptFormSuggestedVersionLabel}
            existingVersionLabels={prompts.map((p) => p.version_label)}
            defaultVersionBaseName={
              parseVersionLabel(
                prompts.find((p) => p.prompt_version_id === promptFormInitialData?.prompt_version_id)
                  ?.version_label || ""
              ).base || "Detection baseline"
            }
            initialData={promptFormInitialData}
            onSaved={() => {
              setShowPromptForm(false);
              loadRelated();
              triggerRefresh();
            }}
          />
        </div>
      )}

      {/* Detection Details View */}
      {mode === "view" && selectedDetection && !showPromptForm && (
        <>
          <div className="app-card-strong p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="max-w-4xl">
                <div className="app-kicker mb-2">Detection Configuration</div>
                <h3 className="text-xl font-semibold text-white">{selectedDetection.display_name}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
                  {selectedDetection.description}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {selectedDetection.approved_prompt_version &&
                  approvedPromptIsEligible &&
                  selectedPromptId === selectedDetection.approved_prompt_version && (
                    <span className="whitespace-nowrap rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                      Approved prompt
                    </span>
                  )}
                <button
                  onClick={() => {
                    if (showPromptForm) {
                      setShowPromptForm(false);
                      return;
                    }
                    openNewPromptForm();
                  }}
                  className="app-btn app-btn-subtle app-btn-md whitespace-nowrap"
                >
                  {showPromptForm ? "Cancel" : "New Prompt Version"}
                </button>
                <button
                  onClick={startEdit}
                  className="app-btn app-btn-subtle app-btn-md whitespace-nowrap"
                >
                  Edit Detection
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-6 border-t border-white/8 pt-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)] xl:items-start">
                <div className="grid grid-cols-2 gap-x-10 gap-y-4 min-w-0">
                  <div className="min-w-0">
                    <div className="app-label mb-1">Detection Code</div>
                    <div className="text-sm leading-6 text-gray-200 truncate">
                      {selectedDetection.detection_code}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="app-label mb-1">Version</div>
                    <div
                      className="text-sm leading-6 text-gray-200 truncate"
                      title={activePromptForTopPanel?.version_label || "Detection baseline"}
                    >
                      {activePromptForTopPanel?.version_label || "Detection baseline"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="app-label mb-1">Detection Category</div>
                    <div className="text-sm leading-6 text-gray-200 truncate">
                      {DETECTION_CATEGORY_LABELS[selectedDetection.detection_category]}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="app-label mb-1">Execution Mode</div>
                    <div className="text-sm leading-6 text-gray-200 truncate">
                      {activeExecutionMode}
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="app-label">Image Attributes</div>
                    <InfoTip label="What are image attributes?">
                      Use attributes to tag conditions that can change model performance or hide the target, such as
                      `snow_on_ground`, `dark_image`, `blurry_image`, `glare`, or `partial_view`. Pick reusable tags that
                      help you balance datasets and compare results by slice later.
                    </InfoTip>
                  </div>
                  {Array.isArray(selectedDetection.segment_taxonomy) && selectedDetection.segment_taxonomy.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDetection.segment_taxonomy.map((segment) => (
                        <span key={segment} className="rounded-xl border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-gray-200">
                          {segment}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">No image attributes configured.</div>
                  )}
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <div className="app-label mb-1">Prompt Details</div>
                  <p className="text-xs text-[var(--app-text-muted)]">
                    Expand the sections below to inspect the detection’s current prompt components and compiled runtime view.
                  </p>
                </div>

                {selectedPrompt && (
                  <PromptVersionNotesEditor
                    key={selectedPrompt.prompt_version_id}
                    promptVersionId={selectedPrompt.prompt_version_id}
                    onSaved={loadRelated}
                  />
                )}

                <details className="rounded-lg px-1 py-1">
                  <summary className="cursor-pointer list-none text-xs text-blue-300 transition-colors hover:text-blue-200">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[10px] text-blue-300/80">▶</span>
                      <span>{activeIsProduction ? "Target Detection" : "User Prompt Addendum"}</span>
                    </span>
                  </summary>
                  <div className="mt-2">
                    <div className="px-3 py-2 text-sm whitespace-pre-wrap text-[var(--app-text)]">
                      {activeIsProduction
                        ? activeTargetDescription || "No target detection description."
                        : selectedDetection.user_prompt_addendum || "No addendum."}
                    </div>
                  </div>
                </details>

                {(labelPolicySections.detected.trim() || labelPolicySections.notDetected.trim()) && (
                  <details className="rounded-lg px-1 py-1">
                    <summary className="cursor-pointer list-none text-xs text-blue-300 transition-colors hover:text-blue-200">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[10px] text-blue-300/80">▶</span>
                        <span>Decision Policy</span>
                      </span>
                    </summary>
                    <div className="mt-2 space-y-3 px-3 py-2">
                      <div className="grid grid-cols-[130px,1fr] gap-2 items-start">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
                          Detected
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-[var(--app-text)]">
                          {labelPolicySections.detected || "No DETECTED guidance."}
                        </div>
                      </div>
                      <div className="grid grid-cols-[130px,1fr] gap-2 items-start">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
                          Not Detected
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-[var(--app-text)]">
                          {labelPolicySections.notDetected || "No NOT_DETECTED guidance."}
                        </div>
                      </div>
                    </div>
                  </details>
                )}

                {decisionRubricCriteria.length > 0 && (
                  <details className="rounded-lg px-1 py-1">
                    <summary className="cursor-pointer list-none text-xs text-blue-300 transition-colors hover:text-blue-200">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[10px] text-blue-300/80">▶</span>
                        <span>Decision Rubric</span>
                      </span>
                    </summary>
                    <div className="mt-2">
                      <ol className="list-decimal list-inside px-3 py-2 text-sm text-[var(--app-text)] space-y-1">
                        {decisionRubricCriteria.map((r, i) => <li key={i}>{r}</li>)}
                      </ol>
                    </div>
                  </details>
                )}

                <details className="rounded-lg px-1 py-1">
                  <summary className="cursor-pointer list-none text-xs text-blue-300 transition-colors hover:text-blue-200">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[10px] text-blue-300/80">▶</span>
                      <span>Compiled Prompt Preview (used at run time)</span>
                    </span>
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-[#09111a]/80 p-3 text-xs font-mono text-gray-300">
                    {(prodAggPreview ?? compiledPromptPreview) || "Select a prompt version to view the compiled prompt."}
                  </pre>
                </details>
              </div>
            </div>
          </div>

          {/* Quick Test */}
          <div className="app-card-strong p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-medium">Quick Test (up to 10 images)</h3>
                <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                  Test the selected prompt on a small image set for quick feedback.
                </p>
              </div>
              <div className="text-xs text-[var(--app-text-muted)]">
                Prompt:{" "}
                <span className="text-gray-300">
                  {prompts.find((p) => p.prompt_version_id === selectedPromptId)?.version_label || "None selected"}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input
                    id="quick-test-files-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickQuickTestFiles}
                    disabled={quickTesting}
                    className="hidden"
                  />
                  <label
                    htmlFor="quick-test-files-input"
                    className={`app-btn app-btn-secondary ${
                      quickTesting ? "pointer-events-none opacity-50" : "cursor-pointer"
                    }`}
                  >
                    Choose Files
                  </label>
                  <span className="text-xs text-gray-500 min-w-32">
                    {quickTestFiles.length > 0 ? `${quickTestFiles.length} Files Selected` : "Choose Files"}
                  </span>
                </div>
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    onClick={runQuickTest}
                    disabled={quickTesting || quickTestFiles.length === 0 || !selectedPromptId}
                    className="app-btn app-btn-subtle app-btn-md disabled:opacity-50"
                  >
                    {quickTesting ? "Running..." : "Run Quick Test"}
                  </button>
                  <button
                    onClick={resetQuickTest}
                    disabled={quickTesting || (quickTestFiles.length === 0 && quickTestResults.length === 0)}
                    className="app-btn app-btn-subtle app-btn-md disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {quickTestError && (
                <div className="rounded-2xl border border-[rgba(255,123,136,0.22)] bg-[rgba(85,24,31,0.68)] px-3 py-2 text-xs text-[var(--app-danger)]">
                  {quickTestError}
                </div>
              )}
              {quickTestProgress && (
                <div className="app-card px-3 py-2 text-xs text-[var(--app-text-muted)]">
                  {quickTestProgress}
                </div>
              )}

              {quickTestFiles.length > 0 && (
                <div className="app-table-wrap max-h-64 overflow-auto">
                  <table className="app-table app-table-fixed text-xs">
                    <colgroup>
                      <col style={{ width: "8rem" }} />
                      <col />
                      <col style={{ width: "6rem" }} />
                    </colgroup>
                    <thead className="sticky top-0">
                      <tr>
                        <th className="app-table-col-label">Preview</th>
                        <th className="app-table-col-label">File</th>
                        <th className="app-table-col-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quickTestFiles.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <img
                              src={row.preview}
                              alt={row.file.name}
                              className="w-24 h-16 object-cover rounded border border-gray-700 cursor-pointer"
                              onClick={() => setQuickTestPreviewIndex(quickTestFiles.findIndex((f) => f.id === row.id))}
                            />
                          </td>
                          <td className="text-gray-300">{row.file.name}</td>
                          <td className="app-table-col-right">
                            <button
                              onClick={() => removeQuickTestFile(row.id)}
                              disabled={quickTesting}
                              className="text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {quickTestResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-[var(--app-text-muted)]">
                      Quick Test Results ({quickTestResults.length})
                    </div>
                    <button
                      onClick={exportQuickTestToExcel}
                      className="app-btn app-btn-subtle app-btn-md text-xs"
                    >
                      Export to Excel
                    </button>
                  </div>
                  <div className="app-table-wrap max-h-[420px] overflow-auto">
                    <table className="app-table app-table-fixed text-xs">
                      <colgroup>
                        <col style={{ width: "14rem" }} />
                        <col style={{ width: "16rem" }} />
                        <col />
                        <col />
                      </colgroup>
                      <thead className="sticky top-0">
                        <tr>
                          <th className="app-table-col-label">Image</th>
                          <th className="app-table-col-label">Prediction</th>
                          <th className="app-table-col-label">Evidence</th>
                          <th className="app-table-col-label">Output</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quickTestResults.map((r, i) => (
                          <tr key={`${r.image_name}_${i}`} className="align-top">
                            <td className="text-gray-300">
                              <div className="flex items-center gap-2">
                                {quickTestPreviewByName.has(r.image_name) && (
                                  <img
                                    src={quickTestFiles[quickTestPreviewByName.get(r.image_name) || 0]?.preview}
                                    alt={r.image_name}
                                    className="w-16 h-12 object-cover rounded border border-gray-700 cursor-pointer"
                                    onClick={() => setQuickTestPreviewIndex(quickTestPreviewByName.get(r.image_name) || 0)}
                                  />
                                )}
                                <span>{r.image_name}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap">
                              <DecisionBadge decision={r.predicted_decision || "PARSE_FAIL"} />
                              <span className="ml-2 text-gray-400">
                                {typeof r.confidence === "number" ? r.confidence.toFixed(2) : "—"}
                              </span>
                              <span className={`ml-2 ${r.parse_ok ? "app-status-ok" : "app-status-fail"}`}>
                                {r.parse_ok ? "OK" : "FAIL"}
                              </span>
                              {typeof r.inference_runtime_ms === "number" && (
                                <span className="ml-2 text-gray-500">{r.inference_runtime_ms}ms</span>
                              )}
                              {Array.isArray(r.siblings) && r.siblings.length > 0 && (
                                <div className="mt-1.5">
                                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Also identified</div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {r.siblings.map((s, si) => (
                                      <span
                                        key={`${s.label}_${si}`}
                                        title={s.reasoning || undefined}
                                        className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] text-gray-300"
                                      >
                                        {s.label}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="text-gray-300">
                              <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{r.evidence || "—"}</div>
                              {!r.parse_ok && (
                                <div className="mt-1 text-[11px] text-red-300">
                                  {r.parse_error_reason || "Parse failed"}
                                </div>
                              )}
                            </td>
                            <td>
                              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words bg-black/20 rounded p-2 text-gray-300">
                                {formatQuickModelOutput(r.raw_response || "")}
                              </pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <ImagePreviewModal
                isOpen={quickTestPreviewIndex != null && !!quickTestFiles[quickTestPreviewIndex || 0]}
                imageUrl={quickTestPreviewIndex != null ? quickTestFiles[quickTestPreviewIndex]?.preview || "" : ""}
                imageAlt={quickTestPreviewIndex != null ? quickTestFiles[quickTestPreviewIndex]?.file.name || "Preview" : "Preview"}
                title="Quick Test Preview"
                subtitle={quickTestPreviewIndex != null ? quickTestFiles[quickTestPreviewIndex]?.file.name || "" : ""}
                index={quickTestPreviewIndex ?? 0}
                total={quickTestFiles.length}
                onClose={() => setQuickTestPreviewIndex(null)}
                onPrev={() => setQuickTestPreviewIndex((i) => (i == null ? null : Math.max(0, i - 1)))}
                onNext={() =>
                  setQuickTestPreviewIndex((i) => (i == null ? null : Math.min(quickTestFiles.length - 1, i + 1)))
                }
                details={
                  currentQuickPreviewResult ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Prediction:</span>
                        <DecisionBadge decision={currentQuickPreviewResult.predicted_decision || "PARSE_FAIL"} />
                        <span className="text-gray-400">
                          {typeof currentQuickPreviewResult.confidence === "number" ? currentQuickPreviewResult.confidence.toFixed(2) : "—"}
                        </span>
                        <span className={currentQuickPreviewResult.parse_ok ? "app-status-ok" : "app-status-fail"}>
                          {currentQuickPreviewResult.parse_ok ? "OK" : "FAIL"}
                        </span>
                      </div>
                      {typeof currentQuickPreviewResult.inference_runtime_ms === "number" && (
                        <div>
                          <span className="text-gray-500">Runtime:</span>{" "}
                          <span className="text-gray-300">{currentQuickPreviewResult.inference_runtime_ms}ms</span>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500 mb-1">Evidence</div>
                        <div className="whitespace-pre-wrap break-words text-gray-300">{currentQuickPreviewResult.evidence || "—"}</div>
                      </div>
                      {Array.isArray(currentQuickPreviewResult.siblings) && currentQuickPreviewResult.siblings.length > 0 && (
                        <div>
                          <div className="text-gray-500 mb-1">Also identified</div>
                          <div className="space-y-1">
                            {currentQuickPreviewResult.siblings.map((s, si) => (
                              <div key={`${s.label}_${si}`} className="text-gray-300">
                                <span className="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[11px]">{s.label}</span>
                                {s.reasoning ? <span className="ml-2 text-gray-400">{s.reasoning}</span> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {!currentQuickPreviewResult.parse_ok && (
                        <div className="space-y-1">
                          <div><span className="text-gray-500">Parse reason:</span> {currentQuickPreviewResult.parse_error_reason || "Parse failed"}</div>
                          <div><span className="text-gray-500">Fix suggestion:</span> {currentQuickPreviewResult.parse_fix_suggestion || "Return strict JSON only."}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500 mb-1">Model Output</div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-black/20 rounded p-2 text-gray-300">
                          {formatQuickModelOutput(currentQuickPreviewResult.raw_response || "")}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-500">No result available for this image.</div>
                  )
                }
              />
            </div>
          </div>

          {/* Prompt Versions */}
          <div className="app-card-strong overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="text-base font-medium tracking-tight">Prompt versions</h3>
                <span className="text-sm text-gray-500">{prompts.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  placeholder="Search prompt versions…"
                  className="bg-black/30 border border-white/10 rounded px-3 py-1.5 text-xs w-56 placeholder:text-gray-600 focus:outline-none focus:border-white/20"
                />
                <button
                  onClick={() => {
                    if (groupManageMode) {
                      setGroupManageMode(false);
                      setSelectedGroupKeys(new Set());
                    } else {
                      setGroupManageMode(true);
                      setEditingGroupKey(null);
                      setExpandedGroupKeys(new Set());
                    }
                  }}
                  className={`app-btn app-btn-sm text-xs ${
                    groupManageMode ? "app-btn-primary" : "app-btn-subtle"
                  }`}
                >
                  {groupManageMode ? "Done" : "Manage"}
                </button>
              </div>
            </div>

            {groupManageMode && (
              <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-5 py-2">
                <span className="text-xs text-gray-400">
                  {selectedGroupKeys.size === 0
                    ? "Select groups to delete."
                    : `${selectedGroupKeys.size} group${selectedGroupKeys.size === 1 ? "" : "s"} selected`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedGroupKeys.size === filteredGroups.length) {
                        setSelectedGroupKeys(new Set());
                      } else {
                        setSelectedGroupKeys(new Set(filteredGroups.map((g) => g.baseNameKey)));
                      }
                    }}
                    className="app-btn app-btn-subtle app-btn-sm text-xs"
                  >
                    {selectedGroupKeys.size === filteredGroups.length && filteredGroups.length > 0
                      ? "Clear all"
                      : "Select all"}
                  </button>
                  <button
                    type="button"
                    onClick={bulkDeleteSelectedGroups}
                    disabled={selectedGroupKeys.size === 0 || bulkDeletingGroups}
                    className="app-btn app-btn-danger app-btn-sm text-xs disabled:opacity-40"
                  >
                    {bulkDeletingGroups ? "Deleting…" : "Delete selected"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/5 px-5 py-2.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="uppercase tracking-wider text-gray-500">Approved Prompt</span>
                {approvedVersionLabel ? (
                  <span
                    className={`font-mono ${
                      approvedVersionLabel.eligible ? "text-emerald-300" : "text-yellow-300"
                    }`}
                  >
                    {approvedVersionLabel.label}
                  </span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </div>
              <span className="text-gray-700">|</span>
              <div className="flex items-center gap-2">
                <span className="uppercase tracking-wider text-gray-500">Selected Prompt</span>
                {selectedVersionLabel ? (
                  <span className="font-mono text-blue-300">{selectedVersionLabel}</span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </div>
            </div>

            <div
              className={`grid ${PROMPT_GRID_COLS} items-center gap-x-2 border-t border-white/5 px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500`}
            >
              <div className="pl-6">Name</div>
              <div className="text-right">Runs</div>
              <div className="text-right">Images</div>
              <div className="text-right">P</div>
              <div className="text-right">R</div>
              <div className="text-right">F1</div>
              <div className="text-right">Updated</div>
              <div />
            </div>

            <div>
              {filteredGroups.map((group) => {
                const isEditing = editingGroupKey === group.baseNameKey;
                const isExpanded = isEditing || expandedGroupKeys.has(group.baseNameKey);
                const isGroupSelected = selectedGroupKeys.has(group.baseNameKey);
                return (
                  <div key={group.baseNameKey} className="border-b border-white/5 last:border-b-0">
                    <div
                      className={`grid ${PROMPT_GRID_COLS} items-center gap-x-2 px-3 py-2.5 transition-colors group ${
                        isEditing ? "bg-white/[0.03]" : "cursor-pointer hover:bg-white/[0.02]"
                      } ${isGroupSelected ? "bg-white/[0.04]" : ""}`}
                      onClick={() => {
                        if (isEditing) return;
                        if (groupManageMode) {
                          setSelectedGroupKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.baseNameKey)) next.delete(group.baseNameKey);
                            else next.add(group.baseNameKey);
                            return next;
                          });
                          return;
                        }
                        setExpandedGroupKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.baseNameKey)) next.delete(group.baseNameKey);
                          else next.add(group.baseNameKey);
                          return next;
                        });
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {groupManageMode ? (
                          <input
                            type="checkbox"
                            checked={isGroupSelected}
                            onChange={() => {
                              setSelectedGroupKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.baseNameKey)) next.delete(group.baseNameKey);
                                else next.add(group.baseNameKey);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0"
                            aria-label={`Select ${group.baseName}`}
                          />
                        ) : (
                          <svg
                            className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                        {isEditing ? (
                          <input
                            type="text"
                            value={groupNameDraft}
                            onChange={(e) => setGroupNameDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-black/40 border border-white/15 rounded px-2 py-1 text-sm text-gray-100"
                          />
                        ) : (
                          <span className="truncate text-sm font-medium text-gray-100">{group.baseName}</span>
                        )}
                        <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                          {group.versions.length}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 text-right tabular-nums">
                        {group.groupRollup?.runCount ?? 0}
                      </div>
                      <div className="text-xs text-gray-400 text-right tabular-nums">
                        {group.groupRollup?.uniqueImages ?? 0}
                      </div>
                      <div className={`text-xs text-right tabular-nums ${
                        !anyGroupExpanded && groupTopMetrics.pKey === group.baseNameKey ? "text-emerald-300" : "text-gray-200"
                      }`}>
                        {group.groupRollup?.precision != null ? `${(group.groupRollup.precision * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div className={`text-xs text-right tabular-nums ${
                        !anyGroupExpanded && groupTopMetrics.rKey === group.baseNameKey ? "text-emerald-300" : "text-gray-200"
                      }`}>
                        {group.groupRollup?.recall != null ? `${(group.groupRollup.recall * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div className="text-xs text-right tabular-nums">
                        {group.groupRollup?.f1 != null ? (
                          <span className={
                            !anyGroupExpanded && groupTopMetrics.f1Key === group.baseNameKey
                              ? "text-emerald-300"
                              : "text-gray-200"
                          }>
                            {(group.groupRollup.f1 * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 text-right tabular-nums">
                        {new Date(group.newestCreatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-2 pl-4">
                        <div />
                        <div className="flex items-center gap-1">
                          {groupManageMode ? null : isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveGroupEdit(group);
                                }}
                                disabled={savingGroupDesc}
                                className="rounded px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                              >
                                {savingGroupDesc ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingGroupKey(null);
                                  setGroupSelectedVersionIds(new Set());
                                }}
                                className="rounded px-2 py-0.5 text-[11px] text-gray-400 hover:bg-white/10 hover:text-gray-200"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingGroupKey(group.baseNameKey);
                                  setGroupNameDraft(group.baseName);
                                  setGroupDescDraft(group.description || "");
                                  setGroupSelectedVersionIds(new Set());
                                  setExpandedGroupKeys((prev) => new Set(prev).add(group.baseNameKey));
                                }}
                                className="hidden group-hover:inline-flex items-center rounded p-1 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                                title="Edit group"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deletePromptGroup(
                                    group.baseName,
                                    group.versions.map((v) => v.prompt_version_id),
                                  );
                                }}
                                className="hidden group-hover:inline-flex items-center rounded p-1 text-gray-400 hover:bg-red-500/15 hover:text-red-300"
                                title="Delete group"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12z" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && !groupManageMode && (
                      <div className="bg-black/10 pb-1">
                        {isEditing ? (
                          <div className="px-5 py-3">
                            <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                              Description
                            </label>
                            <textarea
                              value={groupDescDraft}
                              onChange={(e) => setGroupDescDraft(e.target.value)}
                              placeholder="Add a description for this prompt group…"
                              className="w-full bg-black/40 border border-white/15 rounded px-3 py-2 text-sm h-20"
                            />
                          </div>
                        ) : (
                          group.description && (
                            <div className="px-5 py-2 text-xs text-gray-400 whitespace-pre-wrap">
                              {group.description}
                            </div>
                          )
                        )}

                        {isEditing && groupSelectedVersionIds.size > 0 && (
                          <div className="flex items-center justify-between border-t border-white/5 px-5 py-2">
                            <span className="text-xs text-gray-400">
                              {groupSelectedVersionIds.size} selected
                            </span>
                            <button
                              type="button"
                              onClick={bulkDeleteSelectedVersions}
                              className="app-btn app-btn-danger app-btn-sm text-xs"
                            >
                              Delete selected
                            </button>
                          </div>
                        )}

                        <div>
                          {group.versions.map((v) =>
                            renderVersionRow(
                              v,
                              {
                                p: versionTopMetrics.pId === v.prompt_version_id,
                                r: versionTopMetrics.rId === v.prompt_version_id,
                                f1: versionTopMetrics.f1Id === v.prompt_version_id,
                              },
                              isEditing,
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredGroups.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">
                  {prompts.length === 0
                    ? "No prompt versions yet. Create one to get started."
                    : "No groups match this search."}
                </p>
              )}
            </div>
          </div>

        </>
      )}

    </div>
  );
}

function parseLabelPolicySections(labelPolicy: string): {
  detected: string;
  notDetected: string;
} {
  const normalized = (labelPolicy || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const sections = { detected: "", notDetected: "" };
  let current: keyof typeof sections | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const detectedMatch = line.match(/^DETECTED\s*:\s*(.*)$/i);
    const notDetectedMatch = line.match(/^NOT[_\s-]?DETECTED\s*:\s*(.*)$/i);
    const edgeMatch = line.match(/^(EDGE(?:[_\s-]?CASE)?|Edge cases?)\s*:\s*(.*)$/i);
    if (detectedMatch) {
      current = "detected";
      sections.detected = [sections.detected, detectedMatch[1]].filter(Boolean).join("\n").trim();
      continue;
    }
    if (notDetectedMatch) {
      current = "notDetected";
      sections.notDetected = [sections.notDetected, notDetectedMatch[1]].filter(Boolean).join("\n").trim();
      continue;
    }
    if (edgeMatch) {
      current = null;
      continue;
    }
    if (current && line) {
      sections[current] = [sections[current], line].filter(Boolean).join("\n").trim();
    }
  }

  if (!sections.detected && !sections.notDetected && normalized.trim()) {
    sections.detected = normalized.trim();
  }

  return sections;
}

function composeLabelPolicySections(parts: {
  detected: string;
  notDetected: string;
}): string {
  const detected = parts.detected.trim();
  const notDetected = parts.notDetected.trim();
  // When both sections are empty, return an empty policy so downstream compilers
  // omit the "Decision Policy" header entirely (matching the Decision Rubric).
  return [
    detected ? `DETECTED: ${detected}` : "",
    notDetected ? `NOT_DETECTED: ${notDetected}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDecisionRubricCriteria(decisionRubric: string): string[] {
  return (decisionRubric || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function metricsMeetThresholds(
  metrics: MetricsSummary | Partial<MetricsSummary> | null | undefined,
  thresholds: { min_precision?: number; min_recall?: number; min_f1?: number }
): boolean {
  if (!metrics) return false;
  if (thresholds.min_precision != null && Number(metrics.precision) < thresholds.min_precision) return false;
  if (thresholds.min_recall != null && Number(metrics.recall) < thresholds.min_recall) return false;
  if (thresholds.min_f1 != null && Number(metrics.f1) < thresholds.min_f1) return false;
  return true;
}

function formatQuickModelOutput(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "—";
  let cleaned = text;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

function PromptVersionNotesEditor({
  promptVersionId,
  onSaved,
}: {
  promptVersionId: string;
  onSaved?: () => void;
}) {
  const [entries, setEntries] = useState<VersionNoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/version-note-entries?prompt_version_id=${encodeURIComponent(promptVersionId)}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    } finally {
      setLoading(false);
    }
  }, [promptVersionId]);

  useEffect(() => {
    setEditingId(null);
    setEditingBody("");
    load();
  }, [load]);

  const beginEdit = (entry: VersionNoteEntry) => {
    setEditingId(entry.entry_id);
    setEditingBody(entry.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/version-note-entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: editingId, body: editingBody }),
      });
      if (res.ok) {
        await load();
        setEditingId(null);
        setEditingBody("");
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/version-note-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_version_id: promptVersionId, body: "" }),
      });
      if (res.ok) {
        const data = await res.json();
        await load();
        if (data?.entry?.entry_id) {
          setEditingId(data.entry.entry_id);
          setEditingBody("");
        }
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entryId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/version-note-entries?entry_id=${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await load();
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const originStyles: Record<VersionNoteEntryOrigin, string> = {
    auto_created: "bg-gray-700/60 text-gray-200",
    auto_diff: "bg-blue-800/50 text-blue-100",
    auto_hil: "bg-amber-800/50 text-amber-100",
    user: "bg-slate-700/60 text-slate-200",
  };
  const originLabels: Record<VersionNoteEntryOrigin, string> = {
    auto_created: "Auto · Created",
    auto_diff: "Auto · Diff",
    auto_hil: "Auto · HIL",
    user: "User",
  };

  return (
    <details className="group rounded-lg px-1 py-1">
      <summary className="cursor-pointer list-none text-xs text-blue-300 transition-colors hover:text-blue-200">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block text-[10px] text-blue-300/80 transition-transform group-open:rotate-90">▶</span>
          <span>Version Notes</span>
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-end px-3">
          <button
            onClick={addNote}
            disabled={saving}
            className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-40"
          >
            + Add note
          </button>
        </div>
        {loading ? (
          <div className="px-3 py-2 text-xs text-[var(--app-text-muted)]">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--app-text-muted)]">No entries yet.</div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const isEditing = editingId === entry.entry_id;
              return (
                <li
                  key={entry.entry_id}
                  className="rounded-md border border-gray-700/60 bg-gray-900/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-[10px] mb-1">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${originStyles[entry.origin]}`}>
                      {originLabels[entry.origin]}
                    </span>
                    <span className="text-[var(--app-text-muted)]">{localDateTime(entry.created_at)}</span>
                    <span className="text-[var(--app-text-muted)]">· {entry.created_by}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {!isEditing && (
                        <>
                          <button
                            onClick={() => beginEdit(entry)}
                            className="text-xs text-blue-300 hover:text-blue-200"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteEntry(entry.entry_id)}
                            disabled={saving}
                            className="text-xs text-red-300 hover:text-red-200 disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs min-h-24"
                        value={editingBody}
                        onChange={(e) => setEditingBody(e.target.value)}
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-40"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-sm text-[var(--app-text)]">
                      {entry.body || <span className="text-[var(--app-text-muted)]">(empty note)</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}

function ProvenanceBadge({ kind }: { kind: ProvenanceKind | null }) {
  if (kind === "exact_replication") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/40">
        Exact Production Replication
      </span>
    );
  }
  if (kind === "modified_replication") {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-600/20 text-amber-300 border border-amber-600/40">
        Modified Replication
      </span>
    );
  }
  return null;
}

function ProductionModePanel({
  contextNames,
  selectedContext,
  onSelectContext,
  snapshot,
  composition,
  provenance,
  ctxLoading,
  ctxError,
  targetLabel,
  onChangeTargetLabel,
  memberLabels,
  targetMatched,
  targetDescription,
  onEditTargetDescription,
  onResetTargetBaseline,
  preamble,
  onEditPreamble,
  onResetPreamble,
  onToggleMember,
  onToggleSupport,
  onEditMemberDescription,
  onAddMember,
  onRemoveMember,
  snapshotLabels,
  compiledPreview,
}: {
  contextNames: string[];
  selectedContext: string;
  onSelectContext: (name: string) => void;
  snapshot: ProductionSnapshot | null;
  composition: PromptComposition | null;
  provenance: ProvenanceKind | null;
  ctxLoading: boolean;
  ctxError: string;
  targetLabel: string;
  onChangeTargetLabel: (label: string) => void;
  memberLabels: string[];
  targetMatched: boolean;
  targetDescription: string;
  onEditTargetDescription: (description: string) => void;
  onResetTargetBaseline: () => void;
  preamble: string;
  onEditPreamble: (text: string) => void;
  onResetPreamble: () => void;
  onToggleMember: (index: number) => void;
  onToggleSupport: (index: number) => void;
  onEditMemberDescription: (index: number, description: string) => void;
  onAddMember: (label: string, description: string) => void;
  onRemoveMember: (index: number) => void;
  snapshotLabels: string[];
  compiledPreview: string;
}) {
  const hasTarget = !!composition && composition.members.some((m) => m.is_target);
  const [customTarget, setCustomTarget] = useState(false);
  const isCustomTarget = customTarget || (!!targetLabel && !memberLabels.includes(targetLabel));
  const [newMemberLabel, setNewMemberLabel] = useState("");
  const [newMemberDesc, setNewMemberDesc] = useState("");
  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>Production Context</label>
        <select
          className="app-select w-full px-3 py-2 text-sm"
          value={selectedContext}
          onChange={(e) => onSelectContext(e.target.value)}
        >
          <option value="">Select a production context…</option>
          {contextNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--app-text-muted)]">
          Imported from the Admin production-context catalog as an immutable snapshot.
        </p>
      </div>

      {ctxLoading && <p className="text-xs text-blue-300">Importing production snapshot…</p>}
      {ctxError && <p className="text-xs text-red-400">{ctxError}</p>}

      {snapshot && (
        <>
          <div>
            <label className={LABEL_CLS}>Target Detection</label>
            <select
              className="app-select w-full px-3 py-2 text-sm"
              value={isCustomTarget ? "__custom__" : targetLabel}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") {
                  setCustomTarget(true);
                  onChangeTargetLabel("");
                } else {
                  setCustomTarget(false);
                  onChangeTargetLabel(v);
                }
              }}
            >
              <option value="">Select the target detection…</option>
              {memberLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
              <option value="__custom__">Other — introduce a new label…</option>
            </select>
            {isCustomTarget && (
              <input
                className={`${INPUT_CLS} mt-2`}
                value={targetLabel}
                onChange={(e) => onChangeTargetLabel(e.target.value)}
                placeholder="New target label"
              />
            )}
            <p className="mt-1 text-xs text-[var(--app-text-muted)]">
              The detection this version develops. Pick an existing production label, or add a new one to introduce.
            </p>
            {!targetLabel && (
              <p className="mt-1 rounded border border-yellow-500/30 bg-yellow-900/20 px-2 py-1.5 text-xs text-yellow-300">
                Select a target before saving.
              </p>
            )}
          </div>

          {hasTarget && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-gray-400 block">Target Detection Description</label>
                {targetMatched && (
                  <button
                    type="button"
                    onClick={onResetTargetBaseline}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Reset to production baseline
                  </button>
                )}
              </div>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm min-h-[8rem]"
                value={targetDescription}
                onChange={(e) => onEditTargetDescription(e.target.value)}
                placeholder="Describe what to detect. This becomes your detection's block in the aggregate prompt."
              />
              <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                Your detection&apos;s description block in the aggregate. Editing it keeps the run an exact replication of
                production for every other detection.
              </p>
            </div>
          )}

          {snapshot && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-gray-400 block">User Prompt — Shared Instructions</label>
                <button
                  type="button"
                  onClick={onResetPreamble}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Reset to production baseline
                </button>
              </div>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm min-h-[8rem]"
                value={preamble}
                onChange={(e) => onEditPreamble(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                The shared instruction block sent before the numbered detections in the aggregate prompt. Editing it
                makes this a Modified Replication.
              </p>
            </div>
          )}

          {composition && (
            <div>
              <label className={LABEL_CLS}>Other Detections in this Context</label>
              <p className="mb-2 text-xs text-[var(--app-text-muted)]">
                These run alongside your target. Disable, edit, or add detections to test interactions — the production
                snapshot is never changed. Added detections make this a Modified Replication. Mark a detection{" "}
                <span className="text-gray-300">supporting</span> to have its reasoning fill the Evidence when the target
                isn&apos;t applied (the DETECTED/NOT_DETECTED decision is unchanged).
              </p>
              <div className="space-y-2">
                {composition.members.map((m, i) =>
                  m.is_target ? null : (
                    <div key={`${m.label}-${i}`} className="rounded border border-gray-700 bg-black/20 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-500">{m.position}.</span>
                          <span className="font-medium text-gray-200">{m.label}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-500">{m.role}</span>
                          {!snapshotLabels.includes(m.label) && (
                            <span className="rounded bg-purple-600/70 px-1.5 py-0.5 text-[10px] text-white">added</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-gray-400">
                            <input type="checkbox" checked={m.enabled} onChange={() => onToggleMember(i)} />
                            enabled
                          </label>
                          <label
                            className={`flex items-center gap-1 text-[11px] ${m.enabled ? "text-gray-400" : "text-gray-600"}`}
                            title="When the target isn't applied, this detection's reasoning fills the Evidence (does not change the decision)."
                          >
                            <input
                              type="checkbox"
                              checked={!!m.is_support}
                              disabled={!m.enabled}
                              onChange={() => onToggleSupport(i)}
                            />
                            supporting
                          </label>
                          {!snapshotLabels.includes(m.label) && (
                            <button
                              type="button"
                              onClick={() => onRemoveMember(i)}
                              className="text-[11px] text-gray-500 hover:text-red-400"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                      <textarea
                        className="mt-2 h-16 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 disabled:opacity-50"
                        value={m.description}
                        disabled={!m.enabled}
                        onChange={(e) => onEditMemberDescription(i, e.target.value)}
                      />
                    </div>
                  )
                )}
              </div>

              <div className="mt-3 rounded border border-dashed border-gray-600 bg-black/10 p-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Add detection to aggregate</div>
                <input
                  className="mt-2 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm"
                  value={newMemberLabel}
                  onChange={(e) => setNewMemberLabel(e.target.value)}
                  placeholder="Label (e.g. minor corrosion)"
                />
                <textarea
                  className="mt-2 h-20 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-gray-300"
                  value={newMemberDesc}
                  onChange={(e) => setNewMemberDesc(e.target.value)}
                  placeholder="Description: when should the model apply this label?"
                />
                <button
                  type="button"
                  disabled={!newMemberLabel.trim() || composition.members.some((m) => m.label === newMemberLabel.trim())}
                  onClick={() => {
                    onAddMember(newMemberLabel, newMemberDesc);
                    setNewMemberLabel("");
                    setNewMemberDesc("");
                  }}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + Add detection
                </button>
                {composition.members.some((m) => m.label === newMemberLabel.trim()) && newMemberLabel.trim() && (
                  <span className="ml-2 text-[11px] text-yellow-400">That label already exists in the aggregate.</span>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ProvenanceBadge kind={provenance} />
            <span className="text-gray-500">
              {composition?.google_model} · thinking: {composition?.thinking_level} · source{" "}
              {snapshot.source_revision ? snapshot.source_revision.slice(0, 8) : "n/a"}
            </span>
          </div>

          <div>
            <label className={LABEL_CLS}>Compiled Production Prompt (sent to the model)</label>
            <div className="app-card w-full px-3 py-2 text-xs font-mono whitespace-pre-wrap text-[var(--app-text)] max-h-72 overflow-auto">
              {compiledPreview || "Select a target to preview the compiled aggregate prompt."}
            </div>
            <p className="mt-1 text-xs text-[var(--app-text-muted)]">
              Production runs a single aggregate user prompt — there is no separate system prompt.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PromptForm({
  detectionId,
  detectionCode,
  detectionCategory,
  detectionLabelPolicy,
  detectionDecisionRubric,
  userPromptAddendum,
  productionLabel,
  adminPromptSettings,
  suggestedVersionLabel,
  existingVersionLabels,
  defaultVersionBaseName,
  onSaved,
  initialData,
}: {
  detectionId: string;
  detectionCode: string;
  detectionCategory: DetectionCategory;
  detectionLabelPolicy: string;
  detectionDecisionRubric: string[];
  userPromptAddendum: string;
  productionLabel?: string | null;
  adminPromptSettings: AdminPromptSettings;
  suggestedVersionLabel?: string;
  existingVersionLabels: string[];
  defaultVersionBaseName?: string;
  onSaved: () => void;
  initialData?: Partial<PromptVersion>;
}) {
  const defaultDecisionRubric = detectionDecisionRubric.length > 0
    ? detectionDecisionRubric.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "";

  const [form, setForm] = useState({
    version_label: initialData?.version_label || suggestedVersionLabel || "",
    prompt_structure: initialData?.prompt_structure || {
      detection_identity: "",
      label_policy: detectionLabelPolicy,
      decision_rubric: defaultDecisionRubric,
      user_prompt_addendum: userPromptAddendum,
      output_schema: `{"detection_code":"${detectionCode}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`,
      examples: "",
    },
    model: initialData?.model || "gemini-2.5-flash",
    temperature: initialData?.temperature ?? 0,
    top_p: initialData?.top_p ?? 1,
    max_output_tokens: initialData?.max_output_tokens ?? 1024,
    change_notes: initialData?.change_notes || "",
    version_notes: initialData?.version_notes || "",
    created_by: "user",
  });
  const [labelPolicyParts, setLabelPolicyParts] = useState(() =>
    parseLabelPolicySections(promptStructureOf(initialData || undefined).label_policy || detectionLabelPolicy || "")
  );
  const [rubricCriteria, setRubricCriteria] = useState<string[]>(() => {
    const raw = promptStructureOf(initialData || undefined).decision_rubric || defaultDecisionRubric;
    const parsed = parseDecisionRubricCriteria(typeof raw === "string" ? raw : "");
    return parsed.length > 0 ? parsed : [""];
  });
  const updateRubricCriteria = (next: string[]) => {
    setRubricCriteria(next);
    const text = next
      .filter((r) => r.trim())
      .map((r, i) => `${i + 1}. ${r.trim()}`)
      .join("\n");
    setForm((current) => ({
      ...current,
      prompt_structure: { ...current.prompt_structure, decision_rubric: text },
    }));
  };
  const [versionBaseName, setVersionBaseName] = useState<string>(
    (initialData?.version_label ? parseVersionLabel(initialData.version_label).base : "") ||
      defaultVersionBaseName ||
      "Detection baseline"
  );
  const [showLabelPolicy, setShowLabelPolicy] = useState<boolean>(
    () => Boolean(labelPolicyParts.detected.trim() || labelPolicyParts.notDetected.trim())
  );
  const [showDecisionRubric, setShowDecisionRubric] = useState<boolean>(
    () => rubricCriteria.some((r) => r.trim())
  );
  const addLabelPolicy = () => setShowLabelPolicy(true);
  const removeLabelPolicy = () => {
    setLabelPolicyParts({ detected: "", notDetected: "" });
    setForm((c) => ({ ...c, prompt_structure: { ...c.prompt_structure, label_policy: "" } }));
    setShowLabelPolicy(false);
  };
  const addDecisionRubric = () => {
    if (rubricCriteria.length === 0) updateRubricCriteria([""]);
    setShowDecisionRubric(true);
  };
  const removeDecisionRubric = () => {
    updateRubricCriteria([""]);
    setShowDecisionRubric(false);
  };
  const categoryTemplates =
    detectionCategory === "INCORRECT_CAPTURE"
      ? {
          system_prompt: adminPromptSettings.incorrect_capture_system_prompt,
          user_prompt_template: adminPromptSettings.incorrect_capture_user_prompt,
        }
      : {
          system_prompt: adminPromptSettings.hazard_identification_system_prompt,
          user_prompt_template: adminPromptSettings.hazard_identification_user_prompt,
        };

  useEffect(() => {
    const seeded = promptStructureOf(initialData || undefined).label_policy;
    setLabelPolicyParts(
      parseLabelPolicySections((seeded && seeded.trim() ? seeded : detectionLabelPolicy) || "")
    );
  }, [detectionLabelPolicy, initialData]);

  // Production-mirror state (Slice S2).
  const [mode, setMode] = useState<"DEVELOPMENT_MODE" | "PRODUCTION_MODE">(
    (initialData?.mode as "DEVELOPMENT_MODE" | "PRODUCTION_MODE") || "DEVELOPMENT_MODE"
  );
  const targetDescription = compileTargetMemberDescription({
    labelPolicy: promptStructureOf(form).label_policy || detectionLabelPolicy,
    decisionRubric: promptStructureOf(form).decision_rubric,
    userPromptAddendum: promptStructureOf(form).user_prompt_addendum || userPromptAddendum,
  });

  const {
    contextNames,
    selectedContext,
    selectContext,
    snapshot,
    composition,
    provenance,
    ctxLoading,
    ctxError,
    setCtxError,
    targetLabel,
    changeTargetLabel,
    targetMatched,
    currentTargetDescription,
    editTargetDescription,
    resetTargetToBaseline,
    currentPreamble,
    editPreamble,
    resetPreamble,
    toggleMember,
    toggleSupport,
    editMemberDescription,
    addMember,
    removeMember,
    compiledPreview,
  } = useProductionMirror({
    active: mode === "PRODUCTION_MODE",
    initialData,
    productionLabel,
    targetDescription,
  });

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    if (!form.change_notes.trim()) {
      setCtxError("Add a change note before saving.");
      return;
    }
    const finalVersionLabel = buildVersionLabel(
      versionBaseName.trim() || "Detection baseline",
      existingVersionLabels
    );
    let payload: Record<string, unknown> = {
      ...form,
      version_label: finalVersionLabel,
      detection_id: detectionId,
      source_prompt_version_id: initialData?.prompt_version_id ?? null,
      mode,
    };
    if (mode === "PRODUCTION_MODE") {
      if (!selectedContext || !snapshot || !composition) {
        setCtxError("Select a production context to import before saving a production-mode version.");
        return;
      }
      // A production-mirror version must have a target in the aggregate (B1).
      if (!composition.members.some((m) => m.is_target)) {
        setCtxError(
          "Select a Target detection for this version before saving a Production Replication version."
        );
        return;
      }
      payload = {
        ...payload,
        context_name: selectedContext,
        production_label: targetLabel || null,
        production_snapshot_id: snapshot.snapshot_id,
        provenance_kind: computeProvenanceKind(snapshot, composition),
        composition,
        model: composition.google_model || form.model,
      };
    }
    setSaving(true);
    try {
      await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  const updatePromptFormLabelPolicy = (key: "detected" | "notDetected", value: string) => {
    setLabelPolicyParts((prev) => {
      const next = { ...prev, [key]: value };
      const composed = composeLabelPolicySections(next);
      setForm((current) => ({
        ...current,
        prompt_structure: { ...current.prompt_structure, label_policy: composed },
      }));
      return next;
    });
  };

  return (
    <div className="app-card-strong space-y-4 p-6">
      <div className="space-y-2">
        <label className={LABEL_CLS}>Execution Mode</label>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-600 text-sm">
          <button
            type="button"
            onClick={() => setMode("DEVELOPMENT_MODE")}
            className={`px-3 py-1.5 ${mode === "DEVELOPMENT_MODE" ? "bg-blue-600 text-white" : "bg-gray-900 text-gray-300"}`}
          >
            Development
          </button>
          <button
            type="button"
            onClick={() => setMode("PRODUCTION_MODE")}
            className={`px-3 py-1.5 ${mode === "PRODUCTION_MODE" ? "bg-blue-600 text-white" : "bg-gray-900 text-gray-300"}`}
          >
            Production Replication
          </button>
        </div>
        <p className="text-xs text-[var(--app-text-muted)]">
          {mode === "DEVELOPMENT_MODE"
            ? "Isolated single-detection development."
            : "Runs the target detection inside the real production context aggregate."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>Version Name</label>
          <input
            className={INPUT_CLS}
            value={versionBaseName}
            onChange={(e) => setVersionBaseName(e.target.value)}
            placeholder="Detection baseline"
          />
          {(() => {
            const base = versionBaseName.trim() || "Detection baseline";
            const num = nextVersionNumber(base, existingVersionLabels);
            return (
              <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                Will save as <span className="text-gray-300">{`${base}_V${num}`}</span>
              </p>
            );
          })()}
        </div>
      </div>

      {mode === "PRODUCTION_MODE" && (
        <ProductionModePanel
          contextNames={contextNames}
          selectedContext={selectedContext}
          onSelectContext={selectContext}
          snapshot={snapshot}
          composition={composition}
          provenance={provenance}
          ctxLoading={ctxLoading}
          ctxError={ctxError}
          targetLabel={targetLabel}
          onChangeTargetLabel={changeTargetLabel}
          memberLabels={snapshot ? snapshot.ordered_members.map((m) => m.label) : []}
          targetMatched={targetMatched}
          targetDescription={currentTargetDescription}
          onEditTargetDescription={editTargetDescription}
          onResetTargetBaseline={resetTargetToBaseline}
          preamble={currentPreamble}
          onEditPreamble={editPreamble}
          onResetPreamble={resetPreamble}
          onToggleMember={toggleMember}
          onToggleSupport={toggleSupport}
          onEditMemberDescription={editMemberDescription}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          snapshotLabels={snapshot ? snapshot.ordered_members.map((m) => m.label) : []}
          compiledPreview={compiledPreview}
        />
      )}

      {mode === "DEVELOPMENT_MODE" && (
        <>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className={LABEL_CLS}>System Prompt</label>
          <div className="app-card w-full px-3 py-2 text-sm min-h-24 whitespace-pre-wrap text-[var(--app-text)]">
            {categoryTemplates.system_prompt}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Managed in Admin by detection category.</div>
        </div>
        <div>
          <label className={LABEL_CLS}>User Prompt</label>
          <div className="app-card w-full px-3 py-2 text-sm min-h-32 whitespace-pre-wrap text-[var(--app-text)]">
            {categoryTemplates.user_prompt_template || "No user prompt template."}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">Base template is Admin-managed. Detection-specific guidance goes in the addendum below.</div>
        </div>
      </div>

      <div>
        <label className={LABEL_CLS}>User Prompt Addendum</label>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm min-h-[6rem] resize-none overflow-hidden"
          value={promptStructureOf(form).user_prompt_addendum || ""}
          onChange={(e) => {
            setForm({ ...form, prompt_structure: { ...form.prompt_structure, user_prompt_addendum: e.target.value } });
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
          placeholder="Optional detection-specific guidance appended to the category user prompt."
        />
      </div>

      {showLabelPolicy ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400 block">Decision Policy</label>
            <button
              type="button"
              onClick={removeLabelPolicy}
              className="text-xs text-gray-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
              <span className="text-xs text-gray-500 mt-2">DETECTED:</span>
              <input
                type="text"
                className={INPUT_CLS}
                value={labelPolicyParts.detected}
                onChange={(e) => updatePromptFormLabelPolicy("detected", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
              <span className="text-xs text-gray-500 mt-2">NOT DETECTED:</span>
              <input
                type="text"
                className={INPUT_CLS}
                value={labelPolicyParts.notDetected}
                onChange={(e) => updatePromptFormLabelPolicy("notDetected", e.target.value)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={addLabelPolicy}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add Decision Policy
          </button>
        </div>
      )}

      {showDecisionRubric ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-400 block">Decision Rubric (3-7 criteria)</label>
            <button
              type="button"
              onClick={removeDecisionRubric}
              className="text-xs text-gray-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
          {rubricCriteria.map((r, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <span className="text-xs text-gray-500 mt-2">{i + 1}.</span>
              <input
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm"
                value={r}
                onChange={(e) => {
                  const next = [...rubricCriteria];
                  next[i] = e.target.value;
                  updateRubricCriteria(next);
                }}
              />
              {rubricCriteria.length > 1 && (
                <button
                  type="button"
                  onClick={() => updateRubricCriteria(rubricCriteria.filter((_, j) => j !== i))}
                  className="text-gray-500 hover:text-red-400 text-xs"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {rubricCriteria.length < 7 && (
            <button
              type="button"
              onClick={() => updateRubricCriteria([...rubricCriteria, ""])}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              + Add criterion
            </button>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={addDecisionRubric}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add Decision Rubric
          </button>
        </div>
      )}
        </>
      )}

      <div>
        <label className={LABEL_CLS}>
          Change Notes <span className="text-red-400">*</span>
        </label>
        <input
          className={INPUT_CLS_SMALL}
          value={form.change_notes}
          onChange={(e) => setForm({ ...form, change_notes: e.target.value })}
          placeholder="Required — this becomes the first Version Notes entry."
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !form.change_notes.trim()}
        className="app-btn app-btn-primary app-btn-md disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? (
          <span className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Saving…
          </span>
        ) : (
          "Save Prompt Version"
        )}
      </button>
    </div>
  );
}

async function safeJsonArray<T>(res: Response, label: string): Promise<T[]> {
  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed to load ${label}:`, res.status, text.slice(0, 200));
    return [];
  }
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    console.error(`Invalid JSON for ${label}:`, text.slice(0, 200));
    return [];
  }
}

async function safeJsonObject<T extends object>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
