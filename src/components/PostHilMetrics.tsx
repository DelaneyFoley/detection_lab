"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import type { Detection, Run, Prediction, PromptVersion, PromptEditSuggestion } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";
import { formatMetricValue } from "@/lib/ui/metrics";

export function PostHilMetrics({ detection }: { detection: Detection }) {
  const { apiKey, selectedModel, selectedRunByDetection, setSelectedRunForDetection, refreshCounter, triggerRefresh } = useAppStore();
  const { notify } = useAppFeedback();
  const [runs, setRuns] = useState<Run[]>([]);
  const selectedRunId = selectedRunByDetection[detection.detection_id] || "";
  const [runData, setRunData] = useState<any>(null);
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

  const loadRun = useCallback(async () => {
    if (!selectedRunId) return;
    const res = await fetch(`/api/runs?run_id=${selectedRunId}`);
    const data = await res.json();
    setRunData(data);
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
        const next = (data.suggestions as PromptEditSuggestion[]).filter((suggestion) =>
          ["label_policy", "decision_policy", "decision_rubric", "user_prompt_addendum"].includes(String(suggestion.section || ""))
        );
        setSuggestions(next);
        setEditableSuggestions(next);
        setSelectedSuggestions(new Set());
        setLoadedFromRunLog(false);
      } else {
        notify({ message: data.error || "Failed to get suggestions.", tone: "error" });
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

    let newLabelPolicy = (prompt.prompt_structure as any)?.label_policy || "";
    let newDecisionRubric = (prompt.prompt_structure as any)?.decision_rubric || "";
    let newUserPromptAddendum = (prompt.prompt_structure as any)?.user_prompt_addendum || detection.user_prompt_addendum || "";

    for (const i of selectedSuggestions) {
      const s = editableSuggestions[i];
      if (s.section === "label_policy" || s.section === "decision_policy") {
        newLabelPolicy = newLabelPolicy.replace(s.old_text, s.new_text);
      } else if (s.section === "decision_rubric") {
        newDecisionRubric = newDecisionRubric.replace(s.old_text, s.new_text);
      } else if (s.section === "user_prompt_addendum") {
        newUserPromptAddendum = newUserPromptAddendum.replace(s.old_text, s.new_text);
      }
    }

    const versionNum = prompts.length + 1;
    const acceptedCount = selectedSuggestions.size;
    const suggestedCount = editableSuggestions.length;

    try {
      if (newUserPromptAddendum !== (detection.user_prompt_addendum || "")) {
        const detectionRes = await fetch("/api/detections", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detection_id: detection.detection_id,
            display_name: detection.display_name,
            description: detection.description,
            detection_category: detection.detection_category,
            label_policy: detection.label_policy,
            user_prompt_addendum: newUserPromptAddendum,
            decision_rubric: detection.decision_rubric,
            segment_taxonomy: detection.segment_taxonomy,
            metric_thresholds: detection.metric_thresholds,
            approved_prompt_version: detection.approved_prompt_version,
          }),
        });
        const detectionPayload = await detectionRes.json().catch(() => null);
        if (!detectionRes.ok) {
          throw new Error(detectionPayload?.error || "Failed to update detection addendum");
        }
      }

      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_id: detection.detection_id,
          version_label: `v${versionNum}.0`,
          prompt_structure: {
            ...(prompt.prompt_structure || {}),
            label_policy: newLabelPolicy,
            decision_rubric: newDecisionRubric,
            user_prompt_addendum: newUserPromptAddendum,
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

      notify({
        message: regressionResult
          ? `New prompt version saved. TEST regression: ${regressionResult.passed ? "PASSED" : "FAILED"}`
          : "New prompt version saved. No TEST dataset found for regression.",
        tone: "success",
      });

      loadRuns();
      triggerRefresh();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const metrics = runData?.metrics_summary;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="app-page-header">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="app-page-title">
            Prompt Feedback & Improvement
          </h2>
          <p className="app-page-copy">
            Review corrected run performance, analyze clustered failures, and turn accepted edits into a new prompt version.
          </p>
        </div>
      </div>

      {/* Run Selection */}
      <div className="app-section space-y-4">
        <div className="space-y-1">
          <div className="app-section-title">Run Analysis</div>
          <p className="app-section-copy">
            Load a completed run with HIL corrections applied and inspect AI-suggested prompt edits.
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <label className="app-label lg:w-28">Select Run</label>
          <select
            className="app-select flex-1 px-3 py-2 text-sm"
            value={selectedRunId}
            onChange={(e) => {
              const nextRunId = e.target.value;
              setSelectedRunForDetection(detection.detection_id, nextRunId);
            }}
          >
            <option value="">Choose a run...</option>
            {runs.map((r: any) => (
              <option key={r.run_id} value={r.run_id}>
                {formatRunOptionLabel(r, prompts.find((p) => p.prompt_version_id === r.prompt_version_id)?.version_label)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Metrics Display */}
      {metrics && (
        <MetricsDisplay
          metrics={metrics}
          label="Run Metrics"
          showConfusionMatrix={false}
          variant="flat"
        />
      )}

      {/* Prompt Improvement Assistant */}
      {runData && (
        <div className="app-section space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="app-section-title">Prompt Improvement Assistant</div>
              <p className="app-section-copy max-w-3xl">
                Review clustered failures, adjust the suggested edits, and promote the best changes into a new prompt version.
              </p>
            </div>
            <button
              onClick={getPromptSuggestions}
              disabled={loadingSuggestions}
              className="app-btn app-btn-subtle app-btn-md disabled:opacity-50 lg:self-start"
            >
              {loadingSuggestions ? "Analyzing..." : "Analyze Errors & Suggest Edits"}
            </button>
          </div>

          <p className="text-sm text-[var(--app-text-muted)]">
            The assistant prioritizes parse-failure fixes first, then FP/FN reduction. It analyzes clustered errors,
            reviewer notes/tags, and sampled images to propose up to 5 targeted prompt edits.
          </p>
          {loadedFromRunLog && (
            <p className="text-xs text-blue-300">
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
                  className={`cursor-pointer rounded-2xl p-4 transition ${
                    selectedSuggestions.has(i)
                      ? "bg-[rgba(18,44,61,0.72)] ring-1 ring-cyan-400/35"
                      : "bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.05)]"
                  }`}
                  onClick={() => toggleSuggestion(i)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(i)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSuggestion(i)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-[rgba(255,255,255,0.05)] px-2.5 py-1 text-[11px] text-gray-200">
                          {formatSectionLabel(s.section)}
                        </span>
                        <span className="text-xs text-gray-500">→ {s.failure_cluster}</span>
                        {typeof s.priority === "number" && (
                          <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-300">
                            Priority {s.priority}
                          </span>
                        )}
                        {s.risk && (
                          <span className="rounded-lg bg-[rgba(255,255,255,0.05)] px-2.5 py-1 text-[11px] text-gray-300">
                            Risk: {s.risk}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 text-xs lg:grid-cols-2">
                        <div>
                          <span className="app-label">Current Text</span>
                          <textarea
                            className="app-textarea mt-1 min-h-24 rounded-xl bg-[rgba(9,17,26,0.82)] p-3 font-mono text-xs text-gray-200"
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
                          <span className="app-label">Suggested Text</span>
                          <textarea
                            className="app-textarea mt-1 min-h-24 rounded-xl bg-[rgba(13,28,24,0.7)] p-3 font-mono text-xs text-emerald-100"
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
                        className="app-textarea mt-3 min-h-16 rounded-xl bg-[rgba(9,17,26,0.82)] px-3 py-2 text-xs text-gray-300"
                        value={draft.rationale}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          setEditableSuggestions((prev) =>
                            prev.map((item, idx) => (idx === i ? { ...item, rationale: e.target.value } : item))
                          )
                        }
                        />
                      {(s.expected_metric_impact || s.expected_parse_fail_impact) && (
                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-400">
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
                  className="app-btn app-btn-primary app-btn-md disabled:opacity-50"
                >
                  {saving ? "Saving..." : `Save ${selectedSuggestions.size} Accepted Edit${selectedSuggestions.size === 1 ? "" : "s"} as New Version`}
                </button>
                <p className="mt-2 text-xs text-gray-500">
                  Previous and new prompt versions will run automatically on the TEST split after saving.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {testRegressionResult && (
        <div className="app-section space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="app-section-title">Latest TEST Regression Outcome</div>
              <div className="text-xs text-gray-400">
                Evaluated: {new Date(testRegressionResult.evaluated_at).toLocaleString()}
              </div>
            </div>
            <div className={`text-sm font-medium ${testRegressionResult.passed ? "text-green-400" : "text-red-400"}`}>
              Result: {testRegressionResult.passed ? "PASSED" : "FAILED"}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 text-xs xl:grid-cols-2">
            <RegressionMetricsCard title="Previous Prompt (TEST)" run={testRegressionResult.previous} />
            <RegressionMetricsCard title="Accepted Prompt (TEST)" run={testRegressionResult.candidate} />
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

function formatRunOptionLabel(run: Run, promptLabel?: string): string {
  const prompt = promptLabel || String(run.prompt_version_id || "").slice(0, 8) || "Unknown prompt";
  const split = splitTypeLabel(run.split_type);
  const total = typeof run.metrics_summary?.total === "number" ? `${run.metrics_summary.total} images` : null;
  const f1 = typeof run.metrics_summary?.f1 === "number" ? `F1 ${(run.metrics_summary.f1 * 100).toFixed(1)}%` : null;
  const createdAt = run.created_at ? new Date(run.created_at).toLocaleString() : null;
  return [prompt, split, total, f1, createdAt].filter(Boolean).join(" · ");
}

function formatSectionLabel(section?: string): string {
  switch (section) {
    case "label_policy":
    case "decision_policy":
      return "Decision Policy";
    case "decision_rubric":
      return "Decision Rubric";
    case "user_prompt_addendum":
      return "User Prompt Addendum";
    default:
      return section ? section.replace(/_/g, " ") : "Prompt Section";
  }
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
      <div className="app-card p-3">
        <div className="text-gray-400 mb-1">{title}</div>
        <div className="text-gray-500">No metrics available.</div>
      </div>
    );
  }
  const metrics = run.metrics_summary || {};
  return (
    <div className="app-card p-3">
      <div className="text-gray-400 mb-1">{title}</div>
      <div className="text-gray-500 mb-2 font-mono">Run: {String(run.run_id || "").slice(0, 8)}</div>
      <div className="grid grid-cols-2 gap-2">
        <span>Accuracy: <b className="text-white">{formatMetricValue(metrics, "accuracy")}</b></span>
        <span>Precision: <b className="text-white">{formatMetricValue(metrics, "precision")}</b></span>
        <span>Recall: <b className="text-white">{formatMetricValue(metrics, "recall")}</b></span>
        <span>F1: <b className="text-white">{formatMetricValue(metrics, "f1")}</b></span>
      </div>
    </div>
  );
}
