"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ClipboardList,
  GitCompare,
  Flag,
  FlaskConical,
  BarChart3,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  List,
} from "lucide-react";
import type { Detection, QaSample, AnnotatorMetrics, ReviewFlag, Prediction } from "@/types";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { InfoTip } from "@/components/shared/InfoTip";
import FlagsQueue from "@/components/shared/FlagsQueue";
import { useAppStore } from "@/lib/store";
import { STATUS_LABELS, STATUS_BADGE_CLASSES, QA_PIPELINE_EXCLUDED } from "@/lib/statusConstants";
import { QA_STATUS_TRANSITIONS } from "@/lib/schemas";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts";

type SubView = "overview" | "discrepancy" | "flags" | "sampling" | "logs" | "finalized";

interface DatasetQa {
  dataset_id: string;
  name: string;
  detection_id: string | null;
  split_type: string;
  size: number;
  qa_status: string;
  assigned_to: string | null;
  linked_dataset_id: string | null;
  updated_at: string;
  items_labeled: number;
  revision_note: string | null;
}

interface Discrepancy {
  image_id: string;
  image_uri: string;
  label_a: string;
  label_b: string;
  tags_a: string;
  tags_b: string;
  item_id_a: string;
  item_id_b: string;
  label_mismatch: number;
  tags_mismatch: number;
}

interface SampleWithItem extends QaSample {
  image_uri?: string;
  image_id?: string;
  ground_truth_label?: string;
  segment_tags?: string;
}

const SUB_TABS: { id: SubView; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Pipeline", icon: <ClipboardList className="h-4 w-4" /> },
  { id: "flags", label: "Flags Queue", icon: <Flag className="h-4 w-4" /> },
  { id: "sampling", label: "QA Sampling", icon: <FlaskConical className="h-4 w-4" /> },
  { id: "discrepancy", label: "Discrepancies", icon: <GitCompare className="h-4 w-4" /> },
  { id: "logs", label: "Performance Metrics", icon: <BarChart3 className="h-4 w-4" /> },
];

function formatTags(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(", ");
    return String(parsed);
  } catch {
    return raw;
  }
}

export function QualityAssurance({ detections }: { detections: Detection[] }) {
  const { pendingSubView, setPendingSubView } = useAppStore();
  const [subView, setSubView] = useState<SubView>("overview");
  const [datasets, setDatasets] = useState<DatasetQa[]>([]);
  const [loading, setLoading] = useState(false);
  const [qaStatusFilter, setQaStatusFilter] = useState<string[]>([]);
  const [detectionFilter, setDetectionFilter] = useState<string[]>([]);
  const [assignedFilter, setAssignedFilter] = useState<string[]>([]);
  const [annotators, setAnnotators] = useState<string[]>([]);
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ action: "datasets" });
    if (qaStatusFilter.length) params.set("qa_status", qaStatusFilter.join(","));
    if (detectionFilter.length) params.set("detection_id", detectionFilter.join(","));
    if (assignedFilter.length) params.set("assigned_to", assignedFilter.join(","));
    const res = await fetch(`/api/qa?${params}`);
    const data = await res.json();
    setDatasets(data.datasets || []);
    setLoading(false);
  }, [qaStatusFilter, detectionFilter, assignedFilter]);

  const loadAnnotators = useCallback(async () => {
    const res = await fetch("/api/qa?action=annotators");
    const data = await res.json();
    setAnnotators(data.annotators || []);
  }, []);

  useEffect(() => {
    loadDatasets();
    loadAnnotators();
  }, [loadDatasets, loadAnnotators]);

  useEffect(() => {
    if (pendingSubView) {
      setSubView(pendingSubView as SubView);
      setPendingSubView(null);
    }
  }, [pendingSubView, setPendingSubView]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--app-text)]">Quality Assurance</h2>
        <p className="mt-1 text-sm text-[var(--app-text-muted)]">
          Manage dataset QA workflows, inter-annotator agreement, and performance metrics.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubView(tab.id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              subView === tab.id
                ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)] ring-1 ring-[rgba(182,223,255,0.22)]"
                : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {subView === "overview" && (
        <OverviewView
          datasets={datasets}
          detections={detections}
          annotators={annotators}
          loading={loading}
          qaStatusFilter={qaStatusFilter}
          detectionFilter={detectionFilter}
          assignedFilter={assignedFilter}
          setQaStatusFilter={setQaStatusFilter}
          setDetectionFilter={setDetectionFilter}
          setAssignedFilter={setAssignedFilter}
          expandedDataset={expandedDataset}
          setExpandedDataset={setExpandedDataset}
          onRefresh={() => { loadDatasets(); loadAnnotators(); }}
        />
      )}
      {subView === "discrepancy" && (
        <DiscrepancyView datasets={datasets} detections={detections} onRefresh={loadDatasets} />
      )}
      {subView === "flags" && <FlagsQueueView detections={detections} />}
      {subView === "sampling" && <SamplingView datasets={datasets} detections={detections} onRefresh={loadDatasets} />}
      {subView === "logs" && <LogsView datasets={datasets} detections={detections} onNavigate={setSubView} />}
    </div>
  );
}

// ============ Overview / Pipeline ============

function MultiSelectFilter({
  label,
  placeholder,
  options,
  value,
  onChange,
  widthClass = "w-48",
}: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };

  const summary = value.length === 0
    ? placeholder
    : value.length === 1
      ? (options.find((o) => o.value === value[0])?.label ?? value[0])
      : `${value.length} selected`;

  return (
    <div className="flex flex-col" ref={rootRef}>
      <label className="app-label mb-1.5 block text-xs">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`app-select h-9 ${widthClass} px-3 text-sm text-left flex items-center justify-between gap-2`}
        >
          <span className={value.length === 0 ? "text-[var(--app-text-muted)]" : ""}>{summary}</span>
        </button>
        {open && (
          <div className={`absolute z-20 mt-1 ${widthClass} max-h-64 overflow-y-auto rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] shadow-lg`}>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-left text-xs text-[var(--app-text-muted)] hover:bg-[var(--app-surface-soft)] border-b border-[var(--app-border)]"
              >
                Clear selection
              </button>
            )}
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--app-text-muted)]">No options</div>
            ) : options.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-[var(--app-surface-soft)]">
                <input
                  type="checkbox"
                  checked={value.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="accent-sky-500"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewView({
  datasets,
  detections,
  annotators,
  loading,
  qaStatusFilter,
  detectionFilter,
  assignedFilter,
  setQaStatusFilter,
  setDetectionFilter,
  setAssignedFilter,
  expandedDataset,
  setExpandedDataset,
  onRefresh,
}: {
  datasets: DatasetQa[];
  detections: Detection[];
  annotators: string[];
  loading: boolean;
  qaStatusFilter: string[];
  detectionFilter: string[];
  assignedFilter: string[];
  setQaStatusFilter: (v: string[]) => void;
  setDetectionFilter: (v: string[]) => void;
  setAssignedFilter: (v: string[]) => void;
  expandedDataset: string | null;
  setExpandedDataset: (v: string | null) => void;
  onRefresh: () => void;
}) {
  const { notify } = useAppFeedback();
  const { setActiveTab, setPendingDatasetId, setPendingSubView } = useAppStore();
  const [assignInput, setAssignInput] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "kanban">("kanban");
  const [flagCounts, setFlagCounts] = useState<Record<string, number>>({});

  const KANBAN_COLUMNS = ["assigned", "in_annotation", "submitted", "in_qa", "needs_revision", "approved", "finalized"];

  useEffect(() => {
    if (datasets.length === 0) return;
    const ids = datasets.map((d) => d.dataset_id).join(",");
    fetch(`/api/review-flags?action=counts&dataset_ids=${ids}`)
      .then((r) => r.json())
      .then((data) => setFlagCounts(data.counts || {}));
  }, [datasets]);

  function navigateToWork(ds: DatasetQa) {
    if (["assigned", "in_annotation", "needs_revision"].includes(ds.qa_status)) {
      setPendingDatasetId(ds.dataset_id);
      setActiveTab(10);
    } else if (["submitted", "in_qa"].includes(ds.qa_status)) {
      setPendingDatasetId(ds.dataset_id);
      setPendingSubView("sampling");
      setActiveTab(8);
    } else if (["approved", "finalized"].includes(ds.qa_status)) {
      setPendingDatasetId(ds.dataset_id);
      setActiveTab(7);
    } else {
      setExpandedDataset(ds.dataset_id);
      setViewMode("list");
    }
  }

  async function handleDrop(e: React.DragEvent, targetStatus: string) {
    const datasetId = e.dataTransfer.getData("dataset_id");
    if (!datasetId) return;
    const ds = datasets.find((d) => d.dataset_id === datasetId);
    if (!ds || ds.qa_status === targetStatus) return;
    const allowed = QA_STATUS_TRANSITIONS[ds.qa_status] || [];
    if (!allowed.includes(targetStatus)) {
      notify({ message: `Cannot move from "${STATUS_LABELS[ds.qa_status]}" to "${STATUS_LABELS[targetStatus]}". Allowed: ${allowed.map((s) => STATUS_LABELS[s] || s).join(", ")}`, tone: "error" });
      return;
    }
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_status", dataset_id: datasetId, new_status: targetStatus }),
    });
    onRefresh();
  }

  async function handleStatusChange(datasetId: string, newStatus: string) {
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_status", dataset_id: datasetId, new_status: newStatus }),
    });
    onRefresh();
  }

  async function handleAssign(datasetId: string) {
    if (!assignInput.trim()) return;
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", dataset_id: datasetId, assigned_to: assignInput.trim() }),
    });
    setAssignInput("");
    onRefresh();
  }

  async function handleLink(datasetIdA: string) {
    if (!linkTarget) return;
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link_datasets", dataset_id_a: datasetIdA, dataset_id_b: linkTarget }),
    });
    setLinkTarget("");
    onRefresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <MultiSelectFilter
          label="Status"
          placeholder="All Statuses"
          widthClass="w-48"
          value={qaStatusFilter}
          onChange={setQaStatusFilter}
          options={KANBAN_COLUMNS
            .filter((k) => !(QA_PIPELINE_EXCLUDED as readonly string[]).includes(k))
            .map((k) => ({ value: k, label: STATUS_LABELS[k] || k }))}
        />
        <MultiSelectFilter
          label="Detection"
          placeholder="All Detections"
          widthClass="w-64"
          value={detectionFilter}
          onChange={setDetectionFilter}
          options={[...detections]
            .sort((a, b) => a.display_name.localeCompare(b.display_name))
            .map((d) => ({ value: d.detection_id, label: d.display_name }))}
        />
        <MultiSelectFilter
          label="Assigned To"
          placeholder="Anyone"
          widthClass="w-48"
          value={assignedFilter}
          onChange={setAssignedFilter}
          options={[...annotators]
            .sort((a, b) => a.localeCompare(b))
            .map((a) => ({ value: a, label: a }))}
        />
        <button onClick={onRefresh} className="app-btn app-btn-toolbar app-btn-sm">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex rounded-lg border border-[var(--app-border)] overflow-hidden">
          <button
            onClick={() => setViewMode("kanban")}
            className={`px-2.5 py-1.5 ${viewMode === "kanban" ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:bg-[var(--app-surface-soft)]"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1.5 ${viewMode === "list" ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:bg-[var(--app-surface-soft)]"}`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--app-text-muted)]">Loading...</p>
      ) : datasets.length === 0 ? (
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--app-text-muted)]">No datasets match the current filters.</p>
        </div>
      ) : viewMode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((status) => {
            const columnDatasets = datasets.filter((d) => d.qa_status === status);
            return (
              <div key={status} className="min-w-[200px] w-[200px] shrink-0 flex flex-col">
                <div className="flex items-center gap-2 px-2 py-2 mb-2">
                  <span className={`app-badge ${STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.draft}`}>
                    {STATUS_LABELS[status] || status}
                  </span>
                  <span className="text-[11px] text-[var(--app-text-subtle)]">{columnDatasets.length}</span>
                </div>
                <div
                  className="flex-1 space-y-2 rounded-xl bg-[var(--app-surface-soft)] p-2 min-h-[120px] transition-all"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("ring-1", "ring-[#5cb8ff]/40"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("ring-1", "ring-[#5cb8ff]/40"); }}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("ring-1", "ring-[#5cb8ff]/40"); handleDrop(e, status); }}
                >
                  {columnDatasets.map((ds) => {
                    const pct = ds.size > 0 ? Math.round(((ds.items_labeled || 0) / ds.size) * 100) : 0;
                    const detection = detections.find((d) => d.detection_id === ds.detection_id);
                    const flags = flagCounts[ds.dataset_id] || 0;
                    return (
                      <div
                        key={ds.dataset_id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("dataset_id", ds.dataset_id)}
                        className="app-card cursor-grab active:cursor-grabbing p-2.5 hover:bg-[var(--app-table-row-hover)] transition-colors"
                        onClick={() => navigateToWork(ds)}
                      >
                        <p className="text-xs font-medium text-[var(--app-text)] truncate">{ds.name}</p>
                        <p className="mt-1 text-[10px] text-[var(--app-text-subtle)] truncate">
                          {detection?.display_name || "No detection"}
                        </p>
                        {ds.assigned_to && (
                          <p className="mt-0.5 text-[10px] text-[var(--app-text-subtle)]">{ds.assigned_to}</p>
                        )}
                        {flags > 0 && (
                          <div className="mt-1 flex items-center gap-1">
                            <Flag className="h-3 w-3 text-red-400" />
                            <span className="text-[10px] text-red-300">{flags} open</span>
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <div className="flex-1 h-1 rounded-full bg-[var(--app-surface-strong)] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-[#5cb8ff]"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-[var(--app-text-subtle)]">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {datasets.filter((ds) => !(QA_PIPELINE_EXCLUDED as readonly string[]).includes(ds.qa_status)).map((ds) => {
            const isExpanded = expandedDataset === ds.dataset_id;
            const detection = detections.find((d) => d.detection_id === ds.detection_id);
            return (
              <div key={ds.dataset_id} className="app-card overflow-hidden">
                <button
                  onClick={() => setExpandedDataset(isExpanded ? null : ds.dataset_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--app-text-subtle)]" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--app-text-subtle)]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--app-text)]">{ds.name}</span>
                      <span className={`app-badge ${STATUS_BADGE_CLASSES[ds.qa_status] || STATUS_BADGE_CLASSES.draft}`}>
                        {STATUS_LABELS[ds.qa_status] || ds.qa_status}
                      </span>
                      {ds.linked_dataset_id && (
                        <Link2 className="h-3.5 w-3.5 text-[#5cb8ff]" />
                      )}
                      {(flagCounts[ds.dataset_id] || 0) > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                          <Flag className="h-3 w-3" />{flagCounts[ds.dataset_id]}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-4 text-[11px] text-[var(--app-text-subtle)]">
                      <span>{detection?.display_name || "Unassigned"}</span>
                      <span>{ds.split_type}</span>
                      <span>{ds.size} items</span>
                      {ds.assigned_to && <span>Annotator: {ds.assigned_to}</span>}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-[var(--app-border)] px-4 py-4 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--app-surface-strong)]">
                          <div
                            className={`h-full rounded-full transition-all ${
                              ds.items_labeled >= ds.size ? "bg-emerald-500" : "bg-[#5cb8ff]"
                            }`}
                            style={{ width: `${ds.size > 0 ? Math.round(((ds.items_labeled || 0) / ds.size) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] font-medium text-[var(--app-text-muted)] whitespace-nowrap">
                        {ds.items_labeled || 0}/{ds.size} labeled
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-4">
                      <div>
                        <label className="app-label mb-1 block text-xs">Change Status</label>
                        <select
                          className="app-select px-2 py-1.5 text-sm"
                          value={ds.qa_status}
                          onChange={(e) => handleStatusChange(ds.dataset_id, e.target.value)}
                        >
                          <option value={ds.qa_status}>{STATUS_LABELS[ds.qa_status] || ds.qa_status}</option>
                          {(QA_STATUS_TRANSITIONS[ds.qa_status] || []).map((s: string) => (
                            <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="app-label mb-1 block text-xs">Assign Annotator</label>
                        <div className="flex gap-1">
                          <input
                            className="app-input px-2 py-1.5 text-sm w-36"
                            placeholder="Name..."
                            value={assignInput}
                            onChange={(e) => setAssignInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAssign(ds.dataset_id)}
                          />
                          <button onClick={() => handleAssign(ds.dataset_id)} className="app-btn app-btn-primary app-btn-sm text-xs">
                            Assign
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="app-label mb-1 block text-xs">Link for IAA</label>
                        <div className="flex gap-1">
                          <select
                            className="app-select px-2 py-1.5 text-sm"
                            value={linkTarget}
                            onChange={(e) => setLinkTarget(e.target.value)}
                          >
                            <option value="">Select dataset...</option>
                            {datasets
                              .filter((d) => d.dataset_id !== ds.dataset_id)
                              .map((d) => (
                                <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>
                              ))}
                          </select>
                          <button onClick={() => handleLink(ds.dataset_id)} className="app-btn app-btn-primary app-btn-sm text-xs">
                            <Link2 className="h-3 w-3" />
                          </button>
                        </div>
                        {ds.linked_dataset_id && (
                          <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                            Linked: {datasets.find((d) => d.dataset_id === ds.linked_dataset_id)?.name || ds.linked_dataset_id}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ Discrepancy Review ============

function DiscrepancyView({ datasets, detections, onRefresh }: { datasets: DatasetQa[]; detections: Detection[]; onRefresh: () => void }) {
  const { notify } = useAppFeedback();
  const [eligibleParents, setEligibleParents] = useState<any[]>([]);
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [children, setChildren] = useState<Array<{ dataset_id: string; name: string; assigned_to: string | null }>>([]);
  const [conflicts, setConflicts] = useState<Array<{ image_id: string; image_uri: string; labels: Array<{ annotator: string; label: string; tags: string }> }>>([]);
  const [resolvedConflicts, setResolvedConflicts] = useState<any[]>([]);
  const [totalImages, setTotalImages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [correctedTags, setCorrectedTags] = useState<string[] | undefined>(undefined);

  const [resolvedCollapsed, setResolvedCollapsed] = useState(true);
  const [resolvedPreviewIndex, setResolvedPreviewIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/qa?action=eligible_parents")
      .then((r) => r.json())
      .then((data) => setEligibleParents(data.parents || []))
      .catch(() => {});
  }, []);

  async function loadConflicts(parentId: string) {
    setLoading(true);
    const [conflictRes, resolvedRes] = await Promise.all([
      fetch(`/api/qa?action=nway_conflicts&parent_id=${parentId}`),
      fetch(`/api/qa?action=nway_resolved&parent_id=${parentId}`),
    ]);
    const conflictData = await conflictRes.json();
    setConflicts(conflictData.conflicts || []);
    setChildren(conflictData.children || []);
    setTotalImages(conflictData.total_images || 0);
    const resolvedData = await resolvedRes.json();
    setResolvedConflicts(resolvedData.resolved || []);
    setLoading(false);
  }

  async function resolveConflict(imageId: string, label: string) {
    if (!selectedParent) return;
    setSubmitting(true);
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resolve_nway_discrepancy",
        parent_id: selectedParent,
        image_id: imageId,
        override_label: label,
        corrected_tags: correctedTags || undefined,
      }),
    });
    setCorrectedTags(undefined);
    await loadConflicts(selectedParent);
    const remainingCount = conflicts.length - 1;
    if (remainingCount > 0 && previewIndex != null) {
      setPreviewIndex(Math.min(previewIndex, remainingCount - 1));
    } else {
      setPreviewIndex(null);
    }
    setSubmitting(false);
  }

  async function reopenConflict(imageId: string) {
    if (!selectedParent) return;
    await fetch("/api/qa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen_nway_discrepancy", parent_id: selectedParent, image_id: imageId }),
    });
    setResolvedPreviewIndex(null);
    loadConflicts(selectedParent);
  }

  async function finalize() {
    if (!selectedParent) return;
    setSubmitting(true);
    const resolutions = resolvedConflicts.map((r: any) => ({
      image_id: r.image_id,
      label: r.resolved_label,
      tags: r.corrected_tags || undefined,
    }));
    const res = await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finalize_parent", parent_dataset_id: selectedParent, resolutions }),
    });
    if (res.ok) {
      notify({ title: "Finalized", message: "Datasets merged and children archived.", tone: "success" });
      setSelectedParent(null);
      setConflicts([]);
      setResolvedConflicts([]);
      onRefresh();
      fetch("/api/qa?action=eligible_parents")
        .then((r) => r.json())
        .then((data) => setEligibleParents(data.parents || []));
    }
    setSubmitting(false);
  }

  const currentConflict = previewIndex != null ? conflicts[previewIndex] : null;

  const currentDetection = (() => {
    if (!selectedParent) return null;
    const parent = eligibleParents.find((p: any) => p.dataset_id === selectedParent);
    return parent?.detection_id ? detections.find((det) => det.detection_id === parent.detection_id) : null;
  })();
  const segmentOptions: string[] = Array.isArray(currentDetection?.segment_taxonomy)
    ? currentDetection.segment_taxonomy
    : [];

  const displayTags: string[] = correctedTags !== undefined
    ? correctedTags
    : (() => {
        if (!currentConflict) return [];
        const allTags = new Set<string>();
        currentConflict.labels.forEach((l) => { try { JSON.parse(l.tags || "[]").forEach((t: string) => allTags.add(t)); } catch {} });
        return [...allTags];
      })();

  const ANNOTATOR_COLORS = [
    { border: "border-blue-500/30", bg: "bg-blue-500/5", text: "text-blue-300" },
    { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-300" },
    { border: "border-purple-500/30", bg: "bg-purple-500/5", text: "text-purple-300" },
    { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-300" },
    { border: "border-rose-500/30", bg: "bg-rose-500/5", text: "text-rose-300" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="app-label mb-1.5 block text-xs">Select Parent Dataset</label>
          <select
            className="app-select h-9 w-80 px-3 text-sm"
            value={selectedParent || ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setSelectedParent(val);
              if (val) loadConflicts(val);
              else { setConflicts([]); setResolvedConflicts([]); }
            }}
          >
            <option value="">Choose a dataset...</option>
            {eligibleParents.map((p: any) => (
              <option key={p.dataset_id} value={p.dataset_id}>
                {p.name} — {p.child_count} annotators
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedParent && !loading && (
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--app-text-muted)]">
            {eligibleParents.length === 0
              ? "No datasets are ready for discrepancy review. All child datasets for a parent must be approved before comparison can begin."
              : "Select a set of linked datasets from the dropdown menu above to compare annotator labels and resolve discrepancies."}
          </p>
        </div>
      )}

      {selectedParent && !loading && (
        <div className="flex flex-wrap gap-4 text-sm text-[var(--app-text-muted)]">
          <span>Total images: {totalImages}</span>
          <span>Discrepancies: {conflicts.length}</span>
          <span>Resolved: {resolvedConflicts.length}</span>
          {totalImages > 0 && (
            <span>Agreement: {(((totalImages - conflicts.length - resolvedConflicts.length) / totalImages) * 100).toFixed(1)}%</span>
          )}
          {children.length > 0 && (
            <span className="text-xs">Annotators: {children.map((c) => c.assigned_to || c.name).join(", ")}</span>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-[var(--app-text-muted)]">Loading discrepancies...</p>}

      {!loading && selectedParent && conflicts.length === 0 && resolvedConflicts.length === 0 && (
        <div className="app-card p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-2 text-sm text-[var(--app-text-muted)]">All annotators agree. No discrepancies found.</p>
        </div>
      )}

      {!loading && selectedParent && conflicts.length === 0 && resolvedConflicts.length > 0 && (
        <div className="app-card p-6 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="text-sm text-emerald-300 font-medium">All {resolvedConflicts.length} discrepancies resolved</p>
          <p className="text-xs text-[var(--app-text-muted)]">All annotators are aligned. Finalize to merge resolutions into the parent dataset and archive children.</p>
          <button
            onClick={() => setShowFinalizeConfirm(true)}
            disabled={submitting}
            className="app-btn app-btn-success app-btn-sm text-xs disabled:opacity-40"
          >Finalize & Merge</button>
        </div>
      )}

      {!loading && conflicts.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--app-text)]">Unresolved ({conflicts.length})</h4>
          {conflicts.map((c, idx) => (
            <div key={c.image_id} className="app-card flex items-center gap-4 p-4">
              <img
                src={c.image_uri}
                alt={c.image_id}
                className="h-16 w-16 rounded-md object-cover border border-[var(--app-border)] cursor-pointer hover:ring-2 hover:ring-[#5cb8ff]"
                onClick={() => { setPreviewIndex(idx); setCorrectedTags(undefined);}}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{c.image_id}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  {c.labels.map((l, li) => (
                    <span key={li} className="text-[var(--app-text-muted)]">
                      {l.annotator}: <span className={l.label === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}>{l.label}</span>
                    </span>
                  ))}
                </div>
                {(() => {
                  const hasLabelMismatch = !c.labels.every((l) => l.label === c.labels[0].label);
                  const hasTagMismatch = !c.labels.every((l) => l.tags === c.labels[0].tags);
                  return (
                    <div className="mt-1 flex gap-1.5">
                      {hasLabelMismatch && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">Label</span>}
                      {hasTagMismatch && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Attributes</span>}
                    </div>
                  );
                })()}
              </div>
              <button onClick={() => { setPreviewIndex(idx); setCorrectedTags(undefined);}} className="app-btn app-btn-toolbar app-btn-sm text-xs">Review</button>
            </div>
          ))}
        </div>
      )}

      {!loading && selectedParent && resolvedConflicts.length > 0 && (
        <div className="app-card overflow-hidden">
          <button
            onClick={() => setResolvedCollapsed(!resolvedCollapsed)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
          >
            {resolvedCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" />}
            <span className="text-sm font-medium text-[var(--app-text)]">Resolved</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">{resolvedConflicts.length}</span>
          </button>
          {!resolvedCollapsed && (
            <div className="border-t border-[var(--app-border)] max-h-[300px] overflow-y-auto">
              {resolvedConflicts.map((rd: any, idx: number) => (
                <div
                  key={`${rd.image_id}-${idx}`}
                  className="flex items-center gap-4 px-4 py-3 border-b border-[var(--app-border)] last:border-b-0 cursor-pointer hover:bg-[var(--app-table-row-hover)]"
                  onClick={() => setResolvedPreviewIndex(idx)}
                >
                  {rd.image_uri ? (
                    <img src={rd.image_uri} alt={rd.image_id} className="h-10 w-10 rounded object-cover border border-[var(--app-border)] shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{rd.image_id}</p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--app-text-subtle)]">
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
                        {rd.accepted_annotator ? `Accepted ${rd.accepted_annotator}` : "Override"}
                      </span>
                      {rd.resolved_label && (
                        <span className={rd.resolved_label === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}>
                          → {rd.resolved_label}
                        </span>
                      )}
                      {rd.actor && <span>by {rd.actor}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ImagePreviewModal
        isOpen={previewIndex != null && !!currentConflict}
        imageUrl={currentConflict?.image_uri || ""}
        imageAlt={currentConflict?.image_id || ""}
        title="Discrepancy Review"
        subtitle={currentConflict?.image_id || ""}
        index={previewIndex ?? 0}
        total={conflicts.length}
        onClose={() => { setPreviewIndex(null); setCorrectedTags(undefined);}}
        onPrev={() => { setPreviewIndex((prev) => prev != null ? Math.max(0, prev - 1) : null); setCorrectedTags(undefined);}}
        onNext={() => { setPreviewIndex((prev) => prev != null ? Math.min(conflicts.length - 1, prev + 1) : null); setCorrectedTags(undefined);}}
        details={currentConflict ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Image ID</label>
              <p className="text-xs font-mono text-gray-300">{currentConflict.image_id}</p>
            </div>

            {currentConflict.labels.map((l, idx) => {
              const color = ANNOTATOR_COLORS[idx % ANNOTATOR_COLORS.length];
              const tags: string[] = (() => { try { return JSON.parse(l.tags || "[]"); } catch { return []; } })();
              return (
                <div key={idx} className={`rounded-lg border ${color.border} ${color.bg} p-3`}>
                  <p className={`text-xs font-medium ${color.text} mb-2`}>{l.annotator}</p>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-400">Label:</span>
                    <span className={`text-xs font-medium ${l.label === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}`}>
                      {l.label || "UNSET"}
                    </span>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tags.map((t) => (
                        <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-300">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {(segmentOptions.length > 0 || currentConflict.labels.some((l) => { try { return JSON.parse(l.tags || "[]").length > 0; } catch { return false; } })) && (
              <div className="border-t border-[var(--app-border)] pt-3">
                <p className="text-xs font-medium text-[var(--app-text)] mb-2">Attributes</p>
                <div className="flex flex-wrap gap-2">
                  {(segmentOptions.length > 0 ? segmentOptions : (() => {
                    const allTags = new Set<string>();
                    currentConflict.labels.forEach((l) => { try { JSON.parse(l.tags || "[]").forEach((t: string) => allTags.add(t)); } catch {} });
                    return [...allTags].filter(Boolean);
                  })()).map((option) => {
                    const selected = displayTags.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          const next = selected ? displayTags.filter((v) => v !== option) : [...displayTags, option];
                          setCorrectedTags(next);
                        }}
                        className={`px-2.5 py-1 text-[11px] transition ${
                          selected
                            ? "rounded-md border border-sky-400/50 bg-sky-500/12 text-sky-100"
                            : "rounded-md border border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-[var(--app-border)] pt-3 space-y-2">
              <p className="text-xs font-medium text-[var(--app-text)]">Ground Truth Label</p>
              <div className="flex gap-2">
                <button
                  disabled={submitting}
                  onClick={() => resolveConflict(currentConflict.image_id, "DETECTED")}
                  className="app-btn app-btn-sm text-xs flex-1 border border-[var(--app-purple)]/40 text-[var(--app-purple)] hover:bg-[var(--app-purple)]/10 disabled:opacity-40"
                >DETECTED</button>
                <button
                  disabled={submitting}
                  onClick={() => resolveConflict(currentConflict.image_id, "NOT_DETECTED")}
                  className="app-btn app-btn-sm text-xs flex-1 border border-[var(--app-not-detected)]/40 text-[var(--app-not-detected)] hover:bg-[var(--app-not-detected)]/10 disabled:opacity-40"
                >NOT DETECTED</button>
              </div>
            </div>
          </div>
        ) : null}
      />

      {resolvedPreviewIndex != null && resolvedConflicts[resolvedPreviewIndex] && (() => {
        const rd = resolvedConflicts[resolvedPreviewIndex];
        return (
          <ImagePreviewModal
            isOpen={true}
            imageUrl={rd.image_uri || ""}
            imageAlt={rd.image_id || ""}
            title="Resolved Discrepancy"
            subtitle={rd.image_id || ""}
            index={resolvedPreviewIndex}
            total={resolvedConflicts.length}
            onClose={() => setResolvedPreviewIndex(null)}
            onPrev={() => setResolvedPreviewIndex((prev) => prev != null ? Math.max(0, prev - 1) : null)}
            onNext={() => setResolvedPreviewIndex((prev) => prev != null ? Math.min(resolvedConflicts.length - 1, prev + 1) : null)}
            details={
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Image ID</label>
                  <p className="text-xs font-mono text-gray-300">{rd.image_id}</p>
                </div>
                <div className="border-t border-[var(--app-border)] pt-3">
                  <label className="text-xs text-gray-400 block mb-1">Resolution</label>
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300">
                    {rd.accepted_annotator ? `Accepted ${rd.accepted_annotator}` : "Override"}
                  </span>
                </div>
                {rd.resolved_label && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Final Label</label>
                    <p className={`text-xs font-medium ${rd.resolved_label === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}`}>
                      {rd.resolved_label}
                    </p>
                  </div>
                )}
                {rd.corrected_tags && rd.corrected_tags.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Final Attributes</label>
                    <p className="text-xs text-gray-300">{Array.isArray(rd.corrected_tags) ? rd.corrected_tags.join(", ") : rd.corrected_tags}</p>
                  </div>
                )}
                {rd.actor && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Resolved By</label>
                    <p className="text-xs text-gray-300">{rd.actor}</p>
                  </div>
                )}
                <div className="border-t border-[var(--app-border)] pt-3">
                  <button
                    onClick={() => reopenConflict(rd.image_id)}
                    className="app-btn app-btn-toolbar app-btn-sm text-xs w-full text-amber-300"
                  >Reopen Discrepancy</button>
                </div>
              </div>
            }
          />
        );
      })()}

      {showFinalizeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-card-strong p-6 w-full max-w-md space-y-4">
            <h3 className="text-sm font-semibold text-white">Confirm Finalization</h3>
            <p className="text-sm text-[var(--app-text-muted)]">
              This action is irreversible. Finalizing will merge all resolved ground truth labels into the parent dataset and archive all child datasets.
            </p>
            <p className="text-sm text-[var(--app-text-muted)]">
              The finalized dataset can be found in the <span className="text-[var(--app-text)] font-medium">Saved Datasets</span> tab.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowFinalizeConfirm(false)}
                className="app-btn app-btn-subtle app-btn-sm text-xs"
              >Cancel</button>
              <button
                onClick={() => { setShowFinalizeConfirm(false); finalize(); }}
                disabled={submitting}
                className="app-btn app-btn-success app-btn-sm text-xs disabled:opacity-40"
              >Finalize & Merge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Secondary Review Flag Queue ============

interface FlagItemDetails {
  item_id: string | null;
  image_uri: string;
  ground_truth_label: string | null;
  segment_tags: string;
  image_description: string;
  prediction: Prediction | null;
}

const FLAG_RESOLVER_NAME = "Delaney F.";

const FLAG_ASSESSMENT_OPTIONS: { value: "accepted" | "label_corrected" | "attributes_corrected" | "both_corrected"; label: string }[] = [
  { value: "accepted", label: "Accepted — no corrections needed" },
  { value: "label_corrected", label: "Label Corrected" },
  { value: "attributes_corrected", label: "Attributes Corrected" },
  { value: "both_corrected", label: "Label & Attributes Corrected" },
];

const SECTION_LABEL_CLASS = "text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium";
const SECTION_DIVIDER_CLASS = "border-t border-white/[0.07] pt-4";

const FLAG_ACTION_HUMANIZED: Record<string, string> = {
  accepted: "Accepted",
  label_confirmed: "Label confirmed",
  label_corrected: "Label corrected",
  attributes_corrected: "Attributes corrected",
  both_corrected: "Label & attributes corrected",
  image_removed: "Image removed",
  needs_discussion: "Needs discussion",
  correct: "Correct",
  incorrect_both: "Incorrect (both)",
  incorrect_attributes: "Incorrect attributes",
  incorrect_label: "Incorrect label",
  ambiguous: "Ambiguous",
};

function humanizeFlagAction(raw: string | null | undefined): string {
  if (!raw) return "";
  return FLAG_ACTION_HUMANIZED[raw] ?? raw.replace(/_/g, " ");
}

function parseAttrs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function attrsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function deriveFlagResolutionAction(
  origLabel: string | null,
  newLabel: string | null,
  origAttrs: string[],
  newAttrs: string[]
): "accepted" | "label_corrected" | "attributes_corrected" | "both_corrected" {
  const labelChanged = (origLabel ?? null) !== (newLabel ?? null);
  const attrsChanged = !attrsEqual(origAttrs, newAttrs);
  if (labelChanged && attrsChanged) return "both_corrected";
  if (labelChanged) return "label_corrected";
  if (attrsChanged) return "attributes_corrected";
  return "accepted";
}

function FlagsQueueView({ detections }: { detections: Detection[] }) {
  const [flags, setFlags] = useState<ReviewFlag[]>([]);
  const [resolvedFlags, setResolvedFlags] = useState<ReviewFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [itemDetails, setItemDetails] = useState<Record<string, FlagItemDetails>>({});
  const [resolveNote, setResolveNote] = useState("");
  const [editedLabel, setEditedLabel] = useState<string | null | undefined>(undefined);
  const [editedTags, setEditedTags] = useState<string[] | undefined>(undefined);
  const [resolvedPreviewIndex, setResolvedPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    loadFlags();
  }, []);

  useEffect(() => {
    if (previewIndex == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigateFlag(-1);
      else if (e.key === "ArrowRight") navigateFlag(1);
      else if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewIndex, flags.length]);

  async function loadFlags() {
    setLoading(true);
    const [openRes, resolvedRes] = await Promise.all([
      fetch(`/api/review-flags?status=open&page=1&page_size=9999`),
      fetch(`/api/review-flags?status=resolved,dismissed&page=1&page_size=9999`),
    ]);
    if (openRes.ok) {
      const data = await openRes.json();
      setFlags(data.flags || []);
    } else {
      setFlags([]);
    }
    if (resolvedRes.ok) {
      const data = await resolvedRes.json();
      setResolvedFlags(data.flags || []);
    } else {
      setResolvedFlags([]);
    }
    setLoading(false);
  }

  async function loadItemDetails(flag: ReviewFlag) {
    if (itemDetails[flag.flag_id]) return;
    const params = flag.dataset_item_id
      ? `item_id=${flag.dataset_item_id}`
      : flag.prediction_id
        ? `prediction_id=${flag.prediction_id}`
        : null;
    if (!params) return;
    const res = await fetch(`/api/qa?action=item_details&${params}`);
    if (res.ok) {
      const data = await res.json();
      setItemDetails((prev) => ({
        ...prev,
        [flag.flag_id]: {
          item_id: data.item?.item_id || null,
          image_uri: data.item?.image_uri || data.prediction?.image_uri || "",
          ground_truth_label: data.item?.ground_truth_label || null,
          segment_tags: data.item?.segment_tags || "[]",
          image_description: data.item?.image_description || "",
          prediction: data.prediction || null,
        },
      }));
    }
  }

  async function saveItemEdits(flag: ReviewFlag) {
    const details = itemDetails[flag.flag_id];
    if (!details?.item_id) return;
    const body: Record<string, unknown> = { item_id: details.item_id };
    if (editedLabel !== undefined) body.ground_truth_label = editedLabel;
    if (editedTags !== undefined) body.segment_tags = editedTags;
    await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setItemDetails((prev) => ({
      ...prev,
      [flag.flag_id]: {
        ...prev[flag.flag_id],
        ground_truth_label: editedLabel !== undefined ? editedLabel ?? null : prev[flag.flag_id].ground_truth_label,
        segment_tags: editedTags !== undefined ? JSON.stringify(editedTags) : prev[flag.flag_id].segment_tags,
      },
    }));
  }

  async function resolveFlag(flagId: string) {
    const flag = flags.find((f) => f.flag_id === flagId);
    if (!flag) return;
    const details = itemDetails[flag.flag_id];
    const origLabel = details?.ground_truth_label ?? null;
    const origAttrs = parseAttrs(details?.segment_tags);
    const finalLabel = editedLabel !== undefined ? editedLabel : origLabel;
    const finalAttrs = editedTags !== undefined ? editedTags : origAttrs;
    const action = deriveFlagResolutionAction(origLabel, finalLabel, origAttrs, finalAttrs);

    if (editedLabel !== undefined || editedTags !== undefined) {
      await saveItemEdits(flag);
    }
    await fetch("/api/review-flags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flag_id: flagId,
        status: "resolved",
        resolution_action: action,
        resolution_note: resolveNote || null,
        resolved_by: FLAG_RESOLVER_NAME,
        previous_ground_truth_label: origLabel,
        new_ground_truth_label: finalLabel,
        previous_attributes: origAttrs,
        new_attributes: finalAttrs,
      }),
    });
    setResolveNote("");
    closeModal();
    loadFlags();
  }

  function openModal(idx: number) {
    setPreviewIndex(idx);
    setResolveNote("");
    setEditedLabel(undefined);
    setEditedTags(undefined);
    const flag = flags[idx];
    if (flag) loadItemDetails(flag);
  }

  function closeModal() {
    setPreviewIndex(null);
    setEditedLabel(undefined);
    setEditedTags(undefined);
  }

  function navigateFlag(dir: number) {
    if (previewIndex == null) return;
    const next = Math.max(0, Math.min(flags.length - 1, previewIndex + dir));
    if (next !== previewIndex) openModal(next);
  }

  const currentFlag = previewIndex != null ? flags[previewIndex] : null;
  const currentDetails = currentFlag ? itemDetails[currentFlag.flag_id] : null;

  const currentDetection = currentFlag
    ? detections.find((d) => d.detection_id === currentFlag.detection_id)
    : null;
  const segmentOptions: string[] = Array.isArray(currentDetection?.segment_taxonomy)
    ? currentDetection.segment_taxonomy
    : [];

  const displayLabel = editedLabel !== undefined ? editedLabel : currentDetails?.ground_truth_label ?? null;
  const displayTags: string[] = editedTags !== undefined
    ? editedTags
    : (() => { try { return JSON.parse(currentDetails?.segment_tags || "[]"); } catch { return []; } })();

  return (
    <div className="space-y-4">
      <FlagsQueue
        openFlags={flags}
        resolvedFlags={resolvedFlags}
        onOpenFlagClick={(_flag, idx) => openModal(idx)}
        onResolvedFlagClick={(_flag, idx) => { setResolvedPreviewIndex(idx); const f = resolvedFlags[idx]; if (f) loadItemDetails(f); }}
        loading={loading}
      />

      {/* Flag review modal */}
      <ImagePreviewModal
        isOpen={previewIndex != null && !!currentFlag}
        imageUrl={currentDetails?.image_uri || ""}
        imageAlt={currentFlag?.image_id || ""}
        title="Flag Review"
        subtitle={currentFlag?.image_id || ""}
        index={previewIndex ?? 0}
        total={flags.length}
        onClose={closeModal}
        onPrev={() => navigateFlag(-1)}
        onNext={() => navigateFlag(1)}
        details={currentFlag ? (
          <div className="space-y-4">
            {/* Identity */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={SECTION_LABEL_CLASS}>Image ID</div>
                <p className="mt-1 text-xs font-mono text-gray-200">{currentFlag.image_id}</p>
              </div>
              {((currentFlag as any).annotator || (currentFlag as any).dataset_name) && (
                <div className="text-right">
                  {(currentFlag as any).annotator && (
                    <p className="text-xs font-medium text-gray-100">{(currentFlag as any).annotator}</p>
                  )}
                  {(currentFlag as any).dataset_name && (
                    <p className="text-[11px] text-gray-500">{(currentFlag as any).dataset_name}</p>
                  )}
                </div>
              )}
            </div>

            {/* Flag Reason */}
            <div className={SECTION_DIVIDER_CLASS}>
              <div className="border-l-2 border-amber-500 bg-amber-500/[0.06] rounded-r-md pl-3 pr-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <Flag className="h-3 w-3 text-amber-400" />
                  <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-amber-400">Flag Reason</span>
                </div>
                <p className="text-xs text-gray-200">{currentFlag.reason}</p>
                <p className="text-[11px] text-amber-200/50 mt-1">Flagged {new Date(currentFlag.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Model Prediction */}
            {currentDetails?.prediction && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className={SECTION_LABEL_CLASS}>Model Prediction</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Decision</span>
                  <span className={`text-xs font-semibold ${currentDetails.prediction.predicted_decision === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}`}>
                    {currentDetails.prediction.predicted_decision || "PARSE_FAIL"}
                  </span>
                </div>
                {(currentDetails.prediction.evidence || currentDetails.prediction.confidence != null) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Evidence</span>
                      {currentDetails.prediction.confidence != null && (
                        <span className="text-xs text-gray-300">
                          <span className="text-gray-500 mr-1">Confidence</span>
                          <span className="tabular-nums text-gray-200">{currentDetails.prediction.confidence.toFixed(3)}</span>
                        </span>
                      )}
                    </div>
                    {currentDetails.prediction.evidence && (
                      <p className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">{currentDetails.prediction.evidence}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Editable Ground Truth Label */}
            <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
              <div className={SECTION_LABEL_CLASS}>Ground Truth Label</div>
              {currentDetails?.item_id ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setEditedLabel("DETECTED")}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      displayLabel === "DETECTED"
                        ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)] border-[color:color-mix(in_srgb,var(--app-purple)_36%,transparent)]"
                        : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    DETECTED
                  </button>
                  <button
                    onClick={() => setEditedLabel("NOT_DETECTED")}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      displayLabel === "NOT_DETECTED"
                        ? "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)] border-[color:color-mix(in_srgb,var(--app-not-detected)_36%,transparent)]"
                        : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    NOT_DETECTED
                  </button>
                  <button
                    onClick={() => setEditedLabel(null)}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      !displayLabel
                        ? "bg-gray-800 text-gray-100 border-gray-500"
                        : "bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    UNSET
                  </button>
                </div>
              ) : (
                <p className={`text-xs font-medium ${
                  currentDetails?.ground_truth_label === "DETECTED" ? "text-[var(--app-purple)]" :
                  currentDetails?.ground_truth_label === "NOT_DETECTED" ? "text-[var(--app-not-detected)]" : "text-gray-500"
                }`}>
                  {currentDetails?.ground_truth_label || "UNSET"}
                  <span className="text-gray-500 font-normal ml-2">(read-only — no dataset item linked)</span>
                </p>
              )}
            </div>

            {/* Editable Attributes */}
            {(segmentOptions.length > 0 || displayTags.length > 0) && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className={SECTION_LABEL_CLASS}>Attributes</div>
                {currentDetails?.item_id ? (
                  segmentOptions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {segmentOptions.map((option) => {
                        const selected = displayTags.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              const next = selected ? displayTags.filter((v) => v !== option) : [...displayTags, option];
                              setEditedTags(next);
                            }}
                            className={`px-2.5 py-1 text-[11px] transition ${
                              selected
                                ? "rounded-md border border-sky-400/50 bg-sky-500/12 text-sky-100"
                                : "rounded-md border border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No taxonomy defined for this detection.</p>
                  )
                ) : (
                  <p className="text-xs text-gray-300">{formatTags(currentDetails?.segment_tags) || "None"}</p>
                )}
              </div>
            )}

            {/* Description */}
            {currentDetails?.image_description && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-1`}>
                <div className={SECTION_LABEL_CLASS}>Description</div>
                <p className="text-xs text-gray-300 whitespace-pre-wrap">{currentDetails.image_description}</p>
              </div>
            )}

            {/* Reviewer Assessment (auto-derived) */}
            {(() => {
              const origLabel = currentDetails?.ground_truth_label ?? null;
              const origAttrs = parseAttrs(currentDetails?.segment_tags);
              const finalLabel = editedLabel !== undefined ? editedLabel : origLabel;
              const finalAttrs = editedTags !== undefined ? editedTags : origAttrs;
              const derivedAction = deriveFlagResolutionAction(origLabel, finalLabel, origAttrs, finalAttrs);
              return (
                <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                  <div className={SECTION_LABEL_CLASS}>Reviewer Assessment</div>
                  <p className="text-[11px] text-gray-500">Set automatically from your label & attribute edits</p>
                  <div className="space-y-1.5">
                    {FLAG_ASSESSMENT_OPTIONS.map((opt) => {
                      const active = derivedAction === opt.value;
                      return (
                        <div
                          key={opt.value}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md border text-xs ${
                            active
                              ? "border-sky-400/70 bg-sky-500/10 text-sky-100"
                              : "border-white/[0.08] text-gray-500"
                          }`}
                        >
                          <span
                            className={`flex-shrink-0 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                              active ? "border-sky-300" : "border-gray-600"
                            }`}
                          >
                            {active && <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />}
                          </span>
                          <span>{opt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <input
                    className="app-input w-full px-2 py-1.5 text-sm mt-2"
                    placeholder="Note (optional)..."
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                  />
                </div>
              );
            })()}

            {/* Resolve — end of scroll, not pinned */}
            <div className={`${SECTION_DIVIDER_CLASS}`}>
              <button
                onClick={() => resolveFlag(currentFlag.flag_id)}
                className="app-btn app-btn-primary text-xs w-full py-2.5"
              >
                Resolve
              </button>
            </div>
          </div>
        ) : null}
      />

      {/* Read-only resolved flag preview */}
      {resolvedPreviewIndex != null && resolvedFlags[resolvedPreviewIndex] && (() => {
        const rFlag = resolvedFlags[resolvedPreviewIndex] as any;
        const rDetails = itemDetails[rFlag.flag_id];
        return (
          <ImagePreviewModal
            isOpen={true}
            imageUrl={rDetails?.image_uri || rFlag.image_uri || ""}
            imageAlt={rFlag.image_id || ""}
            title="Resolved Flag"
            subtitle={rFlag.image_id || ""}
            index={resolvedPreviewIndex}
            total={resolvedFlags.length}
            onClose={() => setResolvedPreviewIndex(null)}
            onPrev={() => { const next = Math.max(0, resolvedPreviewIndex - 1); setResolvedPreviewIndex(next); const f = resolvedFlags[next] as any; if (f) loadItemDetails(f); }}
            onNext={() => { const next = Math.min(resolvedFlags.length - 1, resolvedPreviewIndex + 1); setResolvedPreviewIndex(next); const f = resolvedFlags[next] as any; if (f) loadItemDetails(f); }}
            details={(() => {
              const prevLabel = rFlag.previous_ground_truth_label ?? null;
              const newLabel = rFlag.new_ground_truth_label ?? null;
              const hasLabelDiff = prevLabel !== null && newLabel !== null && prevLabel !== newLabel;
              const prevAttrs = parseAttrs(rFlag.previous_attributes);
              const newAttrs = parseAttrs(rFlag.new_attributes);
              const prevSet = new Set(prevAttrs);
              const newSet = new Set(newAttrs);
              const attrsChanged = !attrsEqual(prevAttrs, newAttrs);
              const unionOrdered: string[] = [];
              for (const t of prevAttrs) if (!unionOrdered.includes(t)) unionOrdered.push(t);
              for (const t of newAttrs) if (!unionOrdered.includes(t)) unionOrdered.push(t);
              const labelClass = (v: string | null) =>
                v === "DETECTED" ? "text-[var(--app-purple)]" :
                v === "NOT_DETECTED" ? "text-[var(--app-not-detected)]" : "text-gray-500";
              const resolvedBy = (rFlag as any).resolved_by as string | null | undefined;
              const resolvedTime = rFlag.resolved_at ? new Date(rFlag.resolved_at).toLocaleString() : "";
              const isDismissed = rFlag.status === "dismissed";
              return (
                <div className="space-y-4">
                  {/* Identity */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={SECTION_LABEL_CLASS}>Image ID</div>
                      <p className="mt-1 text-xs font-mono text-gray-200">{rFlag.image_id}</p>
                    </div>
                    {((rFlag as any).annotator || (rFlag as any).dataset_name) && (
                      <div className="text-right">
                        {(rFlag as any).annotator && (
                          <p className="text-xs font-medium text-gray-100">{(rFlag as any).annotator}</p>
                        )}
                        {(rFlag as any).dataset_name && (
                          <p className="text-[11px] text-gray-500">{(rFlag as any).dataset_name}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Flag Reason */}
                  <div className={SECTION_DIVIDER_CLASS}>
                    <div className="border-l-2 border-amber-500 bg-amber-500/[0.06] rounded-r-md pl-3 pr-3 py-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Flag className="h-3 w-3 text-amber-400" />
                        <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-amber-400">Flag Reason</span>
                      </div>
                      <p className="text-xs text-gray-200">{rFlag.reason}</p>
                      <p className="text-[11px] text-amber-200/50 mt-1">Flagged {new Date(rFlag.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* Model Prediction */}
                  {rDetails?.prediction && (
                    <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                      <div className={SECTION_LABEL_CLASS}>Model Prediction</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Decision</span>
                        <span className={`text-xs font-semibold ${rDetails.prediction.predicted_decision === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}`}>
                          {rDetails.prediction.predicted_decision || "PARSE_FAIL"}
                        </span>
                      </div>
                      {(rDetails.prediction.evidence || rDetails.prediction.confidence != null) && (
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">Evidence</span>
                            {rDetails.prediction.confidence != null && (
                              <span className="text-xs text-gray-300">
                                <span className="text-gray-500 mr-1">Confidence</span>
                                <span className="tabular-nums text-gray-200">{rDetails.prediction.confidence.toFixed(3)}</span>
                              </span>
                            )}
                          </div>
                          {rDetails.prediction.evidence && (
                            <p className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">{rDetails.prediction.evidence}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ground Truth Label (diff) */}
                  <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                    <div className="flex items-center justify-between">
                      <div className={SECTION_LABEL_CLASS}>Ground Truth Label</div>
                      {hasLabelDiff && (
                        <span className="text-[11px] text-gray-500">Updated on resolve</span>
                      )}
                    </div>
                    {hasLabelDiff ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium line-through text-red-400">{prevLabel}</span>
                        <span className="text-xs text-gray-500">→</span>
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{newLabel}</span>
                      </div>
                    ) : (
                      <p className={`text-xs font-medium ${labelClass(newLabel ?? prevLabel ?? rDetails?.ground_truth_label ?? null)}`}>
                        {newLabel ?? prevLabel ?? rDetails?.ground_truth_label ?? "UNSET"}
                      </p>
                    )}
                  </div>

                  {/* Attributes (diff) */}
                  {unionOrdered.length > 0 && (
                    <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                      <div className="flex items-center justify-between">
                        <div className={SECTION_LABEL_CLASS}>Attributes</div>
                        {attrsChanged && (
                          <span className="text-[11px] text-gray-500">Updated on resolve</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {unionOrdered.map((tag) => {
                          const inPrev = prevSet.has(tag);
                          const inNew = newSet.has(tag);
                          if (inPrev && inNew) {
                            return (
                              <span key={tag} className="rounded-md border border-sky-400/50 bg-sky-500/12 px-2 py-0.5 text-[11px] text-sky-100">
                                {tag}
                              </span>
                            );
                          }
                          if (inNew) {
                            return (
                              <span key={tag} className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                                + {tag}
                              </span>
                            );
                          }
                          return (
                            <span key={tag} className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300 line-through">
                              − {tag}
                            </span>
                          );
                        })}
                      </div>
                      {attrsChanged && (
                        <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-1">
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/60" />
                            Added
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-red-500/60" />
                            Removed
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resolution */}
                  <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                    <div className={SECTION_LABEL_CLASS}>Resolution</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        isDismissed
                          ? "bg-gray-500/10 text-gray-400"
                          : "bg-emerald-500/10 text-emerald-300"
                      }`}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDismissed ? "bg-gray-400" : "bg-emerald-400"}`} />
                        {isDismissed ? "Dismissed" : "Resolved"}
                      </span>
                      {rFlag.resolution_action && (
                        <span className="text-xs text-gray-200">{humanizeFlagAction(rFlag.resolution_action)}</span>
                      )}
                    </div>
                    {(resolvedBy || resolvedTime) && (
                      <p className="text-[11px] text-gray-500">
                        {resolvedBy ? `Resolved by ${resolvedBy}` : "Resolved"}
                        {resolvedBy && resolvedTime ? " · " : ""}
                        {resolvedTime}
                      </p>
                    )}
                    {rFlag.resolution_note && (
                      <p className="text-xs text-gray-300 whitespace-pre-wrap">{rFlag.resolution_note}</p>
                    )}
                  </div>
                </div>
              );
            })()}
          />
        );
      })()}
    </div>
  );
}

// ============ QA Sampling ============

interface EnrichedSample extends QaSample {
  image_uri?: string;
  image_id?: string;
  ground_truth_label?: string | null;
  segment_tags?: string;
  image_description?: string;
}

function SamplingView({ datasets, detections, onRefresh }: { datasets: DatasetQa[]; detections: Detection[]; onRefresh: () => void }) {
  const { pendingDatasetId, setPendingDatasetId } = useAppStore();
  const [selectedDataset, setSelectedDataset] = useState("");
  const [method, setMethod] = useState<"random" | "stratified">("random");
  const [countMode, setCountMode] = useState<"count" | "percentage">("percentage");
  const [count, setCount] = useState(20);
  const [percentage, setPercentage] = useState(20);
  const [samples, setSamples] = useState<EnrichedSample[]>([]);
  const [stats, setStats] = useState<{ total: number; reviewed: number; correct: number; incorrect: number; ambiguous: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [predictionCache, setPredictionCache] = useState<Record<string, Prediction | null>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [historySamples, setHistorySamples] = useState<any[]>([]);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [prevAttemptsCollapsed, setPrevAttemptsCollapsed] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyPreview, setHistoryPreview] = useState<{ list: any[]; index: number } | null>(null);
  const [editedLabel, setEditedLabel] = useState<string | null | undefined>(undefined);
  const [editedTags, setEditedTags] = useState<string[] | undefined>(undefined);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const selectedDatasetObj = datasets.find((d) => d.dataset_id === selectedDataset);
  const computedCount = countMode === "percentage" && selectedDatasetObj
    ? Math.ceil(selectedDatasetObj.size * percentage / 100)
    : count;

  const effectiveCount = countMode === "percentage" ? computedCount : count;

  async function loadSamples(datasetId: string) {
    const res = await fetch(`/api/qa?action=samples&dataset_id=${datasetId}`, { cache: "no-store" });
    const data = await res.json();
    setSamples(data.samples || []);
    setStats(data.stats || null);
    setHistorySamples(data.history || []);
    setCurrentAttempt(data.currentAttempt || 0);
    setTotalAttempts(data.totalAttempts || 0);
    return data.samples || [];
  }

  async function createSamples() {
    if (!selectedDataset) return;
    setLoading(true);
    await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_samples", dataset_id: selectedDataset, method, count: effectiveCount }),
    });
    await loadSamples(selectedDataset);
    onRefresh();
    setLoading(false);
  }

  async function reviewSample(sampleId: string) {
    setSubmitting(true);
    setReviewError(null);
    try {
      const originalLabel = currentSample?.ground_truth_label ?? null;
      const originalTags: string[] = parseAttrs(currentSample?.segment_tags);
      const finalLabel = editedLabel !== undefined ? editedLabel : originalLabel;
      const finalTags = editedTags !== undefined ? editedTags : originalTags;
      const outcome = deriveFlagResolutionAction(originalLabel, finalLabel, originalTags, finalTags);
      if (currentSample && (editedLabel !== undefined || editedTags !== undefined)) {
        await saveItemEdits(currentSample);
      }
      const corrections: Record<string, unknown> = {};
      if (outcome !== "accepted") {
        corrections.original_label = originalLabel;
        corrections.original_tags = originalTags;
        corrections.corrected_label = finalLabel;
        corrections.corrected_tags = finalTags;
      }
      const res = await fetch("/api/qa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review_sample", sample_id: sampleId, outcome, note: reviewNote || null, reviewer: FLAG_RESOLVER_NAME, ...corrections }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setReviewError(err.error || `Server error: ${res.status}`);
        setSubmitting(false);
        return;
      }
      setReviewNote("");
      setEditedLabel(undefined);
      setEditedTags(undefined);
      if (selectedDataset) {
        const freshSamples = await loadSamples(selectedDataset);
        const freshPending = freshSamples.filter((s: any) => s.status === "pending");
        if (freshPending.length > 0 && previewIndex != null) {
          const nextIdx = Math.min(previewIndex, freshPending.length - 1);
          setPreviewIndex(nextIdx);
          if (freshPending[nextIdx]) loadPrediction(freshPending[nextIdx]);
        } else {
          setPreviewIndex(null);
        }
      }
    } catch (e: any) {
      setReviewError(e.message || "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadPrediction(sample: EnrichedSample) {
    if (predictionCache[sample.sample_id] !== undefined) return;
    const res = await fetch(`/api/qa?action=item_details&item_id=${sample.item_id}`);
    if (res.ok) {
      const data = await res.json();
      setPredictionCache((prev) => ({ ...prev, [sample.sample_id]: data.prediction || null }));
    }
  }

  function openPreview(idx: number) {
    setPreviewIndex(idx);
    setReviewNote("");
    setEditedLabel(undefined);
    setEditedTags(undefined);
    const sample = pendingSamples[idx];
    if (sample) loadPrediction(sample);
  }

  async function saveItemEdits(sample: EnrichedSample) {
    if (!sample.item_id) return;
    const body: Record<string, unknown> = { item_id: sample.item_id };
    if (editedLabel !== undefined) body.ground_truth_label = editedLabel;
    if (editedTags !== undefined) body.segment_tags = editedTags;
    await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  useEffect(() => {
    if (selectedDataset) loadSamples(selectedDataset);
  }, [selectedDataset]);

  useEffect(() => {
    if (pendingDatasetId && datasets.some((d) => d.dataset_id === pendingDatasetId)) {
      setSelectedDataset(pendingDatasetId);
      setPendingDatasetId(null);
    }
  }, [pendingDatasetId, datasets, setPendingDatasetId]);

  const pendingSamples = samples.filter((s) => s.status === "pending");
  const reviewedSamples = samples.filter((s) => s.status === "reviewed" || s.status === "accepted");
  const currentSample = previewIndex != null ? pendingSamples[previewIndex] : null;
  const currentPrediction = currentSample ? predictionCache[currentSample.sample_id] : null;
  const historySample = historyPreview ? historyPreview.list[historyPreview.index] : null;

  const historyPageCount = Math.ceil(reviewedSamples.length / historyPageSize);
  const paginatedHistory = reviewedSamples.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize
  );

  const currentDetection = selectedDatasetObj
    ? detections.find((d) => d.detection_id === selectedDatasetObj.detection_id)
    : null;
  const segmentOptions: string[] = Array.isArray(currentDetection?.segment_taxonomy)
    ? currentDetection.segment_taxonomy
    : [];
  const displayLabel = editedLabel !== undefined ? editedLabel : currentSample?.ground_truth_label ?? null;
  const displayTags: string[] = editedTags !== undefined
    ? editedTags
    : (() => { try { return JSON.parse(currentSample?.segment_tags || "[]"); } catch { return []; } })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="app-label mb-1.5 block text-xs">Dataset</label>
          <select
            className="app-select h-9 w-64 px-3 text-sm"
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
          >
            <option value="">Select dataset...</option>
            {datasets.filter((d) => ["submitted", "in_qa"].includes(d.qa_status)).map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>{d.name} ({d.size} items)</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="app-label mb-1.5 block text-xs">Method</label>
          <select
            className="app-select h-9 w-48 px-3 text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
          >
            <option value="random">Random</option>
            <option value="stratified">Stratified (by label)</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="app-label mb-1.5 block text-xs">Sample Size</label>
          <div className="flex items-center gap-2">
            <select
              className="app-select h-9 w-36 px-3 text-sm"
              value={countMode}
              onChange={(e) => setCountMode(e.target.value as "count" | "percentage")}
            >
              <option value="count">Count</option>
              <option value="percentage">Percentage</option>
            </select>
            <div className="relative shrink-0 w-32">
              {countMode === "count" ? (
                <input
                  type="number"
                  className="app-input h-9 w-full px-3 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={count}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setCount(isNaN(val) ? 1 : Math.max(1, Math.min(500, val)));
                  }}
                  min={1}
                  max={500}
                />
              ) : (
                <input
                  type="number"
                  className="app-input h-9 w-full pl-3 pr-8 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={percentage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setPercentage(isNaN(val) ? 1 : Math.max(1, Math.min(100, val)));
                  }}
                  min={1}
                  max={100}
                />
              )}
              {countMode === "percentage" && (
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-[var(--app-text-muted)]">%</span>
              )}
            </div>
            {countMode === "percentage" && selectedDatasetObj && (
              <span className="whitespace-nowrap text-xs text-[var(--app-text-subtle)]">
                = {computedCount} items
              </span>
            )}
          </div>
        </div>
        <button
          onClick={createSamples}
          disabled={!selectedDataset || loading}
          className="app-btn app-btn-primary h-9 px-4 text-sm"
        >
          {samples.length > 0 ? "Regenerate Samples" : "Generate Samples"}
        </button>
      </div>

      {selectedDatasetObj && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--app-surface-soft)] border border-[var(--app-border)]">
          <span className="text-xs text-[var(--app-text-muted)]">Selected:</span>
          <span className="text-xs font-medium text-[var(--app-text)]">{selectedDatasetObj.name}</span>
          <span className={`app-badge ${STATUS_BADGE_CLASSES[selectedDatasetObj.qa_status] || STATUS_BADGE_CLASSES.draft}`}>
            {STATUS_LABELS[selectedDatasetObj.qa_status] || selectedDatasetObj.qa_status}
          </span>
          <span className="text-[11px] text-[var(--app-text-subtle)]">{selectedDatasetObj.size} items</span>
          {totalAttempts > 1 && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
              Attempt {currentAttempt}
            </span>
          )}
        </div>
      )}

      {selectedDataset && !samples.length && !loading && (
        <div className="app-card p-6 text-center space-y-2">
          <p className="text-sm text-[var(--app-text-muted)]">No QA samples generated yet</p>
          <p className="text-xs text-[var(--app-text-subtle)]">Generate a sample set to begin quality review</p>
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="app-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-[var(--app-text-muted)]">Review Progress</span>
              <span className="text-[var(--app-text)] font-medium">{stats.reviewed}/{stats.total}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>{stats.correct} accepted</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-amber-400"></span>{stats.incorrect} corrected</span>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
            <div
              className={`h-full transition-all ${stats.reviewed === stats.total ? "bg-emerald-400" : "bg-[#5cb8ff]"}`}
              style={{ width: `${(stats.reviewed / stats.total) * 100}%` }}
            />
          </div>
          {stats.reviewed > 0 && (() => {
            const accuracyPct = Math.round((stats.correct / stats.reviewed) * 100);
            const threshold = 90;
            const meetsThreshold = accuracyPct >= threshold;
            const allReviewed = stats.reviewed === stats.total;
            const canApprove = meetsThreshold && allReviewed && selectedDatasetObj &&
              selectedDatasetObj.qa_status === "in_qa";
            return (
              <div className="space-y-3 pt-3 border-t border-[var(--app-border)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--app-text-muted)]">Accuracy:</span>
                    <span className={`text-sm font-semibold ${
                      meetsThreshold ? "text-emerald-300" : accuracyPct >= 80 ? "text-amber-300" : "text-red-300"
                    }`}>
                      {accuracyPct}%
                    </span>
                    <span className="text-[10px] text-[var(--app-text-subtle)]">
                      (threshold: {threshold}%)
                    </span>
                    {meetsThreshold ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-400" />
                    )}
                  </div>
                  {!allReviewed && (
                    <span className="text-[11px] text-[var(--app-text-subtle)]">{stats.total - stats.reviewed} remaining</span>
                  )}
                </div>
                {allReviewed && selectedDatasetObj && ["in_qa", "submitted"].includes(selectedDatasetObj.qa_status) && (
                  <div className="flex flex-col gap-3">
                    {canApprove && !showRevisionForm && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs font-medium text-emerald-300">QA Passed</p>
                          <p className="text-[11px] text-[var(--app-text-subtle)]">All {stats.total} samples reviewed. Accuracy meets threshold.</p>
                        </div>
                        <button
                          onClick={async () => {
                            await fetch("/api/qa", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "update_status",
                                dataset_id: selectedDataset,
                                new_status: "approved",
                              }),
                            });
                            setSelectedDataset("");
                            setSamples([]);
                            setStats(null);
                            onRefresh();
                          }}
                          className="app-btn app-btn-success app-btn-sm text-xs shrink-0"
                        >
                          Approve Dataset
                        </button>
                      </div>
                    )}
                    {!meetsThreshold && !showRevisionForm && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs font-medium text-amber-300">Below Threshold</p>
                          <p className="text-[11px] text-[var(--app-text-subtle)]">{stats.incorrect} of {stats.total} samples required corrections.</p>
                        </div>
                        <button
                          onClick={() => setShowRevisionForm(true)}
                          className="app-btn app-btn-warning app-btn-sm text-xs shrink-0"
                        >
                          Return for Revision
                        </button>
                      </div>
                    )}
                    {showRevisionForm && (
                      <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-3">
                        <p className="text-xs font-medium text-amber-300">Return for Revision</p>
                        <p className="text-[11px] text-[var(--app-text-subtle)]">
                          {stats.incorrect} of {stats.reviewed} samples required corrections ({accuracyPct}% accuracy).
                        </p>
                        <textarea
                          className="app-input w-full px-3 py-2 text-sm min-h-[80px]"
                          placeholder="Revision instructions for annotator (e.g., review changes made, re-read spec, resubmit)..."
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const note = [
                                `QA accuracy ${accuracyPct}% (threshold ${threshold}%). ${stats.incorrect} corrections made.`,
                                revisionNote,
                              ].filter(Boolean).join("\n\n");
                              await fetch("/api/qa", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "update_status",
                                  dataset_id: selectedDataset,
                                  new_status: "needs_revision",
                                  revision_note: note,
                                }),
                              });
                              setShowRevisionForm(false);
                              setRevisionNote("");
                              setSelectedDataset("");
                              setSamples([]);
                              setStats(null);
                              onRefresh();
                            }}
                            className="app-btn app-btn-warning app-btn-sm text-xs"
                          >
                            Submit & Return for Revision
                          </button>
                          <button onClick={() => setShowRevisionForm(false)} className="app-btn app-btn-subtle app-btn-sm text-xs">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {pendingSamples.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[var(--app-text)]">Pending Samples ({pendingSamples.length})</h4>
          {pendingSamples.map((sample, idx) => (
            <div
              key={sample.sample_id}
              className="app-card flex items-center gap-4 p-3 cursor-pointer hover:bg-[var(--app-table-row-hover)]"
              onClick={() => openPreview(idx)}
            >
              {sample.image_uri && (
                <img src={sample.image_uri} alt={sample.image_id || ""} className="h-12 w-12 rounded object-cover border border-[var(--app-border)]" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{sample.image_id || sample.item_id}</p>
                <div className="flex gap-3 mt-1 text-[11px] text-[var(--app-text-subtle)]">
                  <span>Method: {sample.sample_method}</span>
                  {sample.ground_truth_label && <span>GT: {sample.ground_truth_label}</span>}
                </div>
              </div>
              <span className="text-xs text-[var(--app-text-subtle)]">Click to review</span>
            </div>
          ))}
        </div>
      )}

      {/* Reviewed Samples */}
      {reviewedSamples.length > 0 && (
        <div className="app-card overflow-hidden">
          <button
            onClick={() => setHistoryCollapsed(!historyCollapsed)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
          >
            {historyCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" />}
            <span className="text-sm font-medium text-[var(--app-text)]">Reviewed Samples</span>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">{reviewedSamples.length} reviewed</span>
          </button>
          {!historyCollapsed && (
            <div className="border-t border-[var(--app-border)]">
              <div className="max-h-[400px] overflow-y-auto">
                {paginatedHistory.map((sample, idx) => {
                  const globalIdx = (historyPage - 1) * historyPageSize + idx;
                  return (
                    <div
                      key={sample.sample_id}
                      className="flex items-center gap-4 px-4 py-3 border-b border-[var(--app-border)] last:border-b-0 cursor-pointer hover:bg-[var(--app-table-row-hover)]"
                      onClick={() => setHistoryPreview({ list: reviewedSamples, index: globalIdx })}
                    >
                      {sample.image_uri && (
                        <img src={sample.image_uri} alt={sample.image_id || ""} className="h-10 w-10 rounded object-cover border border-[var(--app-border)]" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{sample.image_id || sample.item_id}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px]">
                          <span className={`rounded px-1.5 py-0.5 font-medium ${
                            sample.outcome === "accepted" ? "bg-emerald-500/10 text-emerald-300" :
                            "bg-amber-500/10 text-amber-300"
                          }`}>
                            {sample.outcome?.replace(/_/g, " ")}
                          </span>
                          {sample.note && <span className="text-[var(--app-text-subtle)] truncate max-w-[200px]">{sample.note}</span>}
                          {sample.reviewed_at && <span className="text-[var(--app-text-subtle)]">{new Date(sample.reviewed_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {historyPageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--app-border)] bg-[var(--app-surface-soft)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--app-text-subtle)]">Page {historyPage} of {historyPageCount}</span>
                    <select
                      className="app-select px-1 py-0.5 text-[11px]"
                      value={historyPageSize}
                      onChange={(e) => { setHistoryPageSize(parseInt(e.target.value)); setHistoryPage(1); }}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                    </select>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Prev</button>
                    <button onClick={() => setHistoryPage((p) => Math.min(historyPageCount, p + 1))} disabled={historyPage >= historyPageCount} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History preview modal (read-only) */}
      <ImagePreviewModal
        isOpen={historyPreview != null && !!historySample}
        imageUrl={historySample?.image_uri || ""}
        imageAlt={historySample?.image_id || ""}
        title="Reviewed Sample"
        subtitle={historySample?.image_id || ""}
        index={historyPreview?.index ?? 0}
        total={historyPreview?.list.length ?? 0}
        onClose={() => setHistoryPreview(null)}
        onPrev={() => setHistoryPreview((p) => p ? { ...p, index: Math.max(0, p.index - 1) } : null)}
        onNext={() => setHistoryPreview((p) => p ? { ...p, index: Math.min(p.list.length - 1, p.index + 1) } : null)}
        details={historySample ? (() => {
          const prevLabel: string | null = historySample.original_label ?? null;
          const newLabel: string | null = historySample.corrected_label ?? (historySample.ground_truth_label ?? null);
          const hasLabelDiff = prevLabel !== null && newLabel !== null && prevLabel !== newLabel;
          const prevAttrs = parseAttrs(historySample.original_tags);
          const newAttrs = historySample.corrected_tags != null
            ? parseAttrs(historySample.corrected_tags)
            : parseAttrs(historySample.segment_tags);
          const prevSet = new Set(prevAttrs);
          const newSet = new Set(newAttrs);
          const hasCorrectionSnapshot = historySample.original_label != null || historySample.original_tags != null;
          const attrsChanged = hasCorrectionSnapshot && !attrsEqual(prevAttrs, newAttrs);
          const unionOrdered: string[] = [];
          if (hasCorrectionSnapshot) {
            for (const t of prevAttrs) if (!unionOrdered.includes(t)) unionOrdered.push(t);
            for (const t of newAttrs) if (!unionOrdered.includes(t)) unionOrdered.push(t);
          } else {
            for (const t of newAttrs) if (!unionOrdered.includes(t)) unionOrdered.push(t);
          }
          const labelClass = (v: string | null) =>
            v === "DETECTED" ? "text-[var(--app-purple)]" :
            v === "NOT_DETECTED" ? "text-[var(--app-not-detected)]" : "text-gray-500";
          const reviewerName: string | null | undefined = historySample.reviewer;
          const reviewedTime = historySample.reviewed_at ? new Date(historySample.reviewed_at).toLocaleString() : "";
          return (
            <div className="space-y-4">
              {/* Identity */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={SECTION_LABEL_CLASS}>Image ID</div>
                  <p className="mt-1 text-xs font-mono text-gray-200">{historySample.image_id || historySample.item_id}</p>
                </div>
                {selectedDatasetObj && (
                  <div className="text-right max-w-[50%] min-w-0">
                    {(selectedDatasetObj as any).assigned_to && (
                      <p className="text-xs font-medium text-gray-100 truncate" title={(selectedDatasetObj as any).assigned_to}>{(selectedDatasetObj as any).assigned_to}</p>
                    )}
                    {currentDetection?.display_name && (
                      <p className="text-[11px] text-gray-500 truncate" title={currentDetection.display_name}>{currentDetection.display_name}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Ground Truth Label (diff) */}
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className="flex items-center justify-between">
                  <div className={SECTION_LABEL_CLASS}>Ground Truth Label</div>
                  {hasLabelDiff && (
                    <span className="text-[11px] text-gray-500">Updated on review</span>
                  )}
                </div>
                {hasLabelDiff ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium line-through text-red-400">{prevLabel}</span>
                    <span className="text-xs text-gray-500">→</span>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{newLabel}</span>
                  </div>
                ) : (
                  <p className={`text-xs font-medium ${labelClass(newLabel)}`}>
                    {newLabel || "UNSET"}
                  </p>
                )}
              </div>

              {/* Attributes (diff) */}
              {unionOrdered.length > 0 && (
                <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                  <div className="flex items-center justify-between">
                    <div className={SECTION_LABEL_CLASS}>Attributes</div>
                    {attrsChanged && (
                      <span className="text-[11px] text-gray-500">Updated on review</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unionOrdered.map((tag) => {
                      const inPrev = hasCorrectionSnapshot ? prevSet.has(tag) : true;
                      const inNew = newSet.has(tag);
                      if (inPrev && inNew) {
                        return (
                          <span key={tag} className="rounded-md border border-sky-400/50 bg-sky-500/12 px-2 py-0.5 text-[11px] text-sky-100">
                            {tag}
                          </span>
                        );
                      }
                      if (inNew) {
                        return (
                          <span key={tag} className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                            + {tag}
                          </span>
                        );
                      }
                      return (
                        <span key={tag} className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300 line-through">
                          − {tag}
                        </span>
                      );
                    })}
                  </div>
                  {attrsChanged && (
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-1">
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/60" />
                        Added
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-sm bg-red-500/60" />
                        Removed
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Reviewer Assessment */}
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className={SECTION_LABEL_CLASS}>Reviewer Assessment</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-300">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Reviewed
                  </span>
                  {historySample.outcome && (
                    <span className="text-xs text-gray-200">{humanizeFlagAction(historySample.outcome)}</span>
                  )}
                </div>
                {(reviewerName || reviewedTime) && (
                  <p className="text-[11px] text-gray-500">
                    {reviewerName ? `Reviewed by ${reviewerName}` : "Reviewed"}
                    {reviewerName && reviewedTime ? " · " : ""}
                    {reviewedTime}
                  </p>
                )}
                {historySample.note && (
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{historySample.note}</p>
                )}
              </div>
            </div>
          );
        })() : null}
      />

      {/* Previous Attempts History */}
      {historySamples.length > 0 && (
        <div className="app-card overflow-hidden">
          <button
            onClick={() => setPrevAttemptsCollapsed(!prevAttemptsCollapsed)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
          >
            {prevAttemptsCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" />}
            <span className="text-sm font-medium text-[var(--app-text)]">QA History</span>
            <span className="rounded-full bg-gray-500/20 px-2 py-0.5 text-[10px] font-medium text-gray-300">{totalAttempts - 1} previous {totalAttempts - 1 === 1 ? "attempt" : "attempts"}</span>
          </button>
          {!prevAttemptsCollapsed && (() => {
            const grouped: Record<number, any[]> = {};
            for (const s of historySamples) {
              const a = s.attempt_number || 1;
              if (!grouped[a]) grouped[a] = [];
              grouped[a].push(s);
            }
            const attempts = Object.keys(grouped).map(Number).sort((a, b) => b - a);
            return (
              <div className="border-t border-[var(--app-border)] divide-y divide-[var(--app-border)]">
                {attempts.map((attemptNum) => {
                  const attemptSamples = grouped[attemptNum];
                  const total = attemptSamples.length;
                  const correct = attemptSamples.filter((s: any) => s.outcome === "accepted").length;
                  const incorrect = total - correct;
                  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                  const date = attemptSamples[0]?.created_at ? new Date(attemptSamples[0].created_at).toLocaleDateString() : "";
                  return (
                    <div key={attemptNum} className="px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-[var(--app-text)]">Attempt {attemptNum}</span>
                          {date && <span className="text-[11px] text-[var(--app-text-subtle)]">{date}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="text-[var(--app-text-subtle)]">{total} samples</span>
                          <span className="text-emerald-300">{correct} accepted</span>
                          <span className="text-amber-300">{incorrect} corrected</span>
                          <span className={`font-medium ${accuracy >= 90 ? "text-emerald-300" : accuracy >= 80 ? "text-amber-300" : "text-red-400"}`}>
                            {accuracy}% accuracy
                          </span>
                        </div>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto rounded border border-[var(--app-border)]">
                        {attemptSamples.map((sample: any, sIdx: number) => (
                          <button
                            key={sample.sample_id}
                            type="button"
                            onClick={() => setHistoryPreview({ list: attemptSamples, index: sIdx })}
                            className="flex w-full items-center gap-3 px-3 py-2 border-b border-[var(--app-border)] last:border-b-0 text-left cursor-pointer hover:bg-[var(--app-table-row-hover)]"
                          >
                            {sample.image_uri && (
                              <img src={sample.image_uri} alt={sample.image_id || ""} className="h-8 w-8 rounded object-cover border border-[var(--app-border)]" />
                            )}
                            <p className="text-[11px] font-mono text-[var(--app-text-subtle)] truncate flex-1">{sample.image_id || sample.item_id}</p>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              sample.outcome === "accepted" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"
                            }`}>
                              {sample.outcome?.replace(/_/g, " ") || "pending"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      <ImagePreviewModal
        isOpen={previewIndex != null && !!currentSample}
        imageUrl={currentSample?.image_uri || ""}
        imageAlt={currentSample?.image_id || ""}
        title="QA Sample Review"
        subtitle={currentSample?.image_id || ""}
        index={previewIndex ?? 0}
        total={pendingSamples.length}
        onClose={() => { setPreviewIndex(null); setEditedLabel(undefined); setEditedTags(undefined); }}
        onPrev={() => { const next = Math.max(0, (previewIndex ?? 0) - 1); setPreviewIndex(next); setEditedLabel(undefined); setEditedTags(undefined); if (pendingSamples[next]) loadPrediction(pendingSamples[next]); }}
        onNext={() => { const next = Math.min(pendingSamples.length - 1, (previewIndex ?? 0) + 1); setPreviewIndex(next); setEditedLabel(undefined); setEditedTags(undefined); if (pendingSamples[next]) loadPrediction(pendingSamples[next]); }}
        details={currentSample ? (
          <div className="space-y-4">
            {/* Identity */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={SECTION_LABEL_CLASS}>Image ID</div>
                <p className="mt-1 text-xs font-mono text-gray-200">{currentSample.image_id || currentSample.item_id}</p>
              </div>
              {selectedDatasetObj && (
                <div className="text-right max-w-[50%] min-w-0">
                  {(selectedDatasetObj as any).assigned_to && (
                    <p className="text-xs font-medium text-gray-100 truncate" title={(selectedDatasetObj as any).assigned_to}>{(selectedDatasetObj as any).assigned_to}</p>
                  )}
                  {currentDetection?.display_name && (
                    <p className="text-[11px] text-gray-500 truncate" title={currentDetection.display_name}>{currentDetection.display_name}</p>
                  )}
                </div>
              )}
            </div>

            {/* Model Prediction */}
            {currentPrediction && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className={SECTION_LABEL_CLASS}>Model Prediction</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Decision</span>
                  <span className={`text-xs font-semibold ${currentPrediction.predicted_decision === "DETECTED" ? "text-[var(--app-purple)]" : "text-[var(--app-not-detected)]"}`}>
                    {currentPrediction.predicted_decision || "PARSE_FAIL"}
                  </span>
                </div>
                {(currentPrediction.evidence || currentPrediction.confidence != null) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Evidence</span>
                      {currentPrediction.confidence != null && (
                        <span className="text-xs text-gray-300">
                          <span className="text-gray-500 mr-1">Confidence</span>
                          <span className="tabular-nums text-gray-200">{currentPrediction.confidence.toFixed(3)}</span>
                        </span>
                      )}
                    </div>
                    {currentPrediction.evidence && (
                      <p className="mt-1 text-xs text-gray-300 whitespace-pre-wrap">{currentPrediction.evidence}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Editable Ground Truth Label */}
            <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
              <div className={SECTION_LABEL_CLASS}>Ground Truth Label</div>
              {currentSample.item_id ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setEditedLabel("DETECTED")}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      displayLabel === "DETECTED"
                        ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)] border-[color:color-mix(in_srgb,var(--app-purple)_36%,transparent)]"
                        : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    DETECTED
                  </button>
                  <button
                    onClick={() => setEditedLabel("NOT_DETECTED")}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      displayLabel === "NOT_DETECTED"
                        ? "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)] border-[color:color-mix(in_srgb,var(--app-not-detected)_36%,transparent)]"
                        : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    NOT_DETECTED
                  </button>
                  <button
                    onClick={() => setEditedLabel(null)}
                    className={`px-3 py-1.5 rounded text-xs border ${
                      !displayLabel
                        ? "bg-gray-800 text-gray-100 border-gray-500"
                        : "bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800"
                    }`}
                  >
                    UNSET
                  </button>
                </div>
              ) : (
                <p className={`text-xs font-medium ${
                  currentSample.ground_truth_label === "DETECTED" ? "text-[var(--app-purple)]" :
                  currentSample.ground_truth_label === "NOT_DETECTED" ? "text-[var(--app-not-detected)]" : "text-gray-500"
                }`}>
                  {currentSample.ground_truth_label || "UNSET"}
                </p>
              )}
            </div>

            {/* Editable Attributes */}
            {(segmentOptions.length > 0 || displayTags.length > 0) && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                <div className={SECTION_LABEL_CLASS}>Attributes</div>
                {currentSample.item_id ? (
                  segmentOptions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {segmentOptions.map((option) => {
                        const selected = displayTags.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              const next = selected ? displayTags.filter((v) => v !== option) : [...displayTags, option];
                              setEditedTags(next);
                            }}
                            className={`px-2.5 py-1 text-[11px] transition ${
                              selected
                                ? "rounded-md border border-sky-400/50 bg-sky-500/12 text-sky-100"
                                : "rounded-md border border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No taxonomy defined for this detection.</p>
                  )
                ) : (
                  <p className="text-xs text-gray-300">{formatTags(currentSample.segment_tags) || "None"}</p>
                )}
              </div>
            )}

            {/* Description */}
            {currentSample.image_description && (
              <div className={`${SECTION_DIVIDER_CLASS} space-y-1`}>
                <div className={SECTION_LABEL_CLASS}>Description</div>
                <p className="text-xs text-gray-300 whitespace-pre-wrap">{currentSample.image_description}</p>
              </div>
            )}

            {/* Reviewer Assessment (auto-derived) */}
            {(() => {
              const origLabel = currentSample.ground_truth_label ?? null;
              const origAttrs = parseAttrs(currentSample.segment_tags);
              const finalLabel = editedLabel !== undefined ? editedLabel : origLabel;
              const finalAttrs = editedTags !== undefined ? editedTags : origAttrs;
              const derivedAction = deriveFlagResolutionAction(origLabel, finalLabel, origAttrs, finalAttrs);
              return (
                <div className={`${SECTION_DIVIDER_CLASS} space-y-2`}>
                  <div className={SECTION_LABEL_CLASS}>Reviewer Assessment</div>
                  <p className="text-[11px] text-gray-500">Set automatically from your label & attribute edits</p>
                  <div className="space-y-1.5">
                    {FLAG_ASSESSMENT_OPTIONS.map((opt) => {
                      const active = derivedAction === opt.value;
                      return (
                        <div
                          key={opt.value}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md border text-xs ${
                            active
                              ? "border-sky-400/70 bg-sky-500/10 text-sky-100"
                              : "border-white/[0.08] text-gray-500"
                          }`}
                        >
                          <span
                            className={`flex-shrink-0 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                              active ? "border-sky-300" : "border-gray-600"
                            }`}
                          >
                            {active && <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />}
                          </span>
                          <span>{opt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <input
                    className="app-input w-full px-2 py-1.5 text-sm mt-2"
                    placeholder="Note (optional)..."
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                </div>
              );
            })()}

            {/* Submit Review — end of scroll */}
            <div className={`${SECTION_DIVIDER_CLASS}`}>
              <button
                onClick={() => reviewSample(currentSample.sample_id)}
                disabled={submitting}
                className="app-btn app-btn-primary text-xs w-full py-2.5 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Submit Review"}
              </button>
              {reviewError && <p className="text-xs text-red-400 mt-2">{reviewError}</p>}
            </div>
          </div>
        ) : null}
      />
    </div>
  );
}

// ============ Metrics Chart ============

function MetricsChart({
  data,
  lines,
  colors,
  chartType,
  metricKey,
  isRate,
  showLabels,
}: {
  data: any[];
  lines: string[];
  colors: string[];
  chartType: "line" | "bar";
  metricKey: string;
  isRate: boolean;
  showLabels: boolean;
}) {
  const formatValue = (value: number | null) => {
    if (value === null || value === undefined) return "—";
    if (isRate) return `${(value * 100).toFixed(1)}%`;
    return String(value);
  };

  const formatLabel = (value: any) => {
    if (value === null || value === undefined) return "";
    if (isRate) return `${(value * 100).toFixed(0)}%`;
    return String(value);
  };

  const tooltipFormatter = (value: any) => formatValue(value);
  const yTickFormatter = (value: number) => {
    if (isRate) return `${(value * 100).toFixed(0)}%`;
    return String(value);
  };

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} tickFormatter={yTickFormatter} domain={isRate ? [0, 1] : undefined} />
          <Tooltip
            contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "var(--app-text-muted)" }}
            formatter={tooltipFormatter}
          />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {lines.map((line, i) => (
            <Bar key={line} dataKey={line} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]}>
              {showLabels && <LabelList dataKey={line} position="top" formatter={formatLabel} style={{ fontSize: 10, fill: "var(--app-text-muted)" }} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} tickFormatter={yTickFormatter} domain={isRate ? [0, 1] : undefined} />
        <Tooltip
          contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: "var(--app-text-muted)" }}
          formatter={tooltipFormatter}
        />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {lines.map((line, i) => (
          <Line key={line} type="monotone" dataKey={line} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls>
            {showLabels && <LabelList dataKey={line} position="top" formatter={formatLabel} style={{ fontSize: 10, fill: "var(--app-text-muted)" }} />}
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ============ Logs & Performance ============

function LogsView({ datasets, detections, onNavigate }: { datasets: DatasetQa[]; detections: Detection[]; onNavigate: (view: SubView) => void }) {
  const [metrics, setMetrics] = useState<AnnotatorMetrics[]>([]);
  const [totals, setTotals] = useState<AnnotatorMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof AnnotatorMetrics>("accuracy");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [history, setHistory] = useState<any[]>([]);
  const [allSnapshots, setAllSnapshots] = useState<any[]>([]);
  const [chartAnnotator, setChartAnnotator] = useState("");
  const [chartMetric, setChartMetric] = useState<string>("accuracy");
  const [chartPeriodCount, setChartPeriodCount] = useState(5);
  const [chartPeriodType, setChartPeriodType] = useState<"week" | "month">("week");
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tablePeriod, setTablePeriod] = useState<"all" | "this_week" | "last_week" | "this_month" | "last_month">("all");
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [tempCount, setTempCount] = useState(5);
  const [tempUnit, setTempUnit] = useState<"week" | "month">("week");

  const metricOptions = [
    { value: "accuracy", label: "Accuracy" },
    { value: "correction", label: "Correction" },
    { value: "label_error", label: "Label Match" },
    { value: "attribute_error", label: "Attr Match" },
    { value: "flag_rate", label: "Flag Rate" },
    { value: "datasets_assigned", label: "Assigned" },
    { value: "datasets_completed", label: "Completed" },
    { value: "items_labeled", label: "Items" },
  ];

  async function loadMetrics() {
    setLoading(true);
    const res = await fetch("/api/qa/metrics");
    const data = await res.json();
    setMetrics(data.metrics || []);
    setTotals(data.totals || null);
    setLoading(false);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    const params = new URLSearchParams();
    if (chartAnnotator) params.set("annotator", chartAnnotator);
    params.set("period_type", chartPeriodType);
    params.set("count", String(chartPeriodCount));
    const res = await fetch(`/api/qa/metrics/history?${params}`);
    const data = await res.json();
    setHistory(data.history || []);
    setHistoryLoading(false);
  }

  async function loadAllSnapshots() {
    const res = await fetch("/api/qa/metrics/history?period_type=week&count=52");
    const data = await res.json();
    setAllSnapshots(data.history || []);
  }

  useEffect(() => { loadMetrics(); loadAllSnapshots(); }, []);

  useEffect(() => {
    loadHistory();
  }, [chartAnnotator, chartPeriodType, chartPeriodCount]);

  const annotatorNames = metrics.length > 0
    ? metrics.map((m) => m.annotator)
    : [...new Set(allSnapshots.map((s: any) => s.annotator as string))];

  const chartData = (() => {
    if (!history.length) return [];
    if (chartAnnotator) {
      return history.map((h) => ({
        period: formatPeriodLabel(h.period_start, chartPeriodType),
        [chartAnnotator]: getMetricValue(h, chartMetric),
      }));
    }
    const grouped: Record<string, any> = {};
    for (const h of history) {
      const key = h.period_start;
      if (!grouped[key]) grouped[key] = { period: formatPeriodLabel(h.period_start, chartPeriodType) };
      grouped[key][h.annotator] = getMetricValue(h, chartMetric);
    }
    return Object.values(grouped);
  })();

  const chartLines = chartAnnotator ? [chartAnnotator] : annotatorNames;
  const lineColors = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#f472b6"];

  function formatPeriodLabel(dateStr: string, type: "week" | "month"): string {
    const d = new Date(dateStr + "T00:00:00");
    if (type === "month") return d.toLocaleDateString(undefined, { month: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function getMetricValue(snapshot: any, metric: string): number | null {
    return snapshot[metric] ?? null;
  }

  function formatRate(value: number | null): React.ReactNode {
    if (value === null) return <span className="text-[var(--app-text-subtle)]">—</span>;
    return `${(value * 100).toFixed(1)}%`;
  }

  function applyTimeframe() {
    setChartPeriodCount(tempCount);
    setChartPeriodType(tempUnit);
    setTimeframeOpen(false);
  }

  const timeframeLabel = `Previous ${chartPeriodCount} ${chartPeriodType === "week" ? "weeks" : "months"}`;

  const tableMetrics = (() => {
    const now = new Date();
    let relevantSnapshots: any[];

    if (tablePeriod === "all") {
      relevantSnapshots = allSnapshots;
    } else {
      let targetStart: string;
      let targetEnd: string;

      if (tablePeriod === "this_week") {
        const dayOfWeek = now.getDay();
        const start = new Date(now);
        start.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        targetStart = toDateStr(start);
        targetEnd = toDateStr(now);
      } else if (tablePeriod === "last_week") {
        const dayOfWeek = now.getDay();
        const thisWeekStart = new Date(now);
        thisWeekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(thisWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(thisWeekStart);
        lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
        targetStart = toDateStr(lastWeekStart);
        targetEnd = toDateStr(lastWeekEnd);
      } else if (tablePeriod === "this_month") {
        targetStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        targetEnd = toDateStr(now);
      } else {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        targetStart = toDateStr(lastMonth);
        targetEnd = toDateStr(lastMonthEnd);
      }

      relevantSnapshots = allSnapshots.filter((h) => {
        return h.period_start >= targetStart && h.period_start <= targetEnd;
      });
    }

    if (relevantSnapshots.length === 0) return { data: [], totalsRow: null };

    const byAnnotator = new Map<string, any[]>();
    for (const s of relevantSnapshots) {
      if (!byAnnotator.has(s.annotator)) byAnnotator.set(s.annotator, []);
      byAnnotator.get(s.annotator)!.push(s);
    }

    const data: AnnotatorMetrics[] = [];
    let tAssigned = 0, tCompleted = 0, tItems = 0, tFlagRates: number[] = [], tAttrRates: number[] = [], tLabelRates: number[] = [], tAccRates: number[] = [], tCorrRates: number[] = [];

    for (const [annotator, snapshots] of byAnnotator) {
      const sumField = (f: string) => snapshots.reduce((s: number, r: any) => s + (r[f] || 0), 0);
      const avgField = (f: string) => {
        const vals = snapshots.map((r: any) => r[f]).filter((v: any) => v !== null && v !== undefined) as number[];
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const assigned = sumField("datasets_assigned");
      const completed = sumField("datasets_completed");
      const items = sumField("items_labeled");
      const flagRate = avgField("flag_rate");
      const attrError = avgField("attribute_error");
      const labelError = avgField("label_error");
      const accuracy = avgField("accuracy");
      const correction = avgField("correction");

      tAssigned += assigned; tCompleted += completed; tItems += items;
      if (flagRate !== null) tFlagRates.push(flagRate);
      if (attrError !== null) tAttrRates.push(attrError);
      if (labelError !== null) tLabelRates.push(labelError);
      if (accuracy !== null) tAccRates.push(accuracy);
      if (correction !== null) tCorrRates.push(correction);

      data.push({ annotator, datasets_assigned: assigned, datasets_completed: completed, items_labeled: items, flag_rate: flagRate, attribute_error: attrError, label_error: labelError, accuracy, correction });
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const totalsRow: AnnotatorMetrics = {
      annotator: "Total",
      datasets_assigned: tAssigned, datasets_completed: tCompleted, items_labeled: tItems,
      flag_rate: avg(tFlagRates), attribute_error: avg(tAttrRates), label_error: avg(tLabelRates),
      accuracy: avg(tAccRates), correction: avg(tCorrRates),
    };
    return { data, totalsRow };
  })();

  const sortedTableData = [...tableMetrics.data].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (sortDir === "desc") return (bVal as number) - (aVal as number);
    return (aVal as number) - (bVal as number);
  });

  function handleSort(key: keyof AnnotatorMetrics) {
    if (key === "annotator") return;
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const metricLabel = metricOptions.find((o) => o.value === chartMetric)?.label || chartMetric;
  const periodLabel = chartPeriodType === "week" ? "Week" : "Month";

  return (
    <div className="space-y-6">
      {/* Top bar: Timeframe dropdown + Metric tabs */}
      <div className="flex items-end justify-between gap-4">
        <div className="relative">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--app-text-subtle)] mb-1.5">View Data From</p>
          <button
            className="flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-sm text-[var(--app-text)] hover:border-[var(--app-border-strong)] transition-colors"
            onClick={() => { setTimeframeOpen(!timeframeOpen); setTempCount(chartPeriodCount); setTempUnit(chartPeriodType); }}
          >
            {timeframeLabel}
            <ChevronDown className="h-3.5 w-3.5 text-[var(--app-text-muted)]" />
          </button>
          {timeframeOpen && (
            <div className="absolute top-full left-0 mt-1.5 z-30 w-64 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-lg">
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--app-text-muted)]">Previous</span>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    className="w-14 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-soft)] px-2 py-1 text-sm text-center text-[var(--app-text)] outline-none focus:border-[#5cb8ff]"
                    value={tempCount}
                    onChange={(e) => setTempCount(Math.max(1, Math.min(52, parseInt(e.target.value) || 5)))}
                  />
                  <div className="flex items-center rounded-md border border-[var(--app-border)] overflow-hidden">
                    <button
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${tempUnit === "week" ? "bg-[var(--app-surface-soft)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`}
                      onClick={() => setTempUnit("week")}
                    >
                      weeks
                    </button>
                    <button
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${tempUnit === "month" ? "bg-[var(--app-surface-soft)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`}
                      onClick={() => setTempUnit("month")}
                    >
                      months
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--app-text-subtle)]">Includes the current {tempUnit}.</p>
                <div className="flex justify-end">
                  <button
                    className="app-btn app-btn-primary app-btn-sm text-xs"
                    onClick={applyTimeframe}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 border-b border-[var(--app-border)]">
          {metricOptions.map((o) => (
            <button
              key={o.value}
              className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                chartMetric === o.value ? "text-[#5cb8ff]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
              }`}
              onClick={() => setChartMetric(o.value)}
            >
              {o.label}
              {chartMetric === o.value && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#5cb8ff] rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Section */}
      <div className="app-card">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">
            {metricLabel} by {periodLabel}
          </h3>
          <div className="flex items-center gap-3">
            <select
              className="app-select px-2 py-1 text-xs"
              value={chartAnnotator}
              onChange={(e) => setChartAnnotator(e.target.value)}
            >
              <option value="">All Annotators</option>
              {annotatorNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <div className="flex items-center rounded-md border border-[var(--app-border)]">
              <button
                className={`px-2 py-1.5 rounded-l-md transition-colors ${chartType === "line" ? "bg-[var(--app-surface-soft)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`}
                onClick={() => setChartType("line")}
                title="Line chart"
              >
                <TrendingUp className="h-3.5 w-3.5" />
              </button>
              <button
                className={`px-2 py-1.5 rounded-r-md transition-colors ${chartType === "bar" ? "bg-[var(--app-surface-soft)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`}
                onClick={() => setChartType("bar")}
                title="Bar chart"
              >
                <BarChart3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="h-[280px] w-full px-3 py-4">
          {historyLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[var(--app-text-muted)]">Loading chart data...</p>
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[var(--app-text-muted)]">No historical data available. Run the seed script to populate metrics history.</p>
            </div>
          ) : (
            <MetricsChart
              data={chartData}
              lines={chartLines}
              colors={lineColors}
              chartType={chartType}
              metricKey={chartMetric}
              isRate={!["datasets_assigned", "datasets_completed", "items_labeled"].includes(chartMetric)}
              showLabels={!!chartAnnotator}
            />
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="app-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Performance by Annotator</h3>
          <div className="flex items-center rounded-md border border-[var(--app-border)] overflow-hidden">
            {([
              { value: "all", label: "All Time" },
              { value: "this_week", label: "This Week" },
              { value: "last_week", label: "Last Week" },
              { value: "this_month", label: "This Month" },
              { value: "last_month", label: "Last Month" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  tablePeriod === opt.value ? "bg-[var(--app-surface-soft)] text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                }`}
                onClick={() => setTablePeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-[var(--app-text-muted)]">Loading...</p>
          ) : tableMetrics.data.length === 0 ? (
            <p className="text-sm text-[var(--app-text-muted)]">
              No data available for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--app-border)]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--app-text-subtle)]">Annotator</th>
                    {([
                      { key: "datasets_assigned", label: "Assigned", tip: "Datasets assigned to this annotator." },
                      { key: "datasets_completed", label: "Completed", tip: "Datasets that reached approved or finalized status." },
                      { key: "items_labeled", label: "Items", tip: "Images labeled across assigned datasets." },
                      { key: "flag_rate", label: "Flag Rate", tip: "Review flags (open + resolved) as a percentage of items labeled." },
                      { key: "attribute_error", label: "Attr Match", tip: "Percentage of reference attributes correctly matched by the annotator." },
                      { key: "label_error", label: "Label Match", tip: "Percentage of labels matching the finalized dataset ground truth." },
                      { key: "accuracy", label: "Accuracy", tip: "Combined correctness: (correct labels + correct attributes) / total compared." },
                      { key: "correction", label: "Correction", tip: "Proportion requiring correction: 1 − accuracy." },
                    ] as { key: keyof AnnotatorMetrics; label: string; tip: string }[]).map((col) => (
                      <th
                        key={col.key}
                        className="px-3 py-2 text-right text-xs font-medium text-[var(--app-text-subtle)] cursor-pointer select-none hover:text-[var(--app-text)]"
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && <span className="text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>}
                          <InfoTip align="right">{col.tip}</InfoTip>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTableData.map((m) => (
                    <tr key={m.annotator} className="border-b border-[var(--app-border)] hover:bg-[var(--app-table-row-hover)]">
                      <td className="px-3 py-2.5 font-medium text-[var(--app-text)]">{m.annotator}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{m.datasets_assigned}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{m.datasets_completed}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{m.items_labeled}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(m.flag_rate)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(m.attribute_error)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(m.label_error)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(m.accuracy)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(m.correction)}</td>
                    </tr>
                  ))}
                  {tableMetrics.totalsRow && (
                    <tr className="border-t-2 border-[var(--app-border)] bg-[var(--app-surface-soft)]">
                      <td className="px-3 py-2.5 font-semibold text-[var(--app-text)]">Total</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{tableMetrics.totalsRow.datasets_assigned}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{tableMetrics.totalsRow.datasets_completed}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{tableMetrics.totalsRow.items_labeled}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{formatRate(tableMetrics.totalsRow.flag_rate)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{formatRate(tableMetrics.totalsRow.attribute_error)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{formatRate(tableMetrics.totalsRow.label_error)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{formatRate(tableMetrics.totalsRow.accuracy)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[var(--app-text-muted)]">{formatRate(tableMetrics.totalsRow.correction)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* FinalizedView removed — finalized datasets accessed via Saved Datasets tab */