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
  const { apiKey, selectedModel, setActiveTab, setSelectedRunForDetection, triggerRefresh, refreshCounter } = useAppStore();
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [mode, setMode] = useState<"load" | "build">("load");

  const [selectedExistingDatasetId, setSelectedExistingDatasetId] = useState("");

  const [datasetName, setDatasetName] = useState("");
  const [splitType, setSplitType] = useState<"ITERATION" | "CUSTOM">("ITERATION");
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [buildInputMode, setBuildInputMode] = useState<"files" | "csv">("files");
  const [csvFileName, setCsvFileName] = useState("");

  const [building, setBuilding] = useState(false);
  const [buildMode, setBuildMode] = useState<"save" | "run" | null>(null);
  const [status, setStatus] = useState("");
  const [builtDatasetId, setBuiltDatasetId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelingRun, setCancelingRun] = useState(false);

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
  }, [detection.detection_id, refreshCounter]);

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
    () => mode === "build" && rows.length > 0 && datasetName.trim().length > 0 && validateImageIds(rows).ok,
    [mode, rows, datasetName]
  );
  const canRun = useMemo(
    () => !!selectedPromptId && (mode === "load" ? !!selectedExistingDatasetId : canSave),
    [selectedPromptId, mode, selectedExistingDatasetId, canSave]
  );
  const selectedBuildFileCount = useMemo(
    () => rows.filter((r) => !!r.file).length,
    [rows]
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
    setValidationError("");
    event.currentTarget.value = "";
  };

  const onPickCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsvManifest(text);
      const mapped: BuildRow[] = parsed.map((row, i) => ({
        id: `${Date.now()}_csv_${i}_${row.image_id}`,
        preview: row.image_url,
        imageId: row.image_id,
        groundTruthLabel: row.ground_truth_label,
        aiAssignedLabel: "",
        aiConfidence: null,
        aiDescription: "",
      }));
      setRows(mapped);
      setCsvFileName(file.name);
      setValidationError("");
      setStatus(`Loaded ${mapped.length} rows from ${file.name}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to parse CSV";
      setValidationError(msg);
    } finally {
      event.currentTarget.value = "";
    }
  };

  const removeRow = (id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.file && target.preview.startsWith("blob:")) URL.revokeObjectURL(target.preview);
      return prev.filter((r) => r.id !== id);
    });
    setValidationError("");
  };

  const createDatasetOnly = async () => {
    const validation = validateImageIds(rows);
    if (!validation.ok) throw new Error(validation.error);

    setStatus("Saving dataset...");
    const allRowsHaveFiles = rows.every((r) => !!r.file);
    const createRes = allRowsHaveFiles
      ? await (async () => {
          const formData = new FormData();
          formData.append("name", datasetName.trim());
          formData.append("detection_id", detection.detection_id);
          formData.append("split_type", splitType);
          formData.append(
            "items",
            JSON.stringify(
              rows.map((r) => ({
                image_id: r.imageId.trim(),
                image_description: "",
                ground_truth_label: r.groundTruthLabel,
              }))
            )
          );
          rows.forEach((r) => {
            if (r.file) formData.append("files", r.file);
          });
          return fetch("/api/datasets", { method: "POST", body: formData });
        })()
      : await fetch("/api/datasets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: datasetName.trim(),
            detection_id: detection.detection_id,
            split_type: splitType,
            items: rows.map((r) => ({
              image_id: r.imageId.trim(),
              image_uri: r.preview,
              image_description: "",
              ground_truth_label: r.groundTruthLabel,
            })),
          }),
        });
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
    setStatus("Starting run...");
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
    setActiveRunId(run.run_id);

    const fullRun = await pollRunToTerminalState(run.run_id, (snapshot) => {
      const total = Number(snapshot?.total_images || 0);
      const processed = Number(snapshot?.processed_images || 0);
      const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
      const stateLabel = String(snapshot?.status || "running").toUpperCase();
      setStatus(`Run ${stateLabel}: ${processed}/${total} images (${pct}%)`);
    });

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
    triggerRefresh();
    const processed = Number(fullRun?.processed_images || predictions.length || 0);
    const total = Number(fullRun?.total_images || rows.length || 0);
    if (fullRun?.status === "cancelled") {
      setStatus(`Run cancelled. Saved ${processed}/${total} processed images.`);
    } else if (fullRun?.status === "failed") {
      setStatus("Run failed. Partial outputs (if any) were saved.");
    } else {
      setStatus(`Run complete. Processed ${processed}/${total} images.`);
    }
    setActiveRunId(null);
    setCancelingRun(false);
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    setCancelingRun(true);
    setStatus("Cancel requested. Finishing in-flight images...");
    await fetch("/api/runs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: activeRunId, action: "cancel" }),
    });
  };

  const resetBuilder = () => {
    if (mode === "load") {
      setSelectedExistingDatasetId("");
      setRows([]);
      setBuiltDatasetId(null);
      setStatus("");
      setValidationError("");
      return;
    }
    setDatasetName("");
    setSplitType("ITERATION");
    setRows([]);
    setBuildInputMode("files");
    setCsvFileName("");
    setBuiltDatasetId(null);
    setStatus("");
    setValidationError("");
  };

  const saveDataset = async () => {
    if (!canSave) return;
    const validation = validateImageIds(rows);
    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }
    setValidationError("");
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
    const validation = validateImageIds(rows);
    if (mode === "build" && !validation.ok) {
      setValidationError(validation.error);
      return;
    }
    setValidationError("");
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
      setActiveRunId(null);
      setCancelingRun(false);
    } finally {
      setBuilding(false);
      setBuildMode(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <h2 className="text-xl font-semibold">Build Dataset</h2>
      <p className="text-sm text-gray-500">
        Option 1: load an existing labeled dataset. Option 2: build a new dataset from files or CSV, then run the selected prompt version.
      </p>

      <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
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
          <button
            onClick={resetBuilder}
            disabled={building}
            className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded"
          >
            Reset
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
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBuildInputMode("files")}
                className={`px-3 py-1.5 text-xs rounded ${buildInputMode === "files" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
              >
                Upload Images
              </button>
              <button
                type="button"
                onClick={() => setBuildInputMode("csv")}
                className={`px-3 py-1.5 text-xs rounded ${buildInputMode === "csv" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300"}`}
              >
                Upload CSV
              </button>
            </div>

            {buildInputMode === "files" ? (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Image Files</label>
                <div className="flex items-center gap-3">
                  <input
                    id="build-dataset-files-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onPickFiles}
                    className="hidden"
                  />
                  <label
                    htmlFor="build-dataset-files-input"
                    className="px-3 py-2 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 cursor-pointer hover:bg-gray-800"
                  >
                    Choose Files
                  </label>
                  <span className="text-xs text-gray-500">
                    {selectedBuildFileCount > 0 ? `${selectedBuildFileCount} Files Selected` : "Choose Files"}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  CSV File (`image_id,image_url,ground_truth_label`) {csvFileName ? `• ${csvFileName}` : ""}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="build-dataset-csv-input"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onPickCsvFile}
                    className="hidden"
                  />
                  <label
                    htmlFor="build-dataset-csv-input"
                    className="px-3 py-2 text-xs rounded border border-gray-700 bg-gray-900 text-gray-200 cursor-pointer hover:bg-gray-800"
                  >
                    Choose Files
                  </label>
                  <span className="text-xs text-gray-500">
                    {csvFileName ? "1 Files Selected" : "Choose Files"}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  `ground_truth_label` can be DETECTED, NOT_DETECTED, or blank (stored as UNSET).
                </p>
              </div>
            )}
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
                              prev.map((x) =>
                                x.id === r.id ? { ...x, imageId: sanitizeImageId(e.target.value) } : x
                              )
                            )
                          }
                        />
                      ) : (
                        <span className="font-mono text-gray-300">{r.imageId}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <LabelBadge label={r.groundTruthLabel || "UNSET"} />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <LabelBadge label={r.aiAssignedLabel || "—"} />
                    </td>
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
          {building && buildMode === "run" && activeRunId && (
            <button
              onClick={cancelRun}
              disabled={cancelingRun}
              className="text-xs px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded"
            >
              {cancelingRun ? "Cancelling..." : "Cancel Run"}
            </button>
          )}
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
        {validationError && <div className="text-xs text-red-400">{validationError}</div>}
      </div>
    </div>
  );
}

function sanitizeImageId(input: string) {
  return input.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function validateImageIds(rows: BuildRow[]): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const row of rows) {
    const imageId = row.imageId.trim();
    if (!imageId) return { ok: false, error: "Each image needs a non-blank Image ID." };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate image_id: ${imageId}` };
    seen.add(imageId);
  }
  return { ok: true };
}

function parseCsvManifest(input: string): Array<{
  image_id: string;
  image_url: string;
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
}> {
  const normalized = String(input || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw new Error("CSV is empty.");
  }

  const lines = normalized.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV requires a header and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const expected = ["image_id", "image_url", "ground_truth_label"];
  const matchesHeader = headers.length === expected.length && headers.every((h, i) => h === expected[i]);
  if (!matchesHeader) {
    throw new Error("CSV header must be exactly: image_id,image_url,ground_truth_label");
  }

  const rows: Array<{
    image_id: string;
    image_url: string;
    ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length === 1 && !cols[0].trim()) continue;
    if (cols.length !== 3) {
      throw new Error(`CSV row ${i + 1} must have exactly 3 columns.`);
    }
    const imageId = sanitizeImageId(cols[0]);
    const imageUrl = cols[1].trim();
    const rawLabel = cols[2].trim().toUpperCase();
    if (!imageId) {
      throw new Error(`CSV row ${i + 1} has blank image_id.`);
    }
    if (!imageUrl) {
      throw new Error(`CSV row ${i + 1} has blank image_url.`);
    }
    let label: "DETECTED" | "NOT_DETECTED" | null = null;
    if (rawLabel) {
      if (rawLabel !== "DETECTED" && rawLabel !== "NOT_DETECTED") {
        throw new Error(`CSV row ${i + 1} has invalid ground_truth_label: ${cols[2]}.`);
      }
      label = rawLabel as "DETECTED" | "NOT_DETECTED";
    }
    rows.push({
      image_id: imageId,
      image_url: imageUrl,
      ground_truth_label: label,
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function pollRunToTerminalState(
  runId: string,
  onProgress?: (snapshot: any) => void
): Promise<any> {
  while (true) {
    const res = await fetch(`/api/runs?run_id=${runId}`);
    const snapshot = await res.json();
    if (!res.ok) {
      throw new Error(snapshot?.error || "Failed to fetch run status");
    }
    onProgress?.(snapshot);
    if (snapshot?.status === "completed" || snapshot?.status === "cancelled" || snapshot?.status === "failed") {
      return snapshot;
    }
    await delay(1000);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function LabelBadge({ label }: { label: string }) {
  if (label === "DETECTED") {
    return <span className="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300">{label}</span>;
  }
  if (label === "NOT_DETECTED") {
    return <span className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-300">{label}</span>;
  }
  if (label === "PARSE_FAIL") {
    return <span className="px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{label}</span>;
  }
  if (label === "UNSET") {
    return <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{label}</span>;
  }
  return <span className="text-gray-300">{label}</span>;
}
