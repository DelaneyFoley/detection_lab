"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay, ConfusionMatrixPanel } from "@/components/MetricsDisplay";
import type { Detection, Run, Prediction, PromptVersion, PromptEditSuggestion } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

export function PostHilMetrics({ detection }: { detection: Detection }) {
  const { apiKey, selectedModel, selectedRunByDetection, setSelectedRunForDetection, refreshCounter, triggerRefresh } = useAppStore();
  const [runs, setRuns] = useState<Run[]>([]);
  const persistedRunId = selectedRunByDetection[detection.detection_id] || "";
  const [selectedRunId, setSelectedRunId] = useState(persistedRunId);
  const [runData, setRunData] = useState<any>(null);
  const [recomputedMetrics, setRecomputedMetrics] = useState<any>(null);
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [suggestions, setSuggestions] = useState<PromptEditSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadedFromRunLog, setLoadedFromRunLog] = useState(false);

  const loadRuns = useCallback(async () => {
    const [runsRes, promptsRes] = await Promise.all([
      fetch(`/api/runs?detection_id=${detection.detection_id}`),
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
    ]);
    setRuns((await runsRes.json()).filter((r: Run) => r.status === "completed"));
    setPrompts(await promptsRes.json());
  }, [detection.detection_id, refreshCounter]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setSelectedRunId(persistedRunId);
  }, [persistedRunId]);

  const loadRun = useCallback(async () => {
    if (!selectedRunId) return;
    const res = await fetch(`/api/runs?run_id=${selectedRunId}`);
    const data = await res.json();
    setRunData(data);
    setRecomputedMetrics(null);
    const feedback = data?.prompt_feedback_log || {};
    const accepted = Array.isArray(feedback.accepted) ? (feedback.accepted as PromptEditSuggestion[]) : [];
    const rejected = Array.isArray(feedback.rejected) ? (feedback.rejected as PromptEditSuggestion[]) : [];

    if (accepted.length > 0 || rejected.length > 0) {
      const combined = [...accepted, ...rejected];
      const acceptedKeys = new Set(accepted.map(suggestionKey));
      const selected = new Set<number>();
      combined.forEach((s, i) => {
        if (acceptedKeys.has(suggestionKey(s))) selected.add(i);
      });
      setSuggestions(combined);
      setSelectedSuggestions(selected);
      setLoadedFromRunLog(true);
    } else {
      setSuggestions([]);
      setSelectedSuggestions(new Set());
      setLoadedFromRunLog(false);
    }
  }, [selectedRunId, refreshCounter]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (selectedRunId) {
      setSelectedRunForDetection(detection.detection_id, selectedRunId);
    }
  }, [selectedRunId, detection.detection_id, setSelectedRunForDetection]);

  const recomputeMetrics = async () => {
    if (!selectedRunId) return;
    const res = await fetch("/api/hil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: selectedRunId }),
    });
    const data = await res.json();
    setRecomputedMetrics(data.metrics);
  };

  const getPromptSuggestions = async () => {
    if (!runData) return;

    setLoadingSuggestions(true);
    const prompt = prompts.find((p) => p.prompt_version_id === runData.prompt_version_id);
    if (!prompt) {
      setLoadingSuggestions(false);
      return;
    }

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          model_override: selectedModel,
          predictions: runData.predictions,
          prompt,
          detection,
        }),
      });
      const data = await res.json();
      if (data.suggestions) {
        setSuggestions(data.suggestions);
        setSelectedSuggestions(new Set());
        setLoadedFromRunLog(false);
      } else {
        alert(data.error || "Failed to get suggestions");
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingSuggestions(false);
  };

  const toggleSuggestion = (i: number) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const saveAsNewVersion = async () => {
    if (selectedSuggestions.size === 0) return;
    if (!runData) return;

    const prompt = prompts.find((p) => p.prompt_version_id === runData.prompt_version_id);
    if (!prompt) return;

    setSaving(true);

    let newSystemPrompt = prompt.system_prompt;
    let newUserPrompt = prompt.user_prompt_template;
    let newLabelPolicy = (prompt.prompt_structure as any)?.label_policy || "";
    let newDecisionRubric = (prompt.prompt_structure as any)?.decision_rubric || "";

    for (const i of selectedSuggestions) {
      const s = suggestions[i];
      if (s.section === "system_prompt") {
        newSystemPrompt = newSystemPrompt.replace(s.old_text, s.new_text);
      } else if (s.section === "user_prompt_template") {
        newUserPrompt = newUserPrompt.replace(s.old_text, s.new_text);
      } else if (s.section === "label_policy" || s.section === "decision_policy") {
        newLabelPolicy = newLabelPolicy.replace(s.old_text, s.new_text);
      } else if (s.section === "decision_rubric") {
        newDecisionRubric = newDecisionRubric.replace(s.old_text, s.new_text);
      }
    }

    const versionNum = prompts.length + 1;
    const changeNotes = Array.from(selectedSuggestions)
      .map((i) => suggestions[i].rationale)
      .join("; ");

    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_id: detection.detection_id,
          version_label: `v${versionNum}.0`,
          system_prompt: newSystemPrompt,
          user_prompt_template: newUserPrompt,
          prompt_structure: {
            ...(prompt.prompt_structure || {}),
            label_policy: newLabelPolicy,
            decision_rubric: newDecisionRubric,
          },
          model: prompt.model,
          temperature: prompt.temperature,
          top_p: prompt.top_p,
          max_output_tokens: prompt.max_output_tokens,
          change_notes: `AI-suggested edits: ${changeNotes}`,
          created_by: "ai-assistant",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.prompt_version_id) {
        throw new Error(data?.error || "Failed to create new prompt version");
      }
      const accepted = suggestions.filter((_, i) => selectedSuggestions.has(i));
      const rejected = suggestions.filter((_, i) => !selectedSuggestions.has(i));

      await fetch("/api/runs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runData.run_id,
          prompt_feedback_log: {
            accepted,
            rejected,
            created_prompt_version_id: data?.prompt_version_id || null,
            created_at: new Date().toISOString(),
          },
        }),
      });

      // Run golden regression if dataset exists
      const datasetsRes = await fetch(`/api/datasets?detection_id=${detection.detection_id}`);
      const datasets = await datasetsRes.json();
      const goldenDataset = datasets.find((d: any) => d.split_type === "GOLDEN");

      if (goldenDataset) {
        const regRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            model_override: selectedModel,
            prompt_version_id: data.prompt_version_id,
            dataset_id: goldenDataset.dataset_id,
            detection_id: detection.detection_id,
          }),
        });
        const regRun = await regRes.json();

        // Check regression
        const thresholds = detection.metric_thresholds;
        const passed = checkThresholds(regRun.metrics, thresholds);

        await fetch("/api/prompts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt_version_id: data.prompt_version_id,
            golden_set_regression_result: {
              passed,
              run_id: regRun.run_id,
              metrics: regRun.metrics,
              previous_metrics: recomputedMetrics || runData?.metrics_summary,
              evaluated_at: new Date().toISOString(),
            },
          }),
        });

        alert(`New prompt version saved. Golden regression: ${passed ? "PASSED" : "FAILED"}`);
      } else {
        alert("New prompt version saved. No golden dataset found for regression.");
      }

      loadRuns();
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const metrics = recomputedMetrics || runData?.metrics_summary;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">Post-HIL Metrics & Prompt Improvement</h2>

      {/* Run Selection */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <label className="text-xs text-gray-400">Select Run:</label>
          <select
            className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm flex-1"
            value={selectedRunId}
            onChange={(e) => {
              const nextRunId = e.target.value;
              setSelectedRunId(nextRunId);
              if (nextRunId) {
                setSelectedRunForDetection(detection.detection_id, nextRunId);
              }
            }}
          >
            <option value="">Choose a run...</option>
            {runs.map((r: any) => (
              <option key={r.run_id} value={r.run_id}>
                {(prompts.find((p) => p.prompt_version_id === r.prompt_version_id)?.version_label || r.prompt_version_id?.slice(0, 8) || "Unknown prompt")} — {r.run_id.slice(0, 8)} — {splitTypeLabel(r.split_type)} — {new Date(r.created_at).toLocaleString()}
              </option>
            ))}
          </select>
          <button
            onClick={recomputeMetrics}
            disabled={!selectedRunId}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm"
          >
            Recompute Metrics
          </button>
        </div>

        {recomputedMetrics && (
          <p className="text-xs text-green-400 mt-2">Metrics recomputed with HIL corrections applied.</p>
        )}
      </div>

      {/* Metrics Display */}
      {metrics && (
        <div className="space-y-3">
          <MetricsDisplay
            metrics={metrics}
            label={recomputedMetrics ? "Recomputed Metrics (Post-HIL)" : "Original Run Metrics"}
            showConfusionMatrix={false}
          />
          <details className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">
              View Confusion Matrix
            </summary>
            <div className="mt-3">
              <ConfusionMatrixPanel metrics={metrics} />
            </div>
          </details>
        </div>
      )}

      {/* Prompt Improvement Assistant */}
      {runData && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium">Prompt Improvement Assistant</h3>
            <button
              onClick={getPromptSuggestions}
              disabled={loadingSuggestions}
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
            >
              {loadingSuggestions ? "Analyzing..." : "Analyze Errors & Suggest Edits"}
            </button>
          </div>

          <p className="text-xs text-gray-400 mb-4">
            The assistant prioritizes parse-failure fixes first, then FP/FN reduction. It analyzes clustered errors,
            reviewer notes/tags, and sampled images to propose up to 5 targeted prompt edits.
          </p>
          {loadedFromRunLog && (
            <p className="text-xs text-blue-300 mb-3">
              Loaded prior accepted/rejected suggestions for this run. You can adjust selections and save a new version.
            </p>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedSuggestions.has(i)
                      ? "border-purple-600 bg-purple-900/10"
                      : "border-gray-700 bg-gray-900/30 hover:border-gray-600"
                  }`}
                  onClick={() => toggleSuggestion(i)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(i)}
                      onChange={() => toggleSuggestion(i)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-2">
                        <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">
                          {s.section}
                        </span>
                        <span className="text-xs text-gray-500">→ {s.failure_cluster}</span>
                        {typeof s.priority === "number" && (
                          <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded">
                            Priority {s.priority}
                          </span>
                        )}
                        {s.risk && (
                          <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">
                            Risk: {s.risk}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div>
                          <span className="text-red-400 text-xs font-sans">OLD:</span>
                          <div className="bg-red-900/10 border border-red-900/30 rounded p-2 mt-1 whitespace-pre-wrap text-red-300">
                            {s.old_text}
                          </div>
                        </div>
                        <div>
                          <span className="text-green-400 text-xs font-sans">NEW:</span>
                          <div className="bg-green-900/10 border border-green-900/30 rounded p-2 mt-1 whitespace-pre-wrap text-green-300">
                            {s.new_text}
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-gray-400 mt-2">{s.rationale}</p>
                      {(s.expected_metric_impact || s.expected_parse_fail_impact) && (
                        <div className="mt-2 text-[11px] text-gray-500 space-y-1">
                          {s.expected_metric_impact && (
                            <div>Expected metric impact: {s.expected_metric_impact}</div>
                          )}
                          {s.expected_parse_fail_impact && (
                            <div>Expected parse-fail impact: {s.expected_parse_fail_impact}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={saveAsNewVersion}
                  disabled={selectedSuggestions.size === 0 || saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium"
                >
                  {saving ? "Saving..." : `Accept ${selectedSuggestions.size} Edit(s) & Save as New Version`}
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  A golden set regression will run automatically after saving.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function checkThresholds(metrics: any, thresholds: any): boolean {
  if (thresholds.min_precision != null && metrics.precision < thresholds.min_precision) return false;
  if (thresholds.min_recall != null && metrics.recall < thresholds.min_recall) return false;
  if (thresholds.min_f1 != null && metrics.f1 < thresholds.min_f1) return false;
  return true;
}

function suggestionKey(s: PromptEditSuggestion): string {
  return [s.section, s.old_text, s.new_text, s.rationale, s.failure_cluster].join("|");
}
