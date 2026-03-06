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
  const [editableSuggestions, setEditableSuggestions] = useState<PromptEditSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loadedFromRunLog, setLoadedFromRunLog] = useState(false);
  const [testRegressionResult, setTestRegressionResult] = useState<{
    previous: { run_id: string; metrics_summary: any } | null;
    candidate: { run_id: string; metrics_summary: any } | null;
    passed: boolean | null;
    evaluated_at: string;
  } | null>(null);

  const loadRuns = useCallback(async () => {
    const [runsRes, promptsRes] = await Promise.all([
      fetch(`/api/runs?detection_id=${detection.detection_id}`),
      fetch(`/api/prompts?detection_id=${detection.detection_id}`),
    ]);
    setRuns((await runsRes.json()).filter((r: Run) => r.status === "completed"));
    setPrompts(await promptsRes.json());
  }, [detection.detection_id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns, refreshCounter]);

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
      setEditableSuggestions(combined);
      setSelectedSuggestions(selected);
      setLoadedFromRunLog(true);
    } else {
      setSuggestions([]);
      setEditableSuggestions([]);
      setSelectedSuggestions(new Set());
      setLoadedFromRunLog(false);
    }
    const prior = data?.prompt_feedback_log?.test_regression_result || null;
    setTestRegressionResult(prior);
  }, [selectedRunId]);

  useEffect(() => {
    loadRun();
  }, [loadRun, refreshCounter]);

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
        const next = data.suggestions as PromptEditSuggestion[];
        setSuggestions(next);
        setEditableSuggestions(next);
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
      const s = editableSuggestions[i];
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
    const acceptedCount = selectedSuggestions.size;
    const suggestedCount = editableSuggestions.length;

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
          change_notes: `AI edits accepted: ${acceptedCount}/${suggestedCount}`,
          created_by: "ai-assistant",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.prompt_version_id) {
        throw new Error(data?.error || "Failed to create new prompt version");
      }
      const accepted = editableSuggestions.filter((_, i) => selectedSuggestions.has(i));
      const rejected = editableSuggestions.filter((_, i) => !selectedSuggestions.has(i));

      // Run test regression for both previous and candidate prompt versions, if TEST dataset exists.
      const datasetsRes = await fetch(`/api/datasets?detection_id=${detection.detection_id}`);
      const datasets = await datasetsRes.json();
      const testDataset = datasets.find((d: any) => d.split_type === "GOLDEN");
      let regressionResult: {
        previous: { run_id: string; metrics_summary: any } | null;
        candidate: { run_id: string; metrics_summary: any } | null;
        passed: boolean | null;
        evaluated_at: string;
      } | null = null;

      if (testDataset) {
        const previousPrompt =
          [...prompts]
            .sort((a, b) => Date.parse(String(b.created_at || 0)) - Date.parse(String(a.created_at || 0)))[0] || prompt;
        const previousRun = await runPromptOnDataset({
          apiKey,
          selectedModel,
          promptVersionId: previousPrompt.prompt_version_id,
          datasetId: testDataset.dataset_id,
          detectionId: detection.detection_id,
        });
        const candidateRun = await runPromptOnDataset({
          apiKey,
          selectedModel,
          promptVersionId: data.prompt_version_id,
          datasetId: testDataset.dataset_id,
          detectionId: detection.detection_id,
        });
        if (!previousRun?.metrics_summary || !candidateRun?.metrics_summary) {
          throw new Error("TEST regression runs did not produce metrics.");
        }

        const thresholds = detection.metric_thresholds;
        const passed = checkThresholds(candidateRun.metrics_summary, thresholds);
        regressionResult = {
          previous: { run_id: previousRun.run_id, metrics_summary: previousRun.metrics_summary },
          candidate: { run_id: candidateRun.run_id, metrics_summary: candidateRun.metrics_summary },
          passed,
          evaluated_at: new Date().toISOString(),
        };
        setTestRegressionResult(regressionResult);

        await fetch("/api/prompts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt_version_id: data.prompt_version_id,
            golden_set_regression_result: {
              passed,
              run_id: candidateRun.run_id,
              metrics: candidateRun.metrics_summary,
              previous_metrics: previousRun.metrics_summary,
              evaluated_at: new Date().toISOString(),
            },
          }),
        });
      }
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
            test_regression_result: regressionResult,
          },
        }),
      });

      alert(
        regressionResult
          ? `New prompt version saved. TEST regression: ${regressionResult.passed ? "PASSED" : "FAILED"}`
          : "New prompt version saved. No TEST dataset found for regression."
      );

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
              {suggestions.map((s, i) => {
                const draft = editableSuggestions[i] || s;
                return (
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
                          <textarea
                            className="w-full bg-red-900/10 border border-red-900/30 rounded p-2 mt-1 whitespace-pre-wrap text-red-300 min-h-24"
                            value={draft.old_text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setEditableSuggestions((prev) =>
                                prev.map((item, idx) => (idx === i ? { ...item, old_text: e.target.value } : item))
                              )
                            }
                          />
                        </div>
                        <div>
                          <span className="text-green-400 text-xs font-sans">NEW:</span>
                          <textarea
                            className="w-full bg-green-900/10 border border-green-900/30 rounded p-2 mt-1 whitespace-pre-wrap text-green-300 min-h-24"
                            value={draft.new_text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setEditableSuggestions((prev) =>
                                prev.map((item, idx) => (idx === i ? { ...item, new_text: e.target.value } : item))
                              )
                            }
                          />
                        </div>
                      </div>

                      <textarea
                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 mt-2 text-xs text-gray-300 min-h-16"
                        value={draft.rationale}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setEditableSuggestions((prev) =>
                            prev.map((item, idx) => (idx === i ? { ...item, rationale: e.target.value } : item))
                          )
                        }
                      />
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
              )})}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={saveAsNewVersion}
                  disabled={selectedSuggestions.size === 0 || saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium"
                >
                  {saving ? "Saving..." : `Accept ${selectedSuggestions.size} Edit(s) & Save as New Version`}
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  Previous and new prompt versions will run automatically on the TEST split after saving.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {testRegressionResult && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-medium">Latest TEST Regression Outcome</h3>
          <div className="text-xs text-gray-400">
            Evaluated: {new Date(testRegressionResult.evaluated_at).toLocaleString()}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <RegressionMetricsCard title="Previous Prompt (TEST)" run={testRegressionResult.previous} />
            <RegressionMetricsCard title="Accepted Prompt (TEST)" run={testRegressionResult.candidate} />
          </div>
          <div className={`text-sm font-medium ${testRegressionResult.passed ? "text-green-400" : "text-red-400"}`}>
            Result: {testRegressionResult.passed ? "PASSED" : "FAILED"}
          </div>
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

async function runPromptOnDataset(input: {
  apiKey: string;
  selectedModel: string;
  promptVersionId: string;
  datasetId: string;
  detectionId: string;
}): Promise<any> {
  const regRes = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: input.apiKey,
      model_override: input.selectedModel,
      prompt_version_id: input.promptVersionId,
      dataset_id: input.datasetId,
      detection_id: input.detectionId,
    }),
  });
  const regStart = await regRes.json();
  if (!regRes.ok || !regStart?.run_id) {
    throw new Error(regStart?.error || "Failed to start TEST run");
  }
  return pollRunToTerminalState(regStart.run_id);
}

async function pollRunToTerminalState(runId: string): Promise<any> {
  while (true) {
    const res = await fetch(`/api/runs?run_id=${runId}`);
    const snapshot = await res.json();
    if (!res.ok) {
      throw new Error(snapshot?.error || "Failed to fetch run status");
    }
    if (snapshot?.status === "completed" || snapshot?.status === "cancelled" || snapshot?.status === "failed") {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function RegressionMetricsCard({
  title,
  run,
}: {
  title: string;
  run: { run_id: string; metrics_summary: any } | null;
}) {
  if (!run?.metrics_summary) {
    return (
      <div className="bg-gray-900/40 border border-gray-700 rounded p-3">
        <div className="text-gray-400 mb-1">{title}</div>
        <div className="text-gray-500">No metrics available.</div>
      </div>
    );
  }
  const metrics = run.metrics_summary || {};
  return (
    <div className="bg-gray-900/40 border border-gray-700 rounded p-3">
      <div className="text-gray-400 mb-1">{title}</div>
      <div className="text-gray-500 mb-2 font-mono">Run: {String(run.run_id || "").slice(0, 8)}</div>
      <div className="grid grid-cols-2 gap-1">
        <span>Accuracy: <b className="text-gray-300">{((metrics.accuracy || 0) * 100).toFixed(1)}%</b></span>
        <span>Precision: <b className="text-blue-400">{((metrics.precision || 0) * 100).toFixed(1)}%</b></span>
        <span>Recall: <b className="text-green-400">{((metrics.recall || 0) * 100).toFixed(1)}%</b></span>
        <span>F1: <b className="text-yellow-400">{((metrics.f1 || 0) * 100).toFixed(1)}%</b></span>
      </div>
    </div>
  );
}
