"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { Dataset, DatasetItem, Detection, PromptVersion } from "@/types";
import { splitTypeLabel } from "@/lib/splitType";

type BuildRow = {
  id: string;
  file?: File;
  preview: string;
  imageId: string;
  groundTruthLabel: "DETECTED" | "NOT_DETECTED" | null;
  aiAssignedLabel?: "DETECTED" | "NOT_DETECTED" | "PARSE_FAIL" | "";
  aiConfidence?: number | null;
  aiDescription?: string;
};

export function BuildDataset({ detection }: { detection: Detection }) {
  const { apiKey, selectedModel, setActiveTab, setSelectedRunForDetection, triggerRefresh } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [mode, setMode] = useState<"load" | "build">("load");

  const [selectedExistingDatasetId, setSelectedExistingDatasetId] = useState("");

  const [datasetName, setDatasetName] = useState("");
  const [splitType, setSplitType] = useState<"ITERATION" | "CUSTOM">("ITERATION");
  const [rows, setRows] = useState<BuildRow[]>([]);

  const [building, setBuilding] = useState(false);
  const [buildMode, setBuildMode] = useState<"save" | "run" | null>(null);
  const [status, setStatus] = useState("");
  const [builtDatasetId, setBuiltDatasetId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      const [promptsRes, datasetsRes] = await Promise.all([
        fetch(`/api/prompts?detection_id=${detection.detection_id}`),
        fetch(`/api/datasets?detection_id=${detection.detection_id}`),
      ]);
      const promptRows = (await promptsRes.json()) as PromptVersion[];
      const datasetRows = (await datasetsRes.json()) as Dataset[];
      setPrompts(Array.isArray(promptRows) ? promptRows : []);
      setDatasets(Array.isArray(datasetRows) ? datasetRows : []);
      if (Array.isArray(promptRows) && promptRows[0]?.prompt_version_id) {
        setSelectedPromptId((prev) => prev || promptRows[0].prompt_version_id);
      }
      if (Array.isArray(datasetRows) && datasetRows[0]?.dataset_id) {
        setSelectedExistingDatasetId((prev) => prev || datasetRows[0].dataset_id);
      }
    };
    loadData();
  }, [detection.detection_id]);

  useEffect(() => {
    if (mode !== "load" || !selectedExistingDatasetId) return;
    const loadItems = async () => {
      const res = await fetch(`/api/datasets?dataset_id=${selectedExistingDatasetId}`);
      const data = await res.json();
      const items: DatasetItem[] = Array.isArray(data?.items) ? data.items : [];
      setRows(
        items.map((item) => ({
          id: item.item_id,
          preview: item.image_uri,
          imageId: item.image_id,
          groundTruthLabel: item.ground_truth_label ?? null,
          aiAssignedLabel: "",
          aiConfidence: null,
          aiDescription: "",
        }))
      );
      setBuiltDatasetId(selectedExistingDatasetId);
    };
    loadItems();
  }, [mode, selectedExistingDatasetId]);

  useEffect(() => {
    return () => {
      rows.forEach((r) => {
        if (r.file && r.preview.startsWith("blob:")) {
          URL.revokeObjectURL(r.preview);
        }
      });
    };
  }, [rows]);

  const canSave = useMemo(
    () => mode === "build" && rows.length > 0 && datasetName.trim().length > 0,
    [mode, rows.length, datasetName]
  );
  const canRun = useMemo(
    () => !!apiKey && !!selectedPromptId && (mode === "load" ? !!selectedExistingDatasetId : canSave),
    [apiKey, selectedPromptId, mode, selectedExistingDatasetId, canSave]
  );

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;
    const next = picked.map((file, i) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        id: `${Date.now()}_${i}_${base}`,
        file,
        preview: URL.createObjectURL(file),
        imageId: sanitizeImageId(base || `image_${i + 1}`),
        groundTruthLabel: null,
        aiAssignedLabel: "" as const,
        aiConfidence: null,
        aiDescription: "",
      };
    });
    setRows((prev) => [...prev, ...next]);
    event.currentTarget.value = "";
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.file && target.preview.startsWith("blob:")) URL.revokeObjectURL(target.preview);
      return prev.filter((r) => r.id !== id);
    });
  };

  const createDatasetOnly = async () => {
    setStatus("Saving dataset...");
    const formData = new FormData();
    formData.append("name", datasetName.trim());
    formData.append("detection_id", detection.detection_id);
    formData.append("split_type", splitType);
    formData.append(
      "items",
      JSON.stringify(
        rows.map((r) => ({
          image_id: r.imageId,
          image_description: "",
          ground_truth_label: null,
        }))
      )
    );
    rows.forEach((r) => {
      if (r.file) formData.append("files", r.file);
    });

    const createRes = await fetch("/api/datasets", { method: "POST", body: formData });
    const created = await createRes.json();
    if (!createRes.ok || !created?.dataset_id) {
      throw new Error(created?.error || "Failed to create dataset");
    }

    const datasetId = created.dataset_id as string;
    setBuiltDatasetId(datasetId);
    triggerRefresh();
    return datasetId;
  };

  const runOnDataset = async (datasetId: string) => {
    setStatus("Running VLM...");
    const runRes = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        model_override: selectedModel,
        prompt_version_id: selectedPromptId,
        dataset_id: datasetId,
        detection_id: detection.detection_id,
      }),
    });
    const run = await runRes.json();
    if (!runRes.ok || !run?.run_id) {
      throw new Error(run?.error || "Failed to run inference");
    }

    const fullRunRes = await fetch(`/api/runs?run_id=${run.run_id}`);
    const fullRun = await fullRunRes.json();
    const predictions = Array.isArray(fullRun?.predictions) ? fullRun.predictions : [];
    const byImageId = new Map<string, any>();
    for (const p of predictions) byImageId.set(p.image_id, p);

    setRows((prev) =>
      prev.map((r) => {
        const p = byImageId.get(r.imageId);
        const aiAssignedLabel =
          p?.parse_ok && (p?.predicted_decision === "DETECTED" || p?.predicted_decision === "NOT_DETECTED")
            ? p.predicted_decision
            : p
            ? "PARSE_FAIL"
            : "";
        return {
          ...r,
          aiAssignedLabel,
          aiConfidence: typeof p?.confidence === "number" ? p.confidence : null,
          aiDescription: p?.evidence || "",
        };
      })
    );

    setSelectedRunForDetection(detection.detection_id, run.run_id);
    setStatus("Run complete. AI outputs are now shown below and persisted in Run Log.");
  };

  const saveDataset = async () => {
    if (!canSave) return;
    setBuilding(true);
    setBuildMode("save");
    setBuiltDatasetId(null);
    try {
      await createDatasetOnly();
      setStatus("Dataset saved.");
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Save failed"}`);
    } finally {
      setBuilding(false);
      setBuildMode(null);
    }
  };

  const runDataset = async () => {
    if (!canRun) return;
    setBuilding(true);
    setBuildMode("run");
    try {
      let datasetId = selectedExistingDatasetId;
      if (mode === "build") {
        datasetId = builtDatasetId || (await createDatasetOnly());
      }
      await runOnDataset(datasetId);
      setBuiltDatasetId(datasetId);
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : "Run failed"}`);
    } finally {
      setBuilding(false);
      setBuildMode(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <h2 className="text-xl font-semibold">Build Dataset</h2>
      <p className="text-sm text-gray-500">
        Option 1: load an existing labeled dataset. Option 2: build a new unlabeled dataset. Then run the selected prompt version.
      </p>

      <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setMode("load")}
            className={`px-3 py-1.5 text-xs rounded ${mode === "load" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
          >
            Load Dataset
          </button>
          <button
            onClick={() => {
              setMode("build");
              setBuiltDatasetId(null);
            }}
            className={`px-3 py-1.5 text-xs rounded ${mode === "build" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
          >
            Build Dataset
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Prompt Version</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
              value={selectedPromptId}
              onChange={(e) => setSelectedPromptId(e.target.value)}
            >
              <option value="">Select prompt</option>
              {prompts.map((p) => (
                <option key={p.prompt_version_id} value={p.prompt_version_id}>
                  {p.version_label}
                </option>
              ))}
            </select>
          </div>

          {mode === "load" ? (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Saved Dataset</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                value={selectedExistingDatasetId}
                onChange={(e) => setSelectedExistingDatasetId(e.target.value)}
              >
                <option value="">Select dataset</option>
                {datasets.map((d) => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.name} ({splitTypeLabel(d.split_type)}, {d.size} images)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Dataset Name</label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="e.g. New Exterior Batch"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Split Type</label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={splitType}
                  onChange={(e) => setSplitType(e.target.value as "ITERATION" | "CUSTOM")}
                >
                  <option value="ITERATION">TRAIN</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              </div>
            </>
          )}
        </div>

        {mode === "build" && (
          <div>
            <label className="text-xs text-gray-400 block mb-1">Unlabeled Images</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="max-h-72 overflow-auto border border-gray-800 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900/90">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left px-2 py-2">Preview</th>
                  <th className="text-left px-2 py-2">Image ID</th>
                  <th className="text-left px-2 py-2">Ground Truth</th>
                  <th className="text-left px-2 py-2">AI Label</th>
                  <th className="text-left px-2 py-2">Confidence (0-1)</th>
                  <th className="text-left px-2 py-2">AI Description</th>
                  {mode === "build" && <th className="text-right px-2 py-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-900/70">
                    <td className="px-2 py-2">
                      <img src={r.preview} alt={r.imageId} className="w-24 h-16 object-cover rounded border border-gray-700" />
                    </td>
                    <td className="px-2 py-2">
                      {mode === "build" ? (
                        <input
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
                          value={r.imageId}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, imageId: sanitizeImageId(e.target.value) } : x))
                            )
                          }
                        />
                      ) : (
                        <span className="font-mono text-gray-300">{r.imageId}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-gray-300 whitespace-nowrap">{r.groundTruthLabel || "UNSET"}</td>
                    <td className="px-2 py-2 text-gray-300 whitespace-nowrap">{r.aiAssignedLabel || "—"}</td>
                    <td className="px-2 py-2 text-gray-300 whitespace-nowrap">
                      {typeof r.aiConfidence === "number" ? r.aiConfidence.toFixed(2) : "—"}
                    </td>
                    <td className="px-2 py-2 text-gray-400 max-w-xs truncate" title={r.aiDescription || ""}>
                      {r.aiDescription || "—"}
                    </td>
                    {mode === "build" && (
                      <td className="px-2 py-2 text-right">
                        <button className="text-red-400 hover:text-red-300" onClick={() => removeRow(r.id)}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={runDataset}
            disabled={!canRun || building}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
          >
            {building && buildMode === "run" ? "Running..." : "Run"}
          </button>
          {mode === "build" && (
            <button
              onClick={saveDataset}
              disabled={!canSave || building}
              className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
            >
              {building && buildMode === "save" ? "Saving..." : "Save"}
            </button>
          )}
          {builtDatasetId && (
            <button onClick={() => setActiveTab(2)} className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded">
              Go to HIL Review
            </button>
          )}
        </div>
        {status && <div className="text-xs text-gray-400">{status}</div>}
      </div>
    </div>
  );
}

function sanitizeImageId(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}
