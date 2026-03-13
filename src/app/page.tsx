"use client";

import { useState, useEffect, useCallback } from "react";
import { KeyRound, Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { GEMINI_MODELS } from "@/lib/geminiModels";
import type { Detection } from "@/types";
import { DetectionSetup } from "@/components/DetectionSetup";
import { BuildDataset } from "@/components/BuildDataset";
import { PromptCompare } from "@/components/PromptCompare";
import { HilReview } from "@/components/HilReview";
import { PostHilMetrics } from "@/components/PostHilMetrics";
import { HeldOutEval } from "@/components/HeldOutEval";
import { DetectionDashboard } from "@/components/DetectionDashboard";
import { SavedDatasets } from "@/components/SavedDatasets";
import { AdminPrompts } from "@/components/AdminPrompts";

const TABS = [
  { label: "Detection Setup", id: 0, step: "1", description: "Configure detection and prompt versions" },
  { label: "Build & Run Datasets", id: 1, step: "2", description: "Load or build datasets and run VLM labeling" },
  { label: "HIL Review", id: 2, step: "3", description: "Review predictions and set ground truth" },
  { label: "Prompt Feedback", id: 3, step: "4", description: "Generate, accept, and save prompt improvements" },
  { label: "Prompt Compare", id: 4, step: "5", description: "Compare metrics across existing prompt runs" },
  { label: "Held-Out Eval", id: 5, step: "6", description: "Run final evaluation and regression checks" },
  { label: "Detections & Logs", id: 6, step: "", description: "Manage detections and inspect run logs" },
  { label: "Datasets", id: 7, step: "", description: "Manage datasets, items, and labels" },
  { label: "Admin", id: 8, step: "", description: "Manage Prompt Assist and Prompt Feedback templates" },
];

export default function Home() {
  const {
    activeTab,
    setActiveTab,
    selectedDetectionId,
    setSelectedDetectionId,
    apiKey,
    setApiKey,
    selectedModel,
    setSelectedModel,
    refreshCounter,
  } = useAppStore();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>(GEMINI_MODELS as unknown as string[]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [createTrigger, setCreateTrigger] = useState(0);

  const loadDetections = useCallback(async () => {
    const res = await fetch("/api/detections");
    const data = await res.json();
    setDetections(data);
  }, []);

  useEffect(() => {
    loadDetections();
  }, [loadDetections, refreshCounter]);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      setModelsLoading(true);
      try {
        const res = await fetch("/api/gemini/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey }),
        });
        const data = await res.json();
        const discovered = Array.isArray(data.models) ? data.models : [];
        const merged = Array.from(new Set([...(GEMINI_MODELS as unknown as string[]), ...discovered]));
        if (!cancelled) {
          setModelOptions(merged);
        }
      } catch {
        if (!cancelled) {
          setModelOptions(GEMINI_MODELS as unknown as string[]);
        }
      } finally {
        if (!cancelled) {
          setModelsLoading(false);
        }
      }
    };

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (modelOptions.length > 0 && !modelOptions.includes(selectedModel)) {
      setSelectedModel(modelOptions[0]);
    }
  }, [modelOptions, selectedModel, setSelectedModel]);

  const selectedDetection = detections.find((d) => d.detection_id === selectedDetectionId) || null;
  const activeTabMeta = TABS.find((tab) => tab.id === activeTab) || TABS[0];

  return (
    <div className="app-shell flex min-h-screen flex-col lg:flex-row">
      <aside className="app-panel shrink-0 border-b border-[var(--app-border)] lg:w-72 lg:border-b-0 lg:border-r">
        <div className="border-b border-[var(--app-border)] px-5 py-5">
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-[var(--app-text)]">Detection Lab</h1>
              <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                Build, evaluate, and refine prompt-based detection systems.
              </p>
            </div>
            <div className="app-card p-2">
              <Sparkles className="h-4 w-4 text-[#5cb8ff]" />
            </div>
          </div>
        </div>

        <div className="px-5 pt-4">
          <p className="app-kicker">Workflow</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {TABS.filter((t) => t.step).map((tab, i, arr) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative mt-1 w-full rounded-xl px-4 py-3 text-left transition-colors ${
                  isActive
                    ? "bg-[rgba(18,42,68,0.72)] text-[var(--app-text)] ring-1 ring-[rgba(165,189,218,0.16)]"
                    : "text-[var(--app-text-muted)] hover:bg-[var(--app-table-row-hover)] hover:text-[var(--app-text)]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      isActive
                        ? "bg-[#5cb8ff] text-slate-950"
                        : "border border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-subtle)]"
                    }`}
                  >
                    {tab.step}
                  </div>
                  <div className="min-w-0">
                    <span className={`block text-sm font-medium leading-tight ${isActive ? "text-[var(--app-text)]" : ""}`}>
                      {tab.label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-tight text-[var(--app-text-subtle)]">
                      {tab.description}
                    </span>
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div className="absolute bottom-[-6px] left-7 h-[8px] w-px bg-[var(--app-border)]" />
                )}
              </button>
            );
          })}

          <div className="mx-2 my-4 border-t border-[var(--app-border)]" />
          <div className="px-2 pb-2">
            <p className="app-kicker">Management</p>
          </div>

          {TABS.filter((t) => !t.step).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative mt-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                  isActive
                    ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)] ring-1 ring-[rgba(182,223,255,0.22)]"
                    : "text-[var(--app-text-muted)] hover:bg-[var(--app-table-row-hover)] hover:text-[var(--app-text)]"
                }`}
              >
                <svg
                  className={`h-4 w-4 shrink-0 ${isActive ? "text-[#5cb8ff]" : "text-[var(--app-text-subtle)]"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
                <div>
                  <span className={`text-sm font-medium ${isActive ? "text-[var(--app-text)]" : ""}`}>{tab.label}</span>
                  <span className="mt-1 block text-[11px] text-[var(--app-text-subtle)]">{tab.description}</span>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--app-border)] px-5 py-4 text-[11px] text-[var(--app-text-subtle)]">
          Guided workflow and system tools
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="sticky top-0 z-20 border-b border-[var(--app-border)] bg-[color:var(--app-surface-strong)] px-4 py-4 backdrop-blur md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="app-kicker mb-2">Workspace</div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                  className="app-btn app-btn-toolbar app-btn-md text-xs"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {apiKey ? "Update Session API Key" : "Add Session API Key"}
                </button>
              </div>
              {showApiKeyInput && (
                <div className="app-card-strong mt-3 max-w-sm p-4">
                  <label className="app-label mb-1 block">Gemini API Key (Optional)</label>
                  <input
                    type="password"
                    className="app-input px-3 py-2 text-sm"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIza..."
                  />
                  <p className="mt-2 text-[11px] text-[var(--app-text-subtle)]">
                    Stored in memory only. If blank, the server uses `GEMINI_API_KEY` from the environment.
                  </p>
                  <button
                    onClick={() => setShowApiKeyInput(false)}
                    className="app-btn app-btn-subtle app-btn-sm mt-3 text-xs"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
              <div className="min-w-[260px]">
                <label className="app-label mb-1 block">Active Detection</label>
                <select
                  className="app-select px-3 py-2 text-sm"
                  value={selectedDetectionId || ""}
                  onChange={(e) => {
                    const nextId = e.target.value || null;
                    setSelectedDetectionId(nextId);
                    if (nextId) {
                      setHasStarted(true);
                    } else {
                      setHasStarted(false);
                    }
                  }}
                >
                  <option value="">Select Detection</option>
                  {detections.map((d) => (
                    <option key={d.detection_id} value={d.detection_id}>
                      {d.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[220px]">
                <label className="app-label mb-1 block">Gemini Model</label>
                <select
                  className="app-select px-3 py-2 text-sm"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                {modelsLoading && (
                  <div className="mt-1 text-[11px] text-[var(--app-text-subtle)]">Refreshing model list...</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 md:px-6">
          {!hasStarted && activeTab !== 1 && activeTab !== 6 && activeTab !== 7 && activeTab !== 8 ? (
            <div className="mx-auto max-w-4xl pt-12">
              <div className="app-card-strong p-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface-soft)]">
                  <Sparkles className="h-6 w-6 text-[#5cb8ff]" />
                </div>
                <h3 className="text-3xl font-semibold text-white">Start a Detection Workflow</h3>
                <p className="mx-auto mt-3 max-w-2xl text-sm text-[var(--app-text-muted)]">
                  Choose an existing detection to continue iterating, or create a new one to define prompts, build datasets, and evaluate performance end to end.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setActiveTab(0);
                      setSelectedDetectionId(null);
                      setCreateTrigger((v) => v + 1);
                      setHasStarted(true);
                    }}
                    className="app-btn app-btn-primary px-4 py-2.5 text-sm"
                  >
                    Create New Detection
                  </button>
                </div>
              </div>
            </div>
          ) : !selectedDetectionId && activeTab !== 0 && activeTab !== 1 && activeTab !== 6 && activeTab !== 7 && activeTab !== 8 ? (
            <div className="app-card mx-auto max-w-3xl px-6 py-14 text-center">
              <p className="text-lg font-medium text-white">Select a detection to continue</p>
              <p className="mt-2 text-sm text-[var(--app-text-muted)]">
                Use the workspace header to choose an existing detection, or go to Detection Setup to create one.
              </p>
            </div>
          ) : (
            <>
              <div className={activeTab === 0 ? "block" : "hidden"}>
                <DetectionSetup
                  detections={detections}
                  selectedDetection={selectedDetection}
                  onRefresh={loadDetections}
                  createTrigger={createTrigger}
                />
              </div>
              <div className={activeTab === 1 ? "block" : "hidden"}>
                <BuildDataset detection={selectedDetection} />
              </div>
              {selectedDetection && (
                <div className={activeTab === 2 ? "block" : "hidden"}>
                  <HilReview detection={selectedDetection} />
                </div>
              )}
              {selectedDetection && (
                <div className={activeTab === 3 ? "block" : "hidden"}>
                  <PostHilMetrics detection={selectedDetection} />
                </div>
              )}
              {selectedDetection && (
                <div className={activeTab === 4 ? "block" : "hidden"}>
                  <PromptCompare detection={selectedDetection} />
                </div>
              )}
              {selectedDetection && (
                <div className={activeTab === 5 ? "block" : "hidden"}>
                  <HeldOutEval detection={selectedDetection} />
                </div>
              )}
              <div className={activeTab === 6 ? "block" : "hidden"}>
                <DetectionDashboard detections={detections} />
              </div>
              <div className={activeTab === 7 ? "block" : "hidden"}>
                <SavedDatasets detections={detections} />
              </div>
              <div className={activeTab === 8 ? "block" : "hidden"}>
                <AdminPrompts />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
