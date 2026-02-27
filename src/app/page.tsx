"use client";

import { useState, useEffect, useCallback } from "react";
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
  { label: "Build Dataset", id: 1, step: "2", description: "Load or build datasets and run VLM labeling" },
  { label: "HIL Review", id: 2, step: "3", description: "Review predictions and set ground truth" },
  { label: "Prompt Feedback", id: 3, step: "4", description: "Generate, accept, and save prompt improvements" },
  { label: "Prompt Compare", id: 4, step: "5", description: "Compare metrics across existing prompt runs" },
  { label: "Held-Out Eval", id: 5, step: "6", description: "Run final evaluation and regression checks" },
  { label: "Detections & Logs", id: 6, step: "", description: "Manage detections and inspect run logs" },
  { label: "Datasets", id: 7, step: "", description: "Manage datasets, items, and labels" },
  { label: "Admin", id: 8, step: "", description: "Manage Prompt Assist and Prompt Feedback templates" },
];

export default function Home() {
  const { activeTab, setActiveTab, selectedDetectionId, setSelectedDetectionId, apiKey, setApiKey, selectedModel, setSelectedModel, refreshCounter } =
    useAppStore();
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

  const selectedDetection = detections.find((d) => d.detection_id === selectedDetectionId);

  return (
    <div className="flex h-screen">
      {/* Left Sidebar */}
      <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-gray-800">
          <h1 className="text-base font-semibold text-white tracking-tight">Detection Lab</h1>
          <p className="text-[10px] text-gray-500 mt-0.5 tracking-wide uppercase">
            VLM Playground
          </p>
        </div>

        {/* Workflow Steps */}
        <nav className="flex-1 overflow-y-auto py-3">
          <p className="px-4 mb-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            Workflow
          </p>
          {TABS.filter((t) => t.step).map((tab, i, arr) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors group relative ${
                  isActive
                    ? "bg-blue-900/20 text-white"
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
              >
                {/* Active indicator */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />
                )}

                {/* Step number */}
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {tab.step}
                </div>

                <div className="min-w-0">
                  <span className={`text-sm font-medium block leading-tight ${isActive ? "text-white" : ""}`}>
                    {tab.label}
                  </span>
                  <span className="text-[10px] text-gray-600 block mt-0.5 leading-tight">
                    {tab.description}
                  </span>
                </div>

                {/* Connector line between steps */}
                {i < arr.length - 1 && (
                  <div className="absolute left-[30px] -bottom-[2px] w-px h-[6px] bg-gray-800" />
                )}
              </button>
            );
          })}

          {/* Separator */}
          <div className="mx-4 my-3 border-t border-gray-800" />

          {/* Dashboard (non-step) */}
          {TABS.filter((t) => !t.step).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors relative ${
                  isActive
                    ? "bg-blue-900/20 text-white"
                    : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500" />
                )}
                <svg
                  className={`w-4 h-4 shrink-0 ${isActive ? "text-blue-400" : "text-gray-600"}`}
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
                  <span className={`text-sm font-medium ${isActive ? "text-white" : ""}`}>
                    {tab.label}
                  </span>
                  <span className="text-[10px] text-gray-600 block mt-0.5">
                    {tab.description}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-gray-800 p-4 text-[10px] text-gray-600">
          Workflow navigation
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-950 flex flex-col">
        {/* Top bar with context */}
        <div className="border-b border-gray-800 bg-gray-900/40 px-6 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium text-gray-200">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h2>
            <span className="text-gray-700">|</span>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-wide">Active Detection</label>
              <select
                className="bg-gray-800 border border-gray-700 text-xs rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500 min-w-56"
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
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-wide">Gemini Model</label>
              <select
                className="bg-gray-800 border border-gray-700 text-xs rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500 min-w-44"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
            {modelsLoading && (
              <>
                <span className="text-[10px] text-gray-600">Loading models...</span>
              </>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              className={`text-xs px-2.5 py-1.5 rounded border text-left ${
                apiKey
                  ? "border-green-800/50 text-green-400 bg-green-900/15"
                  : "border-yellow-800/50 text-yellow-400 bg-yellow-900/15"
              }`}
            >
              {"Swap API Key"}
            </button>
            {showApiKeyInput && (
              <div className="absolute right-0 top-full mt-2 bg-gray-800 border border-gray-700 rounded-lg p-3 z-50 shadow-xl w-72">
                <label className="text-xs text-gray-400 block mb-1">Gemini API Key (Optional)</label>
                <input
                  type="password"
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza..."
                />
                <p className="text-[10px] text-gray-500 mt-1">Stored in memory only. If blank, server uses GEMINI_API_KEY from .env.</p>
                <button
                  onClick={() => setShowApiKeyInput(false)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-6">
          {!hasStarted && activeTab !== 6 && activeTab !== 7 && activeTab !== 8 ? (
            <div className="max-w-3xl mx-auto pt-16">
              <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-8 text-center">
                <h3 className="text-2xl font-semibold text-white">Getting Started</h3>
                <p className="text-sm text-gray-400 mt-3">
                  Select an existing detection from the Active Detection dropdown, or create a new detection to begin.
                </p>
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => {
                      setActiveTab(0);
                      setSelectedDetectionId(null);
                      setCreateTrigger((v) => v + 1);
                      setHasStarted(true);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
                  >
                    Create New Detection
                  </button>
                </div>
              </div>
            </div>
          ) : !selectedDetectionId && activeTab !== 0 && activeTab !== 6 && activeTab !== 7 && activeTab !== 8 ? (
            <div className="text-center py-20 text-gray-500">
              <p className="text-lg">Select a detection to get started</p>
              <p className="text-sm mt-2">
                Use the sidebar dropdown or create a new detection in Step 1
              </p>
            </div>
          ) : (
            <>
              <div className={activeTab === 0 ? "block" : "hidden"}>
                <DetectionSetup
                  detections={detections}
                  selectedDetection={selectedDetection || null}
                  onRefresh={loadDetections}
                  createTrigger={createTrigger}
                />
              </div>
              {selectedDetection && (
                <div className={activeTab === 1 ? "block" : "hidden"}>
                  <BuildDataset detection={selectedDetection} />
                </div>
              )}
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
