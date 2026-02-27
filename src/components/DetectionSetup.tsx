"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import type { Detection, PromptVersion, Dataset, Prediction } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

const DEFAULT_SYSTEM_PROMPT =
  "You are a visual detection system for property insurance underwriting. Analyze one image and return only valid JSON matching the required schema. Do not include markdown, explanations, or extra keys.";
const DEFAULT_USER_PROMPT_TEMPLATE =
  "Analyze this image for detection code {{DETECTION_CODE}}.\n\nReturn ONLY this JSON:\n{\n  \"detection_code\": \"{{DETECTION_CODE}}\",\n  \"decision\": \"DETECTED\" or \"NOT_DETECTED\",\n  \"confidence\": <float 0-1>,\n  \"evidence\": \"<short phrase describing visual basis>\"\n}";

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
  const { apiKey, selectedModel, refreshCounter, setSelectedDetectionId, setActiveTab, setSelectedRunForDetection } = useAppStore();
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [iterationRun, setIterationRun] = useState<any>(null);
  const [iterationPredictions, setIterationPredictions] = useState<Prediction[]>([]);
  const [iterationFilter, setIterationFilter] = useState<"all" | "fp" | "fn" | "parse_fail" | "correct">("all");
  const [iterationRunning, setIterationRunning] = useState(false);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [labelPolicySections, setLabelPolicySections] = useState({
    detected: "",
    notDetected: "",
  });
  const [decisionRubricCriteria, setDecisionRubricCriteria] = useState<string[]>([]);
  const [promptEditorDraft, setPromptEditorDraft] = useState({
    version_label: "",
    system_prompt: "",
    user_prompt_template: "",
    prompt_structure: {
      detection_identity: "",
      label_policy: "",
      decision_rubric: "",
      output_schema: "",
      examples: "",
    },
    model: "gemini-2.5-flash",
    temperature: 0,
    top_p: 1,
    max_output_tokens: 1024,
    change_notes: "",
  });
  const [showPromptForm, setShowPromptForm] = useState(false);
  const [promptFormInitialData, setPromptFormInitialData] = useState<Partial<PromptVersion> | undefined>(undefined);
  const [promptFormSuggestedVersionLabel, setPromptFormSuggestedVersionLabel] = useState<string>("");
  const [formLabelPolicySections, setFormLabelPolicySections] = useState({
    detected: "",
    notDetected: "",
  });
  const [editSystemPrompt, setEditSystemPrompt] = useState("");
  const [editUserPromptTemplate, setEditUserPromptTemplate] = useState("");
  const [editVersionName, setEditVersionName] = useState("");
  const [editPromptSource, setEditPromptSource] = useState<PromptVersion | null>(null);
  const [createMode, setCreateMode] = useState<"blank" | "assist">("blank");
  const [assistInput, setAssistInput] = useState("");
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [createSystemPrompt, setCreateSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [createUserPromptTemplate, setCreateUserPromptTemplate] = useState(DEFAULT_USER_PROMPT_TEMPLATE);
  const [createVersionName, setCreateVersionName] = useState("Detection baseline");
  const [lastHandledCreateTrigger, setLastHandledCreateTrigger] = useState(0);

  // Form state for create/edit detection
  const [form, setForm] = useState({
    detection_code: "",
    display_name: "",
    description: "",
    label_policy: "",
    decision_rubric: [""],
    metric_thresholds: { primary_metric: "f1" as const, min_precision: 0.8, min_recall: 0.8, min_f1: 0.8 },
  });

  const loadRelated = useCallback(async () => {
    if (!selectedDetection) return;
    const [promptsRes, datasetsRes, runsRes] = await Promise.all([
      fetch(`/api/prompts?detection_id=${selectedDetection.detection_id}`),
      fetch(`/api/datasets?detection_id=${selectedDetection.detection_id}`),
      fetch(`/api/runs?detection_id=${selectedDetection.detection_id}`),
    ]);
    setPrompts(await safeJsonArray<PromptVersion>(promptsRes, "prompts"));
    setDatasets(await safeJsonArray<Dataset>(datasetsRes, "datasets"));
    setRuns(await safeJsonArray<any>(runsRes, "runs"));
  }, [selectedDetection, refreshCounter]);

  useEffect(() => {
    loadRelated();
  }, [loadRelated]);

  useEffect(() => {
    if (prompts.length === 0) {
      if (selectedPromptId) setSelectedPromptId("");
      return;
    }
    const exists = prompts.some((p) => p.prompt_version_id === selectedPromptId);
    if (exists) return;
    setSelectedPromptId(prompts[0].prompt_version_id);
  }, [prompts, selectedPromptId]);

  useEffect(() => {
    if (!selectedDetection?.approved_prompt_version) return;
    const approved = prompts.find((p) => p.prompt_version_id === selectedDetection.approved_prompt_version);
    if (approved) {
      setSelectedPromptId(approved.prompt_version_id);
    }
  }, [prompts, selectedDetection?.approved_prompt_version]);

  useEffect(() => {
    if (datasets.length === 0) return;
    if (selectedDatasetId && datasets.some((d) => d.dataset_id === selectedDatasetId)) return;
    const preferred =
      datasets.find((d) => d.split_type === "ITERATION") ||
      datasets.find((d) => d.split_type === "CUSTOM") ||
      datasets[0];
    setSelectedDatasetId(preferred.dataset_id);
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    setIterationRun(null);
    setIterationPredictions([]);
    setSelectedPreviewImage(null);
    setIterationFilter("all");
  }, [selectedDetection?.detection_id]);

  const runIteration = async () => {
    if (!selectedDetection) return;
    if (!apiKey) {
      alert("Set your Gemini API key first.");
      return;
    }
    if (!selectedPromptId || !selectedDatasetId) {
      alert("Choose a prompt and dataset before running.");
      return;
    }

    setIterationRunning(true);
    setIterationRun(null);
    setIterationPredictions([]);
    setSelectedPreviewImage(null);

    try {
      const runRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          prompt_version_id: selectedPromptId,
          dataset_id: selectedDatasetId,
          detection_id: selectedDetection.detection_id,
        }),
      });
      const run = await runRes.json();

      if (!run?.run_id) {
        alert(run?.error || "Run failed");
        return;
      }

      const fullRunRes = await fetch(`/api/runs?run_id=${run.run_id}`);
      const fullRun = await fullRunRes.json();

      setIterationRun(fullRun);
      setIterationPredictions(fullRun.predictions || []);
      setSelectedRunForDetection(selectedDetection.detection_id, fullRun.run_id);
      loadRelated();
    } catch (err) {
      console.error(err);
      alert("Run failed");
    } finally {
      setIterationRunning(false);
    }
  };

  const filteredIterationPredictions = iterationPredictions.filter((p) => {
    switch (iterationFilter) {
      case "fp":
        return p.parse_ok && p.predicted_decision === "DETECTED" && p.ground_truth_label === "NOT_DETECTED";
      case "fn":
        return p.parse_ok && p.predicted_decision === "NOT_DETECTED" && p.ground_truth_label === "DETECTED";
      case "parse_fail":
        return !p.parse_ok;
      case "correct":
        return p.parse_ok && p.predicted_decision === p.ground_truth_label;
      default:
        return true;
    }
  });

  const handleCreateDetection = async () => {
    if (!form.detection_code.trim()) {
      alert("Detection code is required.");
      return;
    }
    if (!form.display_name.trim()) {
      alert("Display name is required.");
      return;
    }
    const cleanedRubric = form.decision_rubric.filter((r) => r.trim());
    const res = await fetch("/api/detections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        decision_rubric: cleanedRubric,
      }),
    });
    const data = await safeJsonObject<{ detection_id?: string; error?: string }>(res);
    if (!res.ok || !data?.detection_id) {
      alert(data?.error || "Failed to create detection");
      return;
    }

    const decisionRubricText = cleanedRubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const promptRes = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detection_id: data.detection_id,
        version_label: (createVersionName || "Detection baseline").trim(),
        system_prompt: createSystemPrompt,
        user_prompt_template: createUserPromptTemplate,
        prompt_structure: {
          detection_identity: `${form.display_name} (${form.detection_code})`,
          label_policy: form.label_policy,
          decision_rubric: decisionRubricText,
          output_schema: `{"detection_code":"${form.detection_code}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`,
          examples: "",
        },
        model: selectedModel || "gemini-2.5-flash",
        temperature: 0,
        top_p: 1,
        max_output_tokens: 1024,
        change_notes: createMode === "assist" ? "Generated with Prompt Assist" : "Initial baseline prompt",
        created_by: "user",
      }),
    });
    if (!promptRes.ok) {
      const promptErr = await safeJsonObject<{ error?: string }>(promptRes);
      alert(promptErr?.error || "Detection saved, but failed to create baseline prompt version.");
    }

    setSelectedDetectionId(data.detection_id);
    setMode("view");
    onRefresh();
  };

  const generateWithPromptAssist = async () => {
    if (!assistInput.trim()) {
      setAssistError("Describe the detection to generate a template.");
      return;
    }
    if (!apiKey) {
      setAssistError("Set your Gemini API key first.");
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
      const detected = String(data.label_policy_detected || "").trim();
      const notDetected = String(data.label_policy_not_detected || "").trim();

      setForm((prev) => ({
        ...prev,
        detection_code: String(data.detection_code || prev.detection_code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9_]/g, ""),
        display_name: String(data.display_name || prev.display_name || ""),
        description: String(data.description || prev.description || ""),
        label_policy: composeLabelPolicySections({ detected, notDetected }),
        decision_rubric: rubric.length > 0 ? rubric : prev.decision_rubric,
      }));
      setFormLabelPolicySections({ detected, notDetected });
      setCreateSystemPrompt(String(data.system_prompt || createSystemPrompt));
      setCreateUserPromptTemplate(String(data.user_prompt_template || createUserPromptTemplate));
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
    await fetch("/api/detections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detection_id: selectedDetection.detection_id,
        display_name: form.display_name,
        description: form.description,
        label_policy: form.label_policy,
        decision_rubric: form.decision_rubric.filter((r) => r.trim()),
        metric_thresholds: form.metric_thresholds,
        approved_prompt_version: selectedDetection.approved_prompt_version,
      }),
    });
    if (editPromptSource) {
      const nextVersionName = (editVersionName || "").trim();
      const systemChanged = editSystemPrompt.trim() !== (editPromptSource.system_prompt || "").trim();
      const userChanged = editUserPromptTemplate.trim() !== (editPromptSource.user_prompt_template || "").trim();
      const labelPolicyChanged =
        form.label_policy.trim() !== ((editPromptSource.prompt_structure as any)?.label_policy || "").trim();
      const rubricChanged =
        form.decision_rubric
          .filter((r) => r.trim())
          .map((r, i) => `${i + 1}. ${r}`)
          .join("\n")
          .trim() !== (((editPromptSource.prompt_structure as any)?.decision_rubric || "").trim());
      const versionChanged = nextVersionName.length > 0 && nextVersionName !== editPromptSource.version_label;

      if (systemChanged || userChanged || labelPolicyChanged || rubricChanged || versionChanged) {
        const promptRes = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detection_id: selectedDetection.detection_id,
            version_label: nextVersionName || `${editPromptSource.version_label}-rev`,
            system_prompt: editSystemPrompt,
            user_prompt_template: editUserPromptTemplate,
            prompt_structure: {
              ...(editPromptSource.prompt_structure || {}),
              label_policy: form.label_policy,
              decision_rubric: form.decision_rubric
                .filter((r) => r.trim())
                .map((r, i) => `${i + 1}. ${r}`)
                .join("\n"),
            },
            model: editPromptSource.model,
            temperature: editPromptSource.temperature,
            top_p: editPromptSource.top_p,
            max_output_tokens: editPromptSource.max_output_tokens,
            change_notes: "Edited via detection form",
            created_by: "user",
          }),
        });
        const promptData = await promptRes.json();
        if (promptData?.prompt_version_id) {
          setSelectedPromptId(promptData.prompt_version_id);
        }
      }
    }
    setMode("view");
    await loadRelated();
    onRefresh();
  };

  const deletePromptVersion = async (promptVersionId: string) => {
    if (!selectedDetection) return;
    if (!confirm("Delete this prompt version and its run artifacts? This cannot be undone.")) return;

    const res = await fetch("/api/prompts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_version_id: promptVersionId }),
    });

    if (!res.ok) {
      const text = await res.text();
      alert(`Failed to delete prompt version: ${text}`);
      return;
    }

    if (selectedPromptId === promptVersionId) {
      setSelectedPromptId("");
    }

    await loadRelated();
    onRefresh();
  };

  const startEdit = () => {
    if (!selectedDetection) return;
    const sourcePrompt = prompts.find((p) => p.prompt_version_id === selectedPromptId) || prompts[0] || null;
    const parsedLabelPolicy = parseLabelPolicySections(selectedDetection.label_policy || "");
    setForm({
      detection_code: selectedDetection.detection_code,
      display_name: selectedDetection.display_name,
      description: selectedDetection.description,
      label_policy: selectedDetection.label_policy,
      decision_rubric: selectedDetection.decision_rubric.length > 0 ? selectedDetection.decision_rubric : [""],
      metric_thresholds: selectedDetection.metric_thresholds as any,
    });
    setFormLabelPolicySections(parsedLabelPolicy);
    setEditPromptSource(sourcePrompt);
    setEditSystemPrompt(sourcePrompt?.system_prompt || "");
    setEditUserPromptTemplate(sourcePrompt?.user_prompt_template || "");
    setEditVersionName(sourcePrompt ? `${sourcePrompt.version_label}-rev` : `v${prompts.length + 1}.0`);
    setMode("edit");
  };

  const startCreate = useCallback(() => {
    setForm({
      detection_code: "",
      display_name: "",
      description: "",
      label_policy: "",
      decision_rubric: [""],
      metric_thresholds: { primary_metric: "f1", min_precision: 0.8, min_recall: 0.8, min_f1: 0.8 },
    });
    setFormLabelPolicySections({ detected: "", notDetected: "" });
    setEditPromptSource(null);
    setEditSystemPrompt("");
    setEditUserPromptTemplate("");
    setEditVersionName(`v${prompts.length + 1}.0`);
    setCreateMode("blank");
    setAssistInput("");
    setAssistError(null);
    setCreateSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setCreateUserPromptTemplate(DEFAULT_USER_PROMPT_TEMPLATE);
    setCreateVersionName("Detection baseline");
    setMode("create");
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

  const openNewPromptForm = () => {
    setPromptFormInitialData(undefined);
    setPromptFormSuggestedVersionLabel(`v${prompts.length + 1}.0`);
    setShowPromptForm(true);
  };

  const selectedPrompt = prompts.find((p) => p.prompt_version_id === selectedPromptId) || null;
  const activePromptForTopPanel = selectedPrompt || prompts[0] || null;
  const activePromptPolicy =
    (activePromptForTopPanel?.prompt_structure as any)?.label_policy || selectedDetection?.label_policy || "";
  const activePromptRubricText: string =
    (activePromptForTopPanel?.prompt_structure as any)?.decision_rubric ||
    (selectedDetection?.decision_rubric || []).map((r, i) => `${i + 1}. ${r}`).join("\n");
  const compiledPromptPreview = useMemo(() => {
    if (!selectedDetection) return "";
    const promptForRun = selectedPrompt || activePromptForTopPanel;
    if (!promptForRun) return "";

    const baseUserPrompt = (promptForRun.user_prompt_template || "").replace(
      "{{DETECTION_CODE}}",
      selectedDetection.detection_code
    );
    const policy = ((promptForRun.prompt_structure as any)?.label_policy || activePromptPolicy || "").trim();
    const rubric = ((promptForRun.prompt_structure as any)?.decision_rubric || activePromptRubricText || "").trim();
    const compiledUser = [baseUserPrompt.trim(), policy ? `Label Policy:\n${policy}` : "", rubric ? `Decision Rubric:\n${rubric}` : ""]
      .filter(Boolean)
      .join("\n\n");

    return [
      `System Prompt:\n${promptForRun.system_prompt || ""}`.trim(),
      `User Prompt (Compiled):\n${compiledUser}`.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [
    selectedDetection,
    selectedPrompt,
    activePromptForTopPanel,
    activePromptPolicy,
    activePromptRubricText,
  ]);

  useEffect(() => {
    const nextDraft = {
      version_label: activePromptForTopPanel ? `${activePromptForTopPanel.version_label}-rev` : `v${prompts.length + 1}.0`,
      system_prompt:
        activePromptForTopPanel?.system_prompt ||
        `You are a visual detection system. Your task is to analyze images for a specific detection type and return a structured JSON response.\n\nYou must ONLY return valid JSON matching the exact schema provided. No markdown, no commentary, no extra text.`,
      user_prompt_template:
        activePromptForTopPanel?.user_prompt_template ||
        `Analyze this image for the detection: {{DETECTION_CODE}}\n\nReturn ONLY this JSON:\n{\n  "detection_code": "{{DETECTION_CODE}}",\n  "decision": "DETECTED" or "NOT_DETECTED",\n  "confidence": <float 0-1>,\n  "evidence": "<short phrase describing visual basis>"\n}`,
      prompt_structure: {
        detection_identity: (activePromptForTopPanel?.prompt_structure as any)?.detection_identity || "",
        label_policy: activePromptPolicy,
        decision_rubric: activePromptRubricText,
        output_schema:
          (activePromptForTopPanel?.prompt_structure as any)?.output_schema ||
          (selectedDetection
            ? `{"detection_code":"${selectedDetection.detection_code}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`
            : ""),
        examples: (activePromptForTopPanel?.prompt_structure as any)?.examples || "",
      },
      model: activePromptForTopPanel?.model || "gemini-2.5-flash",
      temperature: activePromptForTopPanel?.temperature ?? 0,
      top_p: activePromptForTopPanel?.top_p ?? 1,
      max_output_tokens: activePromptForTopPanel?.max_output_tokens ?? 1024,
      change_notes: activePromptForTopPanel?.change_notes || "",
    };

    setPromptEditorDraft(nextDraft);
    setLabelPolicySections(parseLabelPolicySections(nextDraft.prompt_structure.label_policy));
    setDecisionRubricCriteria(parseDecisionRubricCriteria(nextDraft.prompt_structure.decision_rubric));
  }, [activePromptForTopPanel?.prompt_version_id, selectedDetection?.detection_id, prompts.length]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header Actions */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Detection Setup</h2>
        <div className="flex gap-2">
          {mode === "view" && (
            <>
              <button onClick={startCreate} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm">
                New Detection
              </button>
            </>
          )}
          {mode !== "view" && (
            <button onClick={() => setMode("view")} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Create/Edit Form */}
      {mode !== "view" && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <h3 className="text-sm font-medium text-gray-300">
            {mode === "create" ? "Create Detection" : "Edit Detection"}
          </h3>

          {mode === "create" && (
            <div className="space-y-3">
              <div className="text-xs text-gray-400">Creation mode</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCreateMode("blank")}
                  className={`text-left rounded border px-3 py-2 ${
                    createMode === "blank"
                      ? "border-blue-600 bg-blue-900/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:bg-gray-900/70"
                  }`}
                >
                  <div className="text-sm font-medium">Blank Template</div>
                  <div className="text-xs text-gray-500 mt-0.5">Start from defaults and fill manually.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("assist")}
                  className={`text-left rounded border px-3 py-2 ${
                    createMode === "assist"
                      ? "border-blue-600 bg-blue-900/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:bg-gray-900/70"
                  }`}
                >
                  <div className="text-sm font-medium">Prompt Assist</div>
                  <div className="text-xs text-gray-500 mt-0.5">Generate underwriting-grade defaults with Gemini.</div>
                </button>
              </div>

              {createMode === "assist" && (
                <div className="bg-gray-900/40 border border-gray-700 rounded p-3 space-y-2">
                  <label className="text-xs text-gray-400 block">
                    Describe the detection you want to build
                  </label>
                  <textarea
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-24"
                    value={assistInput}
                    onChange={(e) => setAssistInput(e.target.value)}
                    placeholder="Example: Detect severe rusting on exposed exterior plumbing and joints..."
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={generateWithPromptAssist}
                      disabled={assistLoading}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium"
                    >
                      {assistLoading ? "Generating..." : "Generate with Prompt Assist"}
                    </button>
                    {assistError && <span className="text-xs text-red-400">{assistError}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Detection Code</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm disabled:opacity-50"
                value={form.detection_code}
                onChange={(e) => setForm({ ...form, detection_code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                disabled={mode === "edit"}
                placeholder="e.g. SMOKE_VISIBLE"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Display Name</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="e.g. Visible Smoke Detection"
              />
            </div>
          </div>

          {(mode === "edit" || mode === "create") && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Version</label>
              <input
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
                value={mode === "create" ? createVersionName : editVersionName}
                onChange={(e) =>
                  mode === "create" ? setCreateVersionName(e.target.value) : setEditVersionName(e.target.value)
                }
                placeholder={mode === "create" ? "Detection baseline" : "v2.0"}
              />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-400 block mb-1">Description</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-20"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {(mode === "edit" || mode === "create") && (
            <>
              <div>
                <label className="text-xs text-gray-400 block mb-1">System Prompt</label>
                <textarea
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-24"
                  value={mode === "create" ? createSystemPrompt : editSystemPrompt}
                  onChange={(e) =>
                    mode === "create" ? setCreateSystemPrompt(e.target.value) : setEditSystemPrompt(e.target.value)
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">User Prompt Template</label>
                <textarea
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-32"
                  value={mode === "create" ? createUserPromptTemplate : editUserPromptTemplate}
                  onChange={(e) =>
                    mode === "create"
                      ? setCreateUserPromptTemplate(e.target.value)
                      : setEditUserPromptTemplate(e.target.value)
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className="text-xs text-gray-400 block mb-2">Label Policy</label>
            <div className="space-y-2">
              <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
                <span className="text-xs text-gray-500 mt-2">DETECTED:</span>
                <input
                  type="text"
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
                  value={formLabelPolicySections.detected}
                  onChange={(e) => updateFormLabelPolicySection("detected", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-[140px,1fr] gap-2 items-start">
                <span className="text-xs text-gray-500 mt-2">NOT DETECTED:</span>
                <input
                  type="text"
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm"
                  value={formLabelPolicySections.notDetected}
                  onChange={(e) => updateFormLabelPolicySection("notDetected", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Decision Rubric (3-7 criteria)</label>
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

          {mode === "create" && (
            <div>
              <label className="text-xs text-gray-400 block mb-2">Metric Thresholds</label>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Primary Metric</label>
                  <select
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm mt-1"
                    value={form.metric_thresholds.primary_metric}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        metric_thresholds: { ...form.metric_thresholds, primary_metric: e.target.value as any },
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

          <button
            onClick={mode === "create" ? handleCreateDetection : handleUpdateDetection}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
          >
            {mode === "create" ? "Save Detection" : "Save Changes"}
          </button>
        </div>
      )}

      {/* Detection Details View */}
      {mode === "view" && selectedDetection && (
        <>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-semibold">{selectedDetection.display_name}</h3>
                <code className="text-xs text-gray-400 mt-1 block">
                  {selectedDetection.detection_code}
                </code>
                <div className="mt-2 text-xs text-gray-400">
                  <span className="text-gray-500">Version:</span>{" "}
                  <span className="text-gray-300">{activePromptForTopPanel?.version_label || "Detection baseline"}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {selectedDetection.approved_prompt_version &&
                  selectedPromptId === selectedDetection.approved_prompt_version && (
                  <span className="text-xs bg-green-900/30 text-green-400 border border-green-800/50 px-2 py-1 rounded">
                    Approved prompt
                  </span>
                )}
                <button
                  onClick={startEdit}
                  className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Edit Detection
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-400 mb-3">{selectedDetection.description}</p>

            <div className="space-y-3 mb-3">
              <details className="px-1 py-1">
                <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">System Prompt</summary>
                <div className="mt-2">
                  <div className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono min-h-24 whitespace-pre-wrap text-gray-300">
                    {promptEditorDraft.system_prompt || "No system prompt."}
                  </div>
                </div>
              </details>

              <details className="px-1 py-1">
                <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">User Prompt Template</summary>
                <div className="mt-2">
                  <div className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono min-h-32 whitespace-pre-wrap text-gray-300">
                    {promptEditorDraft.user_prompt_template || "No user prompt template."}
                  </div>
                </div>
              </details>

              <details className="px-1 py-1">
                <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">Label Policy</summary>
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-[130px,1fr] gap-2 items-start">
                    <div className="text-xs text-gray-400">DETECTED:</div>
                    <div className="text-xs text-gray-300 whitespace-pre-wrap">
                      {labelPolicySections.detected || "No DETECTED guidance."}
                    </div>
                  </div>
                  <div className="grid grid-cols-[130px,1fr] gap-2 items-start">
                    <div className="text-xs text-gray-400">NOT DETECTED:</div>
                    <div className="text-xs text-gray-300 whitespace-pre-wrap">
                      {labelPolicySections.notDetected || "No NOT_DETECTED guidance."}
                    </div>
                  </div>
                </div>
              </details>

              <details className="px-1 py-1">
                <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">Decision Rubric</summary>
                <div className="mt-2">
                  <ol className="list-decimal list-inside text-xs text-gray-300 space-y-0.5">
                    {decisionRubricCriteria.length > 0 ? (
                      decisionRubricCriteria.map((r, i) => <li key={i}>{r}</li>)
                    ) : (
                      <li>No decision rubric.</li>
                    )}
                  </ol>
                </div>
              </details>
            </div>
          </div>

          {/* Prompt Versions */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium">Prompt Versions ({prompts.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (showPromptForm) {
                      setShowPromptForm(false);
                      return;
                    }
                    openNewPromptForm();
                  }}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded"
                >
                  {showPromptForm ? "Cancel" : "New Prompt Version"}
                </button>
              </div>
            </div>

            {showPromptForm && (
              <PromptForm
                detectionId={selectedDetection.detection_id}
                detectionCode={selectedDetection.detection_code}
                detectionLabelPolicy={selectedDetection.label_policy}
                detectionDecisionRubric={selectedDetection.decision_rubric}
                suggestedVersionLabel={promptFormSuggestedVersionLabel}
                initialData={promptFormInitialData}
                onSaved={() => { setShowPromptForm(false); loadRelated(); }}
              />
            )}

            <div className="space-y-2">
              {prompts.map((p) => (
                <div
                  key={p.prompt_version_id}
                  className={`border rounded-lg p-3 text-sm ${
                    p.prompt_version_id === selectedDetection.approved_prompt_version
                      ? "border-green-700 bg-green-900/10"
                      : "border-gray-700 bg-gray-900/30"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium">{p.version_label}</span>
                      <span className="text-xs text-gray-500 ml-2">{p.model} | temp={p.temperature}</span>
                      {p.prompt_version_id === selectedPromptId && (
                        <span className="ml-2 text-xs text-blue-300">SELECTED</span>
                      )}
                      {p.prompt_version_id === selectedDetection.approved_prompt_version && (
                        <span className="ml-2 text-xs text-green-400">APPROVED</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString()}</span>
                      <button
                        onClick={() => setSelectedPromptId(p.prompt_version_id)}
                        className="text-xs px-2 py-0.5 bg-blue-700/50 hover:bg-blue-700 rounded"
                      >
                        Select
                      </button>
                      <button
                        onClick={() => deletePromptVersion(p.prompt_version_id)}
                        className="text-xs px-2 py-0.5 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {p.change_notes && <p className="text-xs text-gray-400 mt-1">{p.change_notes}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">
                      View Label Policy & Decision Rubric Snapshot
                    </summary>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-gray-950/40 border border-gray-700 rounded p-3">
                        <h4 className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Label Policy</h4>
                        <p className="text-xs text-gray-300 whitespace-pre-wrap">
                          {p.prompt_structure?.label_policy || "No label policy snapshot saved in this version."}
                        </p>
                      </div>
                      <div className="bg-gray-950/40 border border-gray-700 rounded p-3">
                        <h4 className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Decision Rubric</h4>
                        <p className="text-xs text-gray-300 whitespace-pre-wrap">
                          {p.prompt_structure?.decision_rubric || "No decision rubric snapshot saved in this version."}
                        </p>
                      </div>
                    </div>
                  </details>
                  {p.golden_set_regression_result && (
                    <div className="mt-2 text-xs">
                      <span className={p.golden_set_regression_result.passed ? "text-green-400" : "text-red-400"}>
                        Regression: {p.golden_set_regression_result.passed ? "PASSED" : "FAILED"}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {prompts.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No prompt versions yet. Create one to get started.
                </p>
              )}
            </div>
          </div>

          {/* Run + Iterate */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Initial Run and Prompt Iteration</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Run on an iteration dataset, inspect outcomes and previews, then iterate quickly.
                </p>
              </div>
              <button
                onClick={runIteration}
                disabled={iterationRunning || !selectedPromptId || !selectedDatasetId}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
              >
                {iterationRunning ? "Running..." : "Run Now"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Prompt Version</label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-2 text-sm"
                  value={selectedPromptId}
                  onChange={(e) => setSelectedPromptId(e.target.value)}
                >
                  <option value="">Select prompt</option>
                  {prompts.map((p) => (
                    <option key={p.prompt_version_id} value={p.prompt_version_id}>
                      {p.version_label} | {p.model} | temp={p.temperature}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Dataset</label>
                <select
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-2 text-sm"
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                >
                  <option value="">Select dataset</option>
                  {datasets
                    .filter((d) => d.split_type !== "HELD_OUT_EVAL")
                    .map((d) => (
                      <option key={d.dataset_id} value={d.dataset_id}>
                        {d.name} ({splitTypeLabel(d.split_type)}, {d.size} images)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <details className="border border-gray-700 rounded-lg p-3 bg-gray-900/30">
              <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">
                Compiled Prompt Preview (used at run time)
              </summary>
              <pre className="mt-2 text-xs font-mono whitespace-pre-wrap text-gray-300 bg-gray-950/50 border border-gray-800 rounded p-3 max-h-72 overflow-auto">
                {compiledPromptPreview || "Select a prompt version to view the compiled prompt."}
              </pre>
            </details>

            {iterationRun && iterationRun.metrics_summary && (
              <MetricsDisplay metrics={iterationRun.metrics_summary} label={`Run ${iterationRun.run_id.slice(0, 8)} Results`} />
            )}

            {iterationPredictions.length > 0 && (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {([
                    ["all", "All"],
                    ["fp", "False Positives"],
                    ["fn", "False Negatives"],
                    ["parse_fail", "Parse Failures"],
                    ["correct", "Correct"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setIterationFilter(key)}
                      className={`text-xs px-2.5 py-1 rounded-full ${
                        iterationFilter === key
                          ? "bg-blue-600 text-white"
                          : "bg-gray-900 text-gray-400 border border-gray-700 hover:bg-gray-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-700 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-800 z-10">
                      <tr className="text-gray-500 border-b border-gray-700">
                        <th className="text-left py-2 px-3">Image</th>
                        <th className="text-left py-2 px-3">Preview</th>
                        <th className="text-center py-2 px-3">Ground Truth</th>
                        <th className="text-center py-2 px-3">Prediction</th>
                        <th className="text-right py-2 px-3">Confidence</th>
                        <th className="text-left py-2 px-3">Evidence</th>
                        <th className="text-center py-2 px-3">Parse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIterationPredictions.map((p) => (
                        <tr key={p.prediction_id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                          <td className="py-2 px-3 font-mono text-gray-300">{p.image_id}</td>
                          <td className="py-2 px-3">
                            <img
                              src={p.image_uri}
                              alt={p.image_id}
                              className="w-12 h-9 object-cover rounded cursor-pointer hover:opacity-80"
                              onClick={() => setSelectedPreviewImage(p.image_uri)}
                            />
                          </td>
                          <td className="text-center py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded ${p.ground_truth_label === "DETECTED" ? "bg-green-900/30 text-green-400" : "bg-gray-800 text-gray-400"}`}>
                              {p.ground_truth_label}
                            </span>
                          </td>
                          <td className="text-center py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded ${
                                p.predicted_decision === "DETECTED"
                                  ? "bg-green-900/30 text-green-400"
                                  : p.predicted_decision === "NOT_DETECTED"
                                  ? "bg-gray-800 text-gray-400"
                                  : "bg-red-900/30 text-red-400"
                              }`}
                            >
                              {p.predicted_decision || "PARSE_FAIL"}
                            </span>
                          </td>
                          <td className="text-right py-2 px-3 text-gray-300">
                            {p.confidence != null ? p.confidence.toFixed(2) : "—"}
                          </td>
                          <td className="py-2 px-3 text-gray-400 truncate max-w-[340px]">{p.evidence || "—"}</td>
                          <td className="text-center py-2 px-3">
                            <span className={p.parse_ok ? "text-green-400" : "text-red-400"}>
                              {p.parse_ok ? "OK" : "FAIL"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveTab(1)}
                    className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded"
                  >
                    Continue to HIL Review
                  </button>
                  <p className="text-xs text-gray-500">
                    The latest run is carried into HIL and Prompt Feedback.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Recent Runs */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-medium mb-4">Recent Runs ({runs.length})</h3>
            <div className="space-y-2">
              {runs.slice(0, 10).map((r: any) => (
                <div key={r.run_id} className="border border-gray-700 bg-gray-900/30 rounded-lg p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-xs font-mono text-gray-400">{r.run_id.slice(0, 8)}</span>
                    <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                    <span>
                      Prompt:{" "}
                      <b>
                        {prompts.find((p) => p.prompt_version_id === r.prompt_version_id)?.version_label ||
                          r.prompt_version_id?.slice(0, 8) ||
                          "—"}
                      </b>
                    </span>
                    <span>Split: <b>{splitTypeLabel(r.split_type)}</b></span>
                    <span>Status: <b className={r.status === "completed" ? "text-green-400" : "text-yellow-400"}>{r.status}</b></span>
                    <span>Accuracy: <b className="text-gray-300">{((r.metrics_summary?.accuracy || 0) * 100).toFixed(1)}%</b></span>
                    <span>Precision: <b className="text-blue-400">{((r.metrics_summary?.precision || 0) * 100).toFixed(1)}%</b></span>
                    <span>Recall: <b className="text-green-400">{((r.metrics_summary?.recall || 0) * 100).toFixed(1)}%</b></span>
                    {r.metrics_summary?.f1 != null && (
                      <span>F1: <b className="text-yellow-400">{(r.metrics_summary.f1 * 100).toFixed(1)}%</b></span>
                    )}
                    <span>Prevalence: <b className="text-purple-300">{((r.metrics_summary?.prevalence || 0) * 100).toFixed(1)}%</b></span>
                    <span>Parse Fail: <b className="text-orange-300">{((r.metrics_summary?.parse_failure_rate || 0) * 100).toFixed(1)}%</b></span>
                    <span>Total: <b className="text-gray-300">{r.metrics_summary?.total ?? r.total_images ?? 0}</b></span>
                  </div>
                </div>
              ))}
              {runs.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No runs yet.</p>
              )}
            </div>
          </div>
        </>
      )}

      {selectedPreviewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
          onClick={() => setSelectedPreviewImage(null)}
        >
          <img
            src={selectedPreviewImage}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] rounded-lg border border-gray-700"
          />
        </div>
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
  return [
    `DETECTED: ${parts.detected.trim()}`,
    `NOT_DETECTED: ${parts.notDetected.trim()}`,
  ].join("\n");
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

function PromptForm({
  detectionId,
  detectionCode,
  detectionLabelPolicy,
  detectionDecisionRubric,
  suggestedVersionLabel,
  onSaved,
  initialData,
}: {
  detectionId: string;
  detectionCode: string;
  detectionLabelPolicy: string;
  detectionDecisionRubric: string[];
  suggestedVersionLabel?: string;
  onSaved: () => void;
  initialData?: Partial<PromptVersion>;
}) {
  const defaultDecisionRubric = detectionDecisionRubric.length > 0
    ? detectionDecisionRubric.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "";

  const [form, setForm] = useState({
    version_label: initialData?.version_label || suggestedVersionLabel || "",
    system_prompt: initialData?.system_prompt || `You are a visual detection system. Your task is to analyze images for a specific detection type and return a structured JSON response.\n\nYou must ONLY return valid JSON matching the exact schema provided. No markdown, no commentary, no extra text.`,
    user_prompt_template: initialData?.user_prompt_template || `Analyze this image for the detection: {{DETECTION_CODE}}\n\nReturn ONLY this JSON:\n{\n  "detection_code": "{{DETECTION_CODE}}",\n  "decision": "DETECTED" or "NOT_DETECTED",\n  "confidence": <float 0-1>,\n  "evidence": "<short phrase describing visual basis>"\n}`,
    prompt_structure: initialData?.prompt_structure || {
      detection_identity: "",
      label_policy: detectionLabelPolicy,
      decision_rubric: defaultDecisionRubric,
      output_schema: `{"detection_code":"${detectionCode}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}`,
      examples: "",
    },
    model: initialData?.model || "gemini-2.5-flash",
    temperature: initialData?.temperature ?? 0,
    top_p: initialData?.top_p ?? 1,
    max_output_tokens: initialData?.max_output_tokens ?? 1024,
    change_notes: initialData?.change_notes || "",
    created_by: "user",
  });
  const [labelPolicyParts, setLabelPolicyParts] = useState(() =>
    parseLabelPolicySections((initialData?.prompt_structure as any)?.label_policy || detectionLabelPolicy || "")
  );

  useEffect(() => {
    setLabelPolicyParts(
      parseLabelPolicySections((form.prompt_structure as any).label_policy || detectionLabelPolicy || "")
    );
  }, [detectionLabelPolicy]);

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

  const handleSave = async () => {
    await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, detection_id: detectionId }),
    });
    onSaved();
  };

  return (
    <div className="border border-gray-600 rounded-lg p-4 mb-4 space-y-3 bg-gray-900/50">
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Version Label</label>
          <input
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={form.version_label}
            onChange={(e) => setForm({ ...form, version_label: e.target.value })}
            placeholder="v1.1"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Model</label>
          <select
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          >
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Temperature</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={form.temperature}
            onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Max Tokens</label>
          <input
            type="number"
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={form.max_output_tokens}
            onChange={(e) => setForm({ ...form, max_output_tokens: parseInt(e.target.value) || 1024 })}
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-gray-400 block">Label Policy</label>
          <span className="text-[10px] text-gray-600">Primary iteration target</span>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">DETECTED</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-20"
              value={labelPolicyParts.detected}
              onChange={(e) => updatePromptFormLabelPolicy("detected", e.target.value)}
              placeholder="Criteria for DETECTED"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1 block">NOT_DETECTED</label>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-20"
              value={labelPolicyParts.notDetected}
              onChange={(e) => updatePromptFormLabelPolicy("notDetected", e.target.value)}
              placeholder="Criteria for NOT_DETECTED"
            />
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-gray-400 block">Decision Rubric</label>
          <span className="text-[10px] text-gray-600">Primary iteration target</span>
        </div>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-40"
          value={(form.prompt_structure as any).decision_rubric || ""}
          onChange={(e) =>
            setForm({
              ...form,
              prompt_structure: { ...form.prompt_structure, decision_rubric: e.target.value },
            })
          }
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">System Prompt</label>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-24"
          value={form.system_prompt}
          onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          User Prompt Template <span className="text-gray-600">(use {"{{DETECTION_CODE}}"} as placeholder)</span>
        </label>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono h-40"
          value={form.user_prompt_template}
          onChange={(e) => setForm({ ...form, user_prompt_template: e.target.value })}
        />
      </div>

      <details className="text-sm">
        <summary className="text-xs text-blue-300 cursor-pointer hover:text-blue-200">
          Additional Structured Sections (optional)
        </summary>
        <div className="mt-2 space-y-2">
          {(["detection_identity", "output_schema", "examples"] as const).map((key) => (
            <div key={key}>
              <label className="text-xs text-gray-500 block mb-1">{key.replace(/_/g, " ")}</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs font-mono h-16"
                value={(form.prompt_structure as any)[key] || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    prompt_structure: { ...form.prompt_structure, [key]: e.target.value },
                  })
                }
              />
            </div>
          ))}
        </div>
      </details>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Change Notes</label>
        <input
          className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
          value={form.change_notes}
          onChange={(e) => setForm({ ...form, change_notes: e.target.value })}
        />
      </div>

      <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm">
        Save Prompt Version
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
