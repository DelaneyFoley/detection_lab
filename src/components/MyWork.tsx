"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Detection, ReviewFlag, AnnotatorMetrics, DatasetMetric } from "@/types";
import { useAppFeedback } from "@/components/shared/AppFeedbackProvider";
import { ImagePreviewModal } from "@/components/shared/ImagePreviewModal";
import { AttributePills } from "@/components/shared/AttributePills";
import { InfoTip } from "@/components/shared/InfoTip";
import { useAppStore } from "@/lib/store";
import FlagsQueue from "@/components/shared/FlagsQueue";
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  QA_STATUS_ORDER,
  isReadOnlyStatus,
} from "@/lib/statusConstants";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Flag,
  ArrowLeft,
  Lock,
  Inbox,
  Clock,
  CircleCheckBig,
  BarChart3,
  LayoutGrid,
  ClipboardList,
  TrendingUp,
  Filter,
  Send,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";
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
  LabelList,
} from "recharts";

interface MyWorkDataset {
  dataset_id: string;
  name: string;
  detection_id: string | null;
  split_type: string;
  size: number;
  qa_status: string;
  assigned_to: string | null;
  items_labeled: number;
  revision_note: string | null;
  updated_at: string;
  assigned_at: string | null;
  segment_taxonomy?: string | string[] | null;
}

interface DatasetItemRow {
  item_id: string;
  image_id: string;
  image_uri: string;
  image_description: string;
  segment_tags: string[];
  ground_truth_label: "DETECTED" | "NOT_DETECTED" | null;
}

type FilterTab = "all" | "assigned" | "needs_revision" | "in_progress" | "submitted" | "done";

const FILTER_TABS: { id: FilterTab; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All", icon: <LayoutGrid className="h-4 w-4" /> },
  { id: "assigned", label: "Assigned", icon: <Inbox className="h-4 w-4" /> },
  { id: "needs_revision", label: "Needs Revision", icon: <AlertTriangle className="h-4 w-4" /> },
  { id: "in_progress", label: "In Progress", icon: <Clock className="h-4 w-4" /> },
  { id: "submitted", label: "Submitted", icon: <Send className="h-4 w-4" /> },
  { id: "done", label: "Done", icon: <CheckCheck className="h-4 w-4" /> },
];

type SubView = "datasets" | "flags" | "performance";

const SUB_TABS: { id: SubView; label: string; icon: React.ReactNode }[] = [
  { id: "datasets", label: "My Datasets", icon: <LayoutGrid className="h-4 w-4" /> },
  { id: "flags", label: "Flags", icon: <Flag className="h-4 w-4" /> },
  { id: "performance", label: "Performance Metrics", icon: <TrendingUp className="h-4 w-4" /> },
];

const ANNOTATOR_STATUS_ORDER: Record<string, number> = {
  assigned: 0,
  needs_revision: 1,
  in_annotation: 2,
  submitted: 3,
  in_qa: 4,
  approved: 5,
  finalized: 6,
  archived: 7,
};

// ─── Flag Modal ──────────────────────────────────────────────────────────────

function FlagModal({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="app-card-strong p-6 w-full max-w-md space-y-4">
        <h3 className="text-sm font-semibold text-white">Flag for Secondary Review</h3>
        <p className="text-xs text-gray-400">
          What is your question or concern about this image?
        </p>
        <textarea
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm h-24"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g., Unsure if this qualifies as detected — looks borderline..."
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="app-btn app-btn-subtle app-btn-sm text-xs">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={!reason.trim()}
            className="app-btn app-btn-primary app-btn-sm text-xs disabled:opacity-40"
          >
            Submit Flag
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QA Report Card ──────────────────────────────────────────────────────────

// ─── QA Report Card ──────────────────────────────────────────────────────────

function QaReportCard({ datasetId }: { datasetId: string }) {
  const [stats, setStats] = useState<{ total: number; reviewed: number; correct: number; incorrect: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/qa?action=samples&dataset_id=${datasetId}`)
      .then((r) => r.json())
      .then((data) => {
        setStats(data.stats || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [datasetId]);

  if (loading) return null;
  if (!stats || stats.total === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
        <p className="text-xs text-emerald-300">No QA samples were generated for this dataset.</p>
      </div>
    );
  }

  const acceptRate = stats.reviewed > 0 ? Math.round((stats.correct / stats.reviewed) * 100) : 0;

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
      <h4 className="text-xs font-medium text-emerald-300 mb-2">QA Review Summary</h4>
      <div className="flex items-center gap-6 text-xs">
        <div>
          <span className="text-[var(--app-text-muted)]">Samples reviewed: </span>
          <span className="text-[var(--app-text)]">{stats.reviewed}/{stats.total}</span>
        </div>
        <div>
          <span className="text-[var(--app-text-muted)]">Acceptance rate: </span>
          <span className="text-[var(--app-text)]">{acceptRate}%</span>
        </div>
        <div>
          <span className="text-[var(--app-text-muted)]">Corrections made: </span>
          <span className="text-[var(--app-text)]">{stats.incorrect}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Dataset List View ──────────────────────────────────────────────────────

interface CorrectionEntry {
  parentLabel: string;
  parentTags: string[];
  childLabel: string;
  childTags: string[];
}

function DatasetListView({
  dataset,
  items,
  detection,
  readOnly,
  corrections,
  flags,
  onBack,
  onSelectImage,
}: {
  dataset: MyWorkDataset;
  items: DatasetItemRow[];
  detection: Detection | null;
  readOnly: boolean;
  corrections: Map<string, CorrectionEntry> | null;
  flags: Record<string, { reason: string }>;
  onBack: () => void;
  onSelectImage: (index: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const isArchived = dataset.qa_status === "archived";

  const [qaFeedbackExpanded, setQaFeedbackExpanded] = useState(true);
  const [qaSamples, setQaSamples] = useState<any[]>([]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
  const [qaPreviewIndex, setQaPreviewIndex] = useState<number | null>(null);

  const needsRevision = dataset.qa_status === "needs_revision";
  const reviewedSamples = qaSamples.filter((s: any) => s.status === "reviewed");
  const allAcknowledged = !needsRevision || reviewedSamples.length === 0
    || reviewedSamples.every((s: any) => acknowledgedIds.has(s.sample_id));
  const annotationBlocked = needsRevision && !allAcknowledged;

  useEffect(() => {
    if (dataset.qa_status !== "needs_revision") return;
    fetch(`/api/qa?action=samples&dataset_id=${dataset.dataset_id}`)
      .then(r => r.json())
      .then(data => setQaSamples(data.samples || []))
      .catch(() => {});
  }, [dataset.dataset_id, dataset.qa_status]);

  const labeledCount = items.filter((i) => i.ground_truth_label !== null).length;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = items.slice((page - 1) * pageSize, page * pageSize);

  const correctionCount = corrections?.size ?? 0;

  // Accuracy uses the same per-decision formula as the Performance Metrics tab:
  // (correct label decisions + correct attribute decisions) ÷ (images × (1 + taxonomy size)).
  // Each image contributes one label decision plus one apply/omit decision per
  // attribute in the detection's taxonomy; correct applications AND correct
  // omissions (true negatives) both count.
  const accuracy = useMemo(() => {
    if (items.length === 0) return "—";
    const taxonomy: string[] = Array.isArray(detection?.segment_taxonomy) ? detection!.segment_taxonomy : [];
    const perImage = 1 + taxonomy.length;
    let correct = 0;
    for (const item of items) {
      const corr = corrections?.get(item.image_id);
      if (!corr) {
        // Accepted — annotator matched the master on the label and every attribute.
        correct += perImage;
        continue;
      }
      if (corr.childLabel === corr.parentLabel) correct += 1;
      const childSet = new Set(corr.childTags || []);
      const parentSet = new Set(corr.parentTags || []);
      for (const attr of taxonomy) {
        if (childSet.has(attr) === parentSet.has(attr)) correct += 1;
      }
    }
    const total = items.length * perImage;
    return total > 0 ? ((correct / total) * 100).toFixed(1) : "—";
  }, [items, corrections, detection]);

  const correctionBreakdown = useMemo(() => {
    if (!corrections || corrections.size === 0) return { labelChanges: 0, attrChanges: 0 };
    let labelChanges = 0;
    let attrChanges = 0;
    for (const c of corrections.values()) {
      if (c.childLabel !== c.parentLabel) labelChanges++;
      const childSet = new Set(c.childTags || []);
      const parentSet = new Set(c.parentTags || []);
      const tagsMatch = childSet.size === parentSet.size && [...childSet].every((t) => parentSet.has(t));
      if (!tagsMatch) attrChanges++;
    }
    return { labelChanges, attrChanges };
  }, [corrections]);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to datasets
      </button>

      {dataset.qa_status === "needs_revision" && dataset.revision_note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="text-xs font-semibold text-amber-300 mb-1">Revision Guidance</div>
          <div className="text-sm text-amber-100/90">{dataset.revision_note}</div>
        </div>
      )}

      {needsRevision && reviewedSamples.length > 0 && (
        <div className="app-card overflow-hidden">
          <button
            onClick={() => setQaFeedbackExpanded(!qaFeedbackExpanded)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
          >
            {qaFeedbackExpanded ? <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronUp className="h-4 w-4 text-[var(--app-text-subtle)]" />}
            <span className="text-sm font-medium text-[var(--app-text)]">QA Feedback</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              {acknowledgedIds.size}/{reviewedSamples.length} acknowledged
            </span>
            {!allAcknowledged && (
              <span className="ml-auto text-[10px] text-red-300">Must acknowledge all before annotating</span>
            )}
          </button>

          {qaFeedbackExpanded && (
            <div className="border-t border-[var(--app-border)]">
              <div className="max-h-[400px] overflow-y-auto divide-y divide-[var(--app-border)]">
                {reviewedSamples.map((sample: any, sIdx: number) => (
                  <div key={sample.sample_id} className="flex items-center gap-4 px-4 py-3">
                    {sample.image_uri && (
                      <img
                        src={sample.image_uri}
                        alt={sample.image_id || ""}
                        onClick={() => setQaPreviewIndex(sIdx)}
                        className="h-10 w-14 rounded object-cover border border-[var(--app-border)] shrink-0 cursor-pointer hover:ring-2 hover:ring-sky-400/50"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">
                        {sample.image_id || sample.item_id}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px]">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${
                          sample.outcome === "accepted"
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-amber-500/10 text-amber-300"
                        }`}>
                          {sample.outcome?.replace(/_/g, " ") || "reviewed"}
                        </span>
                        {sample.note && (
                          <span className="text-[var(--app-text-muted)] truncate">{sample.note}</span>
                        )}
                      </div>
                    </div>
                    {acknowledgedIds.has(sample.sample_id) ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <button
                        onClick={() => setAcknowledgedIds(prev => new Set([...prev, sample.sample_id]))}
                        className="app-btn app-btn-subtle app-btn-sm text-xs shrink-0"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {qaPreviewIndex !== null && reviewedSamples[qaPreviewIndex] && (() => {
            const s = reviewedSamples[qaPreviewIndex];
            const originalTags: string[] = s.original_tags ? (typeof s.original_tags === "string" ? JSON.parse(s.original_tags) : s.original_tags) : [];
            const correctedTags: string[] = s.corrected_tags ? (typeof s.corrected_tags === "string" ? JSON.parse(s.corrected_tags) : s.corrected_tags) : [];
            const currentTags: string[] = s.segment_tags ? (typeof s.segment_tags === "string" ? JSON.parse(s.segment_tags) : s.segment_tags) : [];
            const displayTags = correctedTags.length > 0 ? correctedTags : currentTags;
            const addedTags = originalTags.length > 0 ? displayTags.filter((t: string) => !originalTags.includes(t)) : [];
            const removedTags = originalTags.length > 0 ? originalTags.filter((t: string) => !displayTags.includes(t)) : [];
            const labelChanged = s.original_label && s.corrected_label && s.original_label !== s.corrected_label;

            return (
              <ImagePreviewModal
                isOpen
                imageUrl={s.image_uri || ""}
                imageAlt={s.image_id || ""}
                title={s.image_id || s.item_id}
                subtitle="QA Review"
                index={qaPreviewIndex}
                total={reviewedSamples.length}
                onClose={() => setQaPreviewIndex(null)}
                onPrev={qaPreviewIndex > 0 ? () => setQaPreviewIndex(qaPreviewIndex - 1) : undefined}
                onNext={qaPreviewIndex < reviewedSamples.length - 1 ? () => setQaPreviewIndex(qaPreviewIndex + 1) : undefined}
                details={
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--app-text-muted)]">Outcome:</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        s.outcome === "accepted"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-amber-500/10 text-amber-300"
                      }`}>
                        {s.outcome?.replace(/_/g, " ") || "reviewed"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--app-text-muted)]">Ground Truth:</span>
                      <span className="text-xs font-medium text-[var(--app-text)]">
                        {s.corrected_label || s.ground_truth_label || "—"}
                      </span>
                    </div>

                    {displayTags.length > 0 && (
                      <div>
                        <span className="text-xs text-[var(--app-text-muted)]">Attributes:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {displayTags.map((tag: string) => (
                            <span key={tag} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {s.outcome !== "accepted" && (labelChanged || addedTags.length > 0 || removedTags.length > 0) && (
                      <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 space-y-1.5">
                        <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wide">Corrections</span>
                        {labelChanged && (
                          <p className="text-xs text-[var(--app-text)]">
                            Label changed: <span className="line-through text-red-300">{s.original_label}</span>
                            {" → "}
                            <span className="text-emerald-300">{s.corrected_label}</span>
                          </p>
                        )}
                        {addedTags.length > 0 && (
                          <p className="text-xs text-[var(--app-text)]">
                            Added: {addedTags.map((t: string) => (
                              <span key={t} className="inline-block rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-300 mr-1">{t}</span>
                            ))}
                          </p>
                        )}
                        {removedTags.length > 0 && (
                          <p className="text-xs text-[var(--app-text)]">
                            Removed: {removedTags.map((t: string) => (
                              <span key={t} className="inline-block rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-300 line-through mr-1">{t}</span>
                            ))}
                          </p>
                        )}
                      </div>
                    )}

                    {s.note && (
                      <div>
                        <span className="text-xs text-[var(--app-text-muted)]">Reviewer Note:</span>
                        <p className="mt-1 text-sm text-[var(--app-text)]">{s.note}</p>
                      </div>
                    )}

                    {!acknowledgedIds.has(s.sample_id) ? (
                      <button
                        onClick={() => setAcknowledgedIds(prev => new Set([...prev, s.sample_id]))}
                        className="app-btn app-btn-primary app-btn-sm text-xs w-full"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged
                      </div>
                    )}
                  </div>
                }
              />
            );
          })()}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--app-text)]">{dataset.name}</h3>
        <div className="flex items-center gap-3">
          {readOnly && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
              <Lock className="h-3 w-3" /> Read Only
            </span>
          )}
          <span className={`app-badge ${STATUS_BADGE_CLASSES[dataset.qa_status] || STATUS_BADGE_CLASSES.draft}`}>
            {STATUS_LABELS[dataset.qa_status] || dataset.qa_status}
          </span>
          <span className="text-xs text-[var(--app-text-muted)]">
            {labeledCount}/{items.length} labeled
          </span>
        </div>
      </div>

      {isArchived && corrections && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Accuracy</div>
            <div className="text-xl font-semibold text-emerald-300">{accuracy}%</div>
          </div>
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Total Items</div>
            <div className="text-xl font-semibold text-[var(--app-text)]">{items.length}</div>
          </div>
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Accepted</div>
            <div className="text-xl font-semibold text-emerald-300">{items.length - correctionCount}</div>
          </div>
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Corrected</div>
            <div className="text-xl font-semibold text-amber-300">{correctionCount}</div>
          </div>
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Label Changes</div>
            <div className="text-xl font-semibold text-red-300">{correctionBreakdown.labelChanges}</div>
          </div>
          <div className="app-card p-3 text-center">
            <div className="text-xs text-[var(--app-text-muted)] mb-1">Attribute Changes</div>
            <div className="text-xl font-semibold text-sky-300">{correctionBreakdown.attrChanges}</div>
          </div>
        </div>
      )}

      {annotationBlocked && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-red-300" />
          <span className="text-xs text-red-200">
            Acknowledge all QA feedback items above before continuing annotation.
          </span>
        </div>
      )}

      <div className="app-card overflow-hidden">
        <div className="app-table-wrap max-h-[520px] overflow-auto">
          <table className="app-table app-table-fixed text-xs">
            <colgroup>
              <col style={{ width: "9rem" }} />
              <col style={{ width: "10rem" }} />
              <col style={{ width: "8rem" }} />
              <col />
              <col style={{ width: "3.5rem" }} />
              <col style={{ width: "14rem" }} />
              {isArchived && corrections && <col style={{ width: "10rem" }} />}
            </colgroup>
            <thead className="sticky top-0">
              <tr>
                <th className="app-table-col-label">Preview</th>
                <th className="app-table-col-label">Image ID</th>
                <th className="app-table-col-center">Ground Truth Label</th>
                <th className="app-table-col-label">Attributes</th>
                <th className="app-table-col-center">Flag</th>
                <th className="app-table-col-label">Note</th>
                {isArchived && corrections && <th className="app-table-col-center">Outcome</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((item, idx) => {
                const globalIndex = (page - 1) * pageSize + idx;
                const correction = corrections?.get(item.image_id);
                return (
                  <tr
                    key={item.item_id}
                    onClick={() => !annotationBlocked && onSelectImage(globalIndex)}
                    className={`border-t border-white/5 ${
                      annotationBlocked
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer hover:bg-[rgba(92,184,255,0.06)]"
                    } ${correction ? "bg-amber-500/5" : ""}`}
                  >
                    <td>
                      <img
                        src={item.image_uri}
                        alt={item.image_id}
                        className="block h-16 w-24 min-w-24 max-w-24 object-cover rounded border border-gray-700"
                      />
                    </td>
                    <td>
                      <div className="text-xs font-mono text-gray-300 truncate">{item.image_id}</div>
                    </td>
                    <td className="app-table-col-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
                        item.ground_truth_label === "DETECTED"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : item.ground_truth_label === "NOT_DETECTED"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {item.ground_truth_label || "UNSET"}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(item.segment_tags || []).map((tag, i) => (
                          <span key={i} className="inline-block rounded bg-[rgba(92,184,255,0.1)] px-1.5 py-0.5 text-[10px] text-[var(--app-text-muted)]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="app-table-col-center">
                      {flags[item.item_id] ? (
                        <span title={flags[item.item_id].reason}>
                          <Flag className="h-3.5 w-3.5 text-amber-400 inline" />
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500">—</span>
                      )}
                    </td>
                    <td>
                      {item.image_description ? (
                        <span className="text-[10px] text-gray-300 line-clamp-2" title={item.image_description}>
                          {item.image_description}
                        </span>
                      ) : flags[item.item_id] ? (
                        <span className="text-[10px] text-amber-300/80 line-clamp-2" title={flags[item.item_id].reason}>
                          {flags[item.item_id].reason}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-500">—</span>
                      )}
                    </td>
                    {isArchived && corrections && (
                      <td className="app-table-col-center">
                        {correction ? (() => {
                          const labelChanged = correction.childLabel !== correction.parentLabel;
                          const childSet = new Set(correction.childTags || []);
                          const parentSet = new Set(correction.parentTags || []);
                          const added = [...parentSet].filter((t) => !childSet.has(t));
                          const removed = [...childSet].filter((t) => !parentSet.has(t));
                          return (
                            <div className="space-y-0.5 text-left">
                              {labelChanged && (
                                <div className="text-[10px]">
                                  <span className="line-through text-red-300">{correction.childLabel}</span>
                                  {" → "}
                                  <span className="text-emerald-300">{correction.parentLabel}</span>
                                </div>
                              )}
                              {added.length > 0 && (
                                <div className="flex flex-wrap gap-0.5">
                                  {added.map((t) => (
                                    <span key={t} className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] text-emerald-300">+{t}</span>
                                  ))}
                                </div>
                              )}
                              {removed.length > 0 && (
                                <div className="flex flex-wrap gap-0.5">
                                  {removed.map((t) => (
                                    <span key={t} className="rounded bg-red-500/10 px-1 py-0.5 text-[9px] text-red-300 line-through">−{t}</span>
                                  ))}
                                </div>
                              )}
                              {!labelChanged && added.length === 0 && removed.length === 0 && (
                                <span className="text-[10px] text-amber-300">corrected</span>
                              )}
                            </div>
                          );
                        })() : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 inline" />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={isArchived && corrections ? 7 : 6} className="px-2 py-8 text-center text-gray-500">
                    No images in this dataset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {items.length > 0 && (
          <div className="flex items-center justify-between border-t border-[var(--app-border)] px-4 py-2">
            <select
              className="app-select py-0.5 text-[10px]"
              style={{ width: "70px" }}
              value={pageSize}
              onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
            >
              <option value="10">10 / page</option>
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                >Prev</button>
                <span className="text-[11px] text-[var(--app-text-muted)] px-2 tabular-nums">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                >Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Annotation View ─────────────────────────────────────────────────────────

function AnnotationView({
  dataset,
  items: initialItems,
  detection,
  readOnly,
  showReportCard,
  onBack,
  onRefresh,
  onItemsChange,
  initialIndex = 0,
  corrections: correctionMap,
}: {
  dataset: MyWorkDataset;
  items: DatasetItemRow[];
  detection: Detection | null;
  readOnly: boolean;
  showReportCard: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onItemsChange?: (items: DatasetItemRow[]) => void;
  initialIndex?: number;
  corrections?: Map<string, CorrectionEntry> | null;
}) {
  const [items, setItems] = useState<DatasetItemRow[]>(initialItems);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [copiedImageId, setCopiedImageId] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);

  const [flaggedItemIds, setFlaggedItemIds] = useState<Set<string>>(new Set());
  const [flagsByItemId, setFlagsByItemId] = useState<Record<string, ReviewFlag>>({});
  const [resolvedFlagsByItemId, setResolvedFlagsByItemId] = useState<Record<string, ReviewFlag[]>>({});
  const [flagModalItemId, setFlagModalItemId] = useState<string | null>(null);
  const [cancelConfirmFlagId, setCancelConfirmFlagId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const { notify } = useAppFeedback();

  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    setItems(initialItems);
  }, [initialItems]);

  const noteRef = useRef(note);
  const noteDirtyRef = useRef(noteDirty);
  const currentItemRef = useRef<DatasetItemRow | null>(null);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { noteDirtyRef.current = noteDirty; }, [noteDirty]);

  useEffect(() => {
    return () => {
      if (noteDirtyRef.current && currentItemRef.current) {
        fetch("/api/datasets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "bulk_update_items",
            dataset_id: dataset.dataset_id,
            items: [{ item_id: currentItemRef.current.item_id, image_description: noteRef.current.trim() }],
          }),
          keepalive: true,
        });
      }
    };
  }, [dataset.dataset_id]);

  useEffect(() => {
    fetch(`/api/review-flags?dataset_id=${dataset.dataset_id}`)
      .then((r) => r.json())
      .then((data) => {
        const flags: ReviewFlag[] = data.flags || [];
        const openFlags = flags.filter((f) => f.status === "open");
        const resolvedFlags = flags.filter((f) => f.status === "resolved");
        setFlaggedItemIds(new Set(openFlags.map((f) => f.dataset_item_id!).filter(Boolean)));
        const byItemId: Record<string, ReviewFlag> = {};
        for (const f of openFlags) {
          if (f.dataset_item_id) byItemId[f.dataset_item_id] = f;
        }
        setFlagsByItemId(byItemId);
        const resolvedByItemId: Record<string, ReviewFlag[]> = {};
        for (const f of resolvedFlags) {
          if (f.dataset_item_id) {
            if (!resolvedByItemId[f.dataset_item_id]) resolvedByItemId[f.dataset_item_id] = [];
            resolvedByItemId[f.dataset_item_id].push(f);
          }
        }
        setResolvedFlagsByItemId(resolvedByItemId);
      });
  }, [dataset.dataset_id]);

  const currentItem = items[currentIndex] || null;
  useEffect(() => { currentItemRef.current = currentItem; }, [currentItem]);
  const currentCorrection = currentItem ? correctionMap?.get(currentItem.image_id) ?? null : null;
  // Attribute options come from the assigned detection's taxonomy. When a dataset
  // has no detection (e.g. the bundled/unassigned datasets), fall back to the
  // dataset's own attribute taxonomy so labelers still see the attribute list.
  const segmentOptions = useMemo<string[]>(() => {
    const fromDetection = detection?.segment_taxonomy;
    if (Array.isArray(fromDetection) && fromDetection.length > 0) return fromDetection;
    const raw = dataset.segment_taxonomy;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [detection?.segment_taxonomy, dataset.segment_taxonomy]);
  const labeledCount = items.filter((i) => i.ground_truth_label !== null).length;

  const resetZoom = useCallback(() => {
    setImageZoom(1);
    setImagePan({ x: 0, y: 0 });
  }, []);

  const goToIndex = useCallback((idx: number) => {
    if (idx >= 0 && idx < items.length) {
      if (noteDirty && currentItem) {
        fetch("/api/datasets", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "bulk_update_items",
            dataset_id: dataset.dataset_id,
            items: [{ item_id: currentItem.item_id, image_description: note.trim() }],
          }),
          keepalive: true,
        });
        const updated = items.map((i) => (i.item_id === currentItem.item_id ? { ...i, image_description: note.trim() } : i));
        setItems(updated);
        skipSyncRef.current = true;
        onItemsChange?.(updated);
        setNoteDirty(false);
      }
      setCurrentIndex(idx);
      setImageZoom(1);
      setImagePan({ x: 0, y: 0 });
    }
  }, [items, noteDirty, currentItem, note, dataset.dataset_id, onItemsChange]);

  // Sync note with current item
  useEffect(() => {
    if (currentItem) {
      setNote(currentItem.image_description || "");
      setNoteDirty(false);
    }
  }, [currentItem?.item_id]);

  const saveNote = useCallback(async () => {
    if (!noteDirty || !currentItem) return;
    setNoteDirty(false);
    await fetch("/api/datasets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "bulk_update_items",
        dataset_id: dataset.dataset_id,
        items: [{ item_id: currentItem.item_id, image_description: note.trim() }],
      }),
    });
    const updated = items.map((i) => (i.item_id === currentItem.item_id ? { ...i, image_description: note.trim() } : i));
    setItems(updated);
    skipSyncRef.current = true;
    onItemsChange?.(updated);
  }, [noteDirty, currentItem, note, dataset.dataset_id, items, onItemsChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "ArrowRight") goToIndex(currentIndex + 1);
    if (e.key === "ArrowLeft") goToIndex(currentIndex - 1);
  };

  const saveItem = useCallback(async (itemId: string, label: "DETECTED" | "NOT_DETECTED" | null, tags: string[]) => {
    setSaving(true);
    try {
      await fetch("/api/datasets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_update_items",
          dataset_id: dataset.dataset_id,
          items: [{ item_id: itemId, ground_truth_label: label, segment_tags: tags }],
        }),
      });
      const updated = items.map((i) => (i.item_id === itemId ? { ...i, ground_truth_label: label, segment_tags: tags } : i));
      setItems(updated);
      skipSyncRef.current = true;
      onItemsChange?.(updated);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }, [dataset.dataset_id, onRefresh, items, onItemsChange]);

  const handleLabelChange = (label: "DETECTED" | "NOT_DETECTED" | null) => {
    if (readOnly || !currentItem) return;
    saveItem(currentItem.item_id, label, currentItem.segment_tags);
  };

  const handleTagToggle = (tag: string) => {
    if (readOnly || !currentItem) return;
    const nextTags = currentItem.segment_tags.includes(tag)
      ? currentItem.segment_tags.filter((t) => t !== tag)
      : [...currentItem.segment_tags, tag];
    saveItem(currentItem.item_id, currentItem.ground_truth_label, nextTags);
  };

  const createFlag = async (itemId: string, reason: string) => {
    const item = items.find((i) => i.item_id === itemId);
    if (!item) return;
    const res = await fetch("/api/review-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_item_id: itemId,
        detection_id: detection?.detection_id || dataset.detection_id || "",
        image_id: item.image_id,
        reason,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      setFlaggedItemIds((prev) => new Set([...prev, itemId]));
      setFlagsByItemId((prev) => ({
        ...prev,
        [itemId]: {
          flag_id: json.flag_id,
          prediction_id: null,
          dataset_item_id: itemId,
          detection_id: detection?.detection_id || dataset.detection_id || "",
          image_id: item.image_id,
          reason,
          status: "open",
          resolution_action: null,
          resolution_note: null,
          created_at: new Date().toISOString(),
          resolved_at: null,
        },
      }));
    }
    setFlagModalItemId(null);
  };

  const cancelFlag = async (flagId: string) => {
    const res = await fetch(`/api/review-flags?flag_id=${flagId}`, { method: "DELETE" });
    if (res.ok) {
      const flag = Object.values(flagsByItemId).find((f) => f.flag_id === flagId);
      if (flag?.dataset_item_id) {
        setFlaggedItemIds((prev) => {
          const next = new Set(prev);
          next.delete(flag.dataset_item_id!);
          return next;
        });
        setFlagsByItemId((prev) => {
          const next = { ...prev };
          delete next[flag.dataset_item_id!];
          return next;
        });
      }
    }
    setCancelConfirmFlagId(null);
  };

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/qa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          dataset_id: dataset.dataset_id,
          new_status: "submitted",
          actor: dataset.assigned_to || "annotator",
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        notify({ message: err.error || "Failed to submit", tone: "error" });
      } else {
        notify({ message: "Dataset submitted for review", tone: "success" });
        onRefresh();
        onBack();
      }
    } catch {
      notify({ message: "Network error", tone: "error" });
    } finally {
      setSubmitting(false);
      setShowSubmitConfirm(false);
    }
  };

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (imageZoom <= 1) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: imagePan.x, panY: imagePan.y };
    setDragging(true);
  };

  const moveDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !dragging) return;
    setImagePan({
      x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
    });
  };

  const endDrag = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const copyImageId = async () => {
    if (!currentItem) return;
    try {
      await navigator.clipboard.writeText(currentItem.image_id);
      setCopiedImageId(true);
      setTimeout(() => setCopiedImageId(false), 1200);
    } catch { /* no-op */ }
  };

  if (!currentItem) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
          <ArrowLeft className="h-4 w-4" /> Back to datasets
        </button>
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--app-text-muted)]">This dataset has no items.</p>
        </div>
      </div>
    );
  }

  const pct = items.length > 0 ? Math.round((labeledCount / items.length) * 100) : 0;
  const isFlagged = flaggedItemIds.has(currentItem.item_id);
  const currentFlag = flagsByItemId[currentItem.item_id];
  const resolvedFlags = resolvedFlagsByItemId[currentItem.item_id] || [];

  return (
    <div className="mx-auto max-w-7xl space-y-6" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header */}
      <div className="space-y-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-[var(--app-text)]">{dataset.name}</h2>
            <p className="mt-1 text-sm text-[var(--app-text-muted)]">
              {detection?.display_name || "Unassigned"} &middot; {labeledCount}/{items.length} labeled ({pct}%)
            </p>
          </div>
          {readOnly && (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              <Lock className="h-3 w-3" /> Read Only
            </span>
          )}
          {!readOnly && pct === 100 && (
            <button
              onClick={() => setShowSubmitConfirm(true)}
              disabled={submitting}
              className="app-btn app-btn-primary px-4 py-2 text-sm flex items-center gap-2"
            >
              <Send className="h-3.5 w-3.5" />
              Submit for Review
            </button>
          )}
          {saving && <span className="text-[11px] text-[var(--app-text-muted)]">Saving...</span>}
        </div>
      </div>

      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-card-strong p-6 w-full max-w-md space-y-4">
            <h3 className="text-sm font-semibold text-white">Submit Dataset for Review?</h3>
            <p className="text-xs text-gray-400">
              All {items.length} items have been labeled. Once submitted, you won&apos;t be able to make changes until a manager reviews and returns the dataset.
            </p>
            {Object.keys(flagsByItemId).length > 0 && (
              <p className="text-xs text-amber-400">
                Note: {Object.keys(flagsByItemId).length} item(s) are flagged for secondary review. These will be reviewed by a manager after submission.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSubmitConfirm(false)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                Cancel
              </button>
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="app-btn app-btn-primary app-btn-sm text-xs flex items-center gap-1.5"
              >
                <Send className="h-3 w-3" />
                {submitting ? "Submitting..." : "Confirm Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReportCard && <QaReportCard datasetId={dataset.dataset_id} />}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Left: Image panel */}
        <div className="app-card-strong p-4">
          <div className="flex justify-between items-start gap-3 mb-3">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-xs text-gray-500 truncate" title={`${currentIndex + 1} / ${items.length} — ${currentItem.image_id}`}>
                {currentIndex + 1} / {items.length} — {currentItem.image_id}
              </span>
              <button onClick={copyImageId} className="app-btn app-btn-subtle app-btn-sm shrink-0 text-xs" title="Copy image ID">
                {copiedImageId ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap justify-end max-w-[420px]">
              <button onClick={() => setImageZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))} className="app-btn app-btn-subtle app-btn-sm text-xs" disabled={imageZoom <= 1}>Zoom -</button>
              <button onClick={() => setImageZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))} className="app-btn app-btn-subtle app-btn-sm text-xs" disabled={imageZoom >= 4}>Zoom +</button>
              <button onClick={resetZoom} className="app-btn app-btn-subtle app-btn-sm text-xs" disabled={imageZoom === 1 && imagePan.x === 0 && imagePan.y === 0}>Reset</button>
              <button onClick={() => goToIndex(currentIndex - 1)} disabled={currentIndex === 0} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">← Prev</button>
              <button onClick={() => goToIndex(currentIndex + 1)} disabled={currentIndex === items.length - 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Next →</button>
            </div>
          </div>
          <div
            ref={imageViewportRef}
            className="w-full h-[500px] overflow-hidden rounded bg-gray-900 flex items-center justify-center"
            onMouseDown={startDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            style={{ cursor: imageZoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
          >
            {currentItem.image_uri ? (
              <img
                src={currentItem.image_uri}
                alt={currentItem.image_id}
                className="max-h-[500px] max-w-full object-contain rounded select-none"
                style={{ transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`, transformOrigin: "center center", willChange: "transform", backfaceVisibility: "hidden" }}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
              />
            ) : (
              <div className="text-sm text-[var(--app-text-muted)]">No image available</div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">Zoom: {(imageZoom * 100).toFixed(0)}%</p>
          {currentCorrection && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-medium text-amber-300">
                Corrected: Your label was <span className="font-semibold">{currentItem?.ground_truth_label || "UNSET"}</span> → Final: <span className="font-semibold">{currentCorrection.parentLabel}</span>
              </p>
              {currentCorrection.parentTags.length > 0 && (
                <p className="mt-1 text-[10px] text-amber-300/70">
                  Final attributes: {currentCorrection.parentTags.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: Review panel */}
        <div className="space-y-4">
          {/* Secondary Review */}
          <div className="app-card p-4">
            <h4 className="text-xs text-gray-500 font-medium mb-2">Secondary Review</h4>
            {isFlagged ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
                  <span className="text-xs text-amber-400 font-medium">Flagged for review</span>
                </div>
                {currentFlag?.reason && (
                  <p className="text-xs text-gray-300 bg-gray-900 rounded p-2">{currentFlag.reason}</p>
                )}
                <button
                  onClick={() => { if (currentFlag) setCancelConfirmFlagId(currentFlag.flag_id); }}
                  className="app-btn app-btn-sm text-xs text-red-400 border-red-400/40 bg-red-400/10 hover:bg-red-400/20"
                >
                  Cancel Flag
                </button>
              </div>
            ) : (
              <button onClick={() => setFlagModalItemId(currentItem.item_id)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                Flag for Secondary Review
              </button>
            )}
          </div>

          {/* Ground Truth Label */}
          <div className="app-card p-4">
            <h4 className="text-xs text-gray-500 font-medium mb-2">Ground Truth Label</h4>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-400">Ground truth:</span>
              <button
                onClick={() => handleLabelChange("DETECTED")}
                disabled={readOnly}
                className={`px-3 py-1.5 rounded text-xs border ${currentItem.ground_truth_label === "DETECTED" ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)] border-[color:color-mix(in_srgb,var(--app-purple)_36%,transparent)]" : readOnly ? "bg-gray-900/50 text-gray-500 border-gray-800 cursor-not-allowed" : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"}`}
              >DETECTED</button>
              <button
                onClick={() => handleLabelChange("NOT_DETECTED")}
                disabled={readOnly}
                className={`px-3 py-1.5 rounded text-xs border ${currentItem.ground_truth_label === "NOT_DETECTED" ? "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)] border-[color:color-mix(in_srgb,var(--app-not-detected)_36%,transparent)]" : readOnly ? "bg-gray-900/50 text-gray-500 border-gray-800 cursor-not-allowed" : "bg-gray-900 text-gray-300 border-gray-700 hover:bg-gray-800"}`}
              >NOT_DETECTED</button>
              <button
                onClick={() => handleLabelChange(null)}
                disabled={readOnly}
                className={`px-3 py-1.5 rounded text-xs border ${!currentItem.ground_truth_label ? "bg-gray-800 text-gray-100 border-gray-500" : readOnly ? "bg-gray-900/50 text-gray-500 border-gray-800 cursor-not-allowed" : "bg-gray-900 text-gray-400 border-gray-700 hover:bg-gray-800"}`}
              >UNSET</button>
            </div>
          </div>

          {/* Attributes */}
          {segmentOptions.length > 0 && (
            <div className="app-card p-4">
              <h4 className="text-xs text-gray-500 font-medium mb-2">Attributes</h4>
              <AttributePills
                options={segmentOptions}
                selected={currentItem.segment_tags}
                onToggle={handleTagToggle}
                disabled={readOnly}
              />
            </div>
          )}

          {/* Annotator Note */}
          <div className="app-card p-4">
            <h4 className="text-xs text-gray-500 font-medium mb-2">Annotator Note</h4>
            <textarea
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs h-20"
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
              onBlur={saveNote}
              placeholder="Add observations or notes for later..."
              disabled={readOnly}
            />
            <p className="mt-1.5 text-[11px] text-gray-500">Auto-saves when you leave this field or move to another image.</p>
          </div>

          {/* Resolved flag history */}
          {resolvedFlags.length > 0 && (
            <div className="app-card p-4">
              <h4 className="text-xs text-gray-500 font-medium mb-2">Flag Resolution History</h4>
              <div className="space-y-3">
                {resolvedFlags.map((rf) => (
                  <div key={rf.flag_id} className="space-y-1 text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                    <div><span className="text-gray-500">Reason: </span><span className="text-gray-300">{rf.reason}</span></div>
                    <div><span className="text-gray-500">Resolution: </span><span className="text-gray-300">{rf.resolution_action?.replace(/_/g, " ") || "—"}</span></div>
                    {rf.resolution_note && <div><span className="text-gray-500">Note: </span><span className="text-gray-300">{rf.resolution_note}</span></div>}
                    {rf.resolved_at && <div className="text-gray-500">Resolved {new Date(rf.resolved_at).toLocaleDateString()}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {flagModalItemId && (
        <FlagModal onSubmit={(reason) => createFlag(flagModalItemId, reason)} onCancel={() => setFlagModalItemId(null)} />
      )}
      {cancelConfirmFlagId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-card-strong p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Cancel Flag</h3>
            <p className="text-xs text-gray-300">Are you sure you want to cancel this flag? It will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCancelConfirmFlagId(null)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                Keep Flag
              </button>
              <button
                onClick={() => cancelFlag(cancelConfirmFlagId)}
                className="app-btn app-btn-sm text-xs bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30"
              >
                Cancel Flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Flags View ─────────────────────────────────────────────────────────────

interface FlagItemDetails {
  item_id: string | null;
  image_uri: string;
  ground_truth_label: string | null;
  segment_tags: string;
  image_description: string;
}

function FlagsView({ currentUser, datasets }: { currentUser: string; datasets: MyWorkDataset[] }) {
  const [openFlags, setOpenFlags] = useState<ReviewFlag[]>([]);
  const [resolvedFlags, setResolvedFlags] = useState<ReviewFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewSection, setPreviewSection] = useState<"open" | "resolved">("open");
  const [itemDetails, setItemDetails] = useState<Record<string, FlagItemDetails>>({});
  const [flagDatasetMap, setFlagDatasetMap] = useState<Record<string, string>>({});
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const datasetNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ds of datasets) map[ds.dataset_id] = ds.name;
    return map;
  }, [datasets]);

  useEffect(() => {
    if (!currentUser || datasets.length === 0) { setOpenFlags([]); setResolvedFlags([]); return; }
    setLoading(true);
    const ids = datasets.map((d) => d.dataset_id);
    Promise.all(ids.map((id) => fetch(`/api/review-flags?dataset_id=${id}`).then((r) => r.json().then((data) => ({ id, flags: data.flags || [] })))))
      .then((results) => {
        const allFlags: ReviewFlag[] = [];
        const dsMap: Record<string, string> = {};
        for (const r of results) {
          for (const f of r.flags as ReviewFlag[]) {
            allFlags.push(f);
            dsMap[f.flag_id] = r.id;
          }
        }
        setFlagDatasetMap(dsMap);
        setOpenFlags(allFlags.filter((f) => f.status === "open"));
        setResolvedFlags(allFlags.filter((f) => f.status === "resolved" || f.status === "dismissed"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [currentUser, datasets]);

  async function loadItemDetails(flag: ReviewFlag) {
    if (itemDetails[flag.flag_id]) return;
    const params = flag.dataset_item_id
      ? `item_id=${flag.dataset_item_id}`
      : null;
    if (!params) return;
    const res = await fetch(`/api/qa?action=item_details&${params}`);
    if (res.ok) {
      const data = await res.json();
      setItemDetails((prev) => ({
        ...prev,
        [flag.flag_id]: {
          item_id: data.item?.item_id || null,
          image_uri: data.item?.image_uri || "",
          ground_truth_label: data.item?.ground_truth_label || null,
          segment_tags: data.item?.segment_tags || "[]",
          image_description: data.item?.image_description || "",
        },
      }));
    }
  }

  const activeFlags = previewSection === "open" ? openFlags : resolvedFlags;
  const currentFlag = previewIndex != null ? activeFlags[previewIndex] : null;
  const currentDetails = currentFlag ? itemDetails[currentFlag.flag_id] : null;

  function navigateFlag(delta: number) {
    if (previewIndex == null) return;
    const next = Math.max(0, Math.min(activeFlags.length - 1, previewIndex + delta));
    setPreviewIndex(next);
    const flag = activeFlags[next];
    if (flag) loadItemDetails(flag);
  }

  async function cancelFlagFromQueue(flagId: string) {
    const res = await fetch(`/api/review-flags?flag_id=${flagId}`, { method: "DELETE" });
    if (res.ok) {
      setOpenFlags((prev) => prev.filter((f) => f.flag_id !== flagId));
      setPreviewIndex(null);
    }
    setCancelConfirmId(null);
  }

  return (
    <div className="space-y-4">
      <FlagsQueue
        openFlags={openFlags}
        resolvedFlags={resolvedFlags}
        onOpenFlagClick={(flag, idx) => { setPreviewSection("open"); setPreviewIndex(idx); loadItemDetails(flag); }}
        onResolvedFlagClick={(flag, idx) => { setPreviewSection("resolved"); setPreviewIndex(idx); loadItemDetails(flag); }}
        renderFlagSubtitle={(flag) => (
          <>
            <span className="text-[11px] text-[var(--app-text-muted)]">&middot;</span>
            <p className="text-xs text-[var(--app-text-muted)] truncate">{datasetNameMap[flagDatasetMap[flag.flag_id]] || ""}</p>
          </>
        )}
        loading={loading}
      />

      {/* Image Preview Modal */}
      <ImagePreviewModal
        isOpen={previewIndex != null && !!currentFlag}
        imageUrl={currentDetails?.image_uri || ""}
        imageAlt={currentFlag?.image_id || ""}
        title={previewSection === "open" ? "Flagged Image" : "Resolved Flag"}
        subtitle={currentFlag?.image_id || ""}
        index={previewIndex ?? 0}
        total={activeFlags.length}
        onClose={() => setPreviewIndex(null)}
        onPrev={() => navigateFlag(-1)}
        onNext={() => navigateFlag(1)}
        details={currentFlag ? (
          <div className="space-y-4">
            {/* Context header */}
            <div className="flex items-center gap-3 text-[11px] text-[var(--app-text-subtle)]">
              <span className="font-mono text-[var(--app-text)]">{currentFlag.image_id}</span>
              <span className="text-[var(--app-text-muted)]">&middot;</span>
              <span>{datasetNameMap[flagDatasetMap[currentFlag.flag_id]] || "Unknown"}</span>
            </div>

            {/* Flag card */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Flag className="h-3 w-3 text-amber-400" />
                <span className="text-xs font-medium text-amber-400">
                  {previewSection === "open" ? "Open Flag" : "Resolved Flag"}
                </span>
                <span className="ml-auto text-[11px] text-gray-500">
                  {new Date(currentFlag.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-gray-200">{currentFlag.reason}</p>

              {previewSection === "open" && (
                <button
                  onClick={() => setCancelConfirmId(currentFlag.flag_id)}
                  className="mt-1 app-btn app-btn-sm text-[11px] text-red-400 border-red-400/40 bg-red-400/10 hover:bg-red-400/20"
                >
                  Cancel Flag
                </button>
              )}

              {previewSection === "resolved" && (
                <div className="mt-1 space-y-1.5 border-t border-amber-500/20 pt-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      currentFlag.status === "dismissed" ? "bg-gray-500/10 text-gray-400" : "bg-emerald-500/10 text-emerald-300"
                    }`}>{currentFlag.status}</span>
                    {currentFlag.resolution_action && (
                      <span className="text-xs text-gray-300">{currentFlag.resolution_action.replace(/_/g, " ")}</span>
                    )}
                  </div>
                  {currentFlag.resolution_note && <p className="text-[11px] text-gray-300">{currentFlag.resolution_note}</p>}
                  {currentFlag.resolved_at && <p className="text-[11px] text-gray-500">Resolved {new Date(currentFlag.resolved_at).toLocaleString()}</p>}
                </div>
              )}
            </div>

            {/* Annotation state */}
            {(currentDetails?.ground_truth_label || currentDetails?.segment_tags || currentDetails?.image_description) && (
              <div className="space-y-4 pt-1">
                {currentDetails.ground_truth_label && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-semibold text-[var(--app-text)]">Ground Truth Label</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${currentDetails.ground_truth_label === "DETECTED" ? "bg-[var(--app-purple-soft)] text-[var(--app-purple)]" : "bg-[var(--app-not-detected-soft)] text-[var(--app-not-detected)]"}`}>
                      {currentDetails.ground_truth_label}
                    </span>
                  </div>
                )}

                {(() => {
                  const tags: string[] = (() => { try { return JSON.parse(currentDetails?.segment_tags || "[]"); } catch { return []; } })();
                  return tags.length > 0 ? (
                    <div>
                      <span className="text-xs font-semibold text-[var(--app-text)] block mb-2">Attribute Tags</span>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag: string) => (
                          <span key={tag} className="rounded border border-[var(--app-border)] bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] text-[var(--app-text-subtle)]">{tag}</span>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {currentDetails.image_description && (
                  <div>
                    <span className="text-xs font-semibold text-[var(--app-text)] block mb-2">Annotator Notes</span>
                    <p className="text-xs text-[var(--app-text-muted)] italic border-l-2 border-[var(--app-border)] pl-2.5">{currentDetails.image_description}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : undefined}
      />

      {cancelConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-card-strong p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">Cancel Flag</h3>
            <p className="text-xs text-gray-300">Are you sure you want to cancel this flag? It will be permanently removed.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCancelConfirmId(null)} className="app-btn app-btn-subtle app-btn-sm text-xs">
                Keep Flag
              </button>
              <button
                onClick={() => cancelFlagFromQueue(cancelConfirmId)}
                className="app-btn app-btn-sm text-xs bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30"
              >
                Cancel Flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Performance Metrics View ────────────────────────────────────────────────

function PerformanceView({ currentUser, datasets }: { currentUser: string; datasets: MyWorkDataset[] }) {
  const [allSnapshots, setAllSnapshots] = useState<any[]>([]);
  const [datasetMetrics, setDatasetMetrics] = useState<DatasetMetric[]>([]);
  const [loading, setLoading] = useState(false);

  const [chartMetric, setChartMetric] = useState<string>("accuracy");
  const [chartPeriodCount, setChartPeriodCount] = useState(5);
  const [chartPeriodType, setChartPeriodType] = useState<"week" | "month">("week");
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [tempCount, setTempCount] = useState(5);
  const [tempUnit, setTempUnit] = useState<"week" | "month">("week");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<keyof DatasetMetric>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/qa/metrics/history?annotator=${encodeURIComponent(currentUser)}&period_type=week&count=52`).then((r) => r.json()),
      fetch(`/api/qa/metrics/datasets?annotator=${encodeURIComponent(currentUser)}`).then((r) => r.json()),
    ]).then(([histData, dsData]) => {
      setAllSnapshots(histData.history || []);
      setDatasetMetrics(dsData.datasets || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [currentUser]);

  // Aggregated metrics from all snapshots
  const aggregated = useMemo(() => {
    if (!allSnapshots.length) return null;
    const sum = (f: string) => allSnapshots.reduce((s: number, r: any) => s + (r[f] || 0), 0);
    const avg = (f: string) => {
      const vals = allSnapshots.map((r: any) => r[f]).filter((v: any) => v !== null && v !== undefined) as number[];
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      accuracy: avg("accuracy"),
      attribute_error: avg("attribute_error"),
      label_error: avg("label_error"),
      correction: avg("correction"),
      datasets_assigned: sum("datasets_assigned"),
      datasets_completed: sum("datasets_completed"),
      items_labeled: sum("items_labeled"),
      flag_rate: avg("flag_rate"),
    };
  }, [allSnapshots]);

  // Chart data (filtered by period settings)
  const chartData = useMemo(() => {
    if (!allSnapshots.length) return [];
    let filtered = allSnapshots;
    if (chartPeriodType === "week") {
      const sorted = [...allSnapshots].sort((a, b) => a.period_start.localeCompare(b.period_start));
      const periods = [...new Set(sorted.map((s) => s.period_start))];
      const recentPeriods = new Set(periods.slice(-chartPeriodCount));
      filtered = sorted.filter((s) => recentPeriods.has(s.period_start));
    }
    return filtered.map((h) => ({
      period: formatPeriodLabel(h.period_start, chartPeriodType),
      [currentUser]: h[chartMetric] ?? null,
    }));
  }, [allSnapshots, chartPeriodCount, chartPeriodType, chartMetric, currentUser]);

  function formatPeriodLabel(dateStr: string, type: "week" | "month"): string {
    const d = new Date(dateStr + "T00:00:00");
    if (type === "month") return d.toLocaleDateString(undefined, { month: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  // Sort and paginate dataset table
  const sortedDatasets = useMemo(() => {
    return [...datasetMetrics].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "desc" ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      if (sortDir === "desc") return (bVal as number) - (aVal as number);
      return (aVal as number) - (bVal as number);
    });
  }, [datasetMetrics, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedDatasets.length / pageSize));
  const pagedData = sortedDatasets.slice((page - 1) * pageSize, page * pageSize);
  const showFrom = sortedDatasets.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const showTo = Math.min(page * pageSize, sortedDatasets.length);

  function handleSort(key: keyof DatasetMetric) {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  const timeframeLabel = `Previous ${chartPeriodCount} ${chartPeriodType === "week" ? "weeks" : "months"}`;
  const metricLabel = metricOptions.find((o) => o.value === chartMetric)?.label || chartMetric;
  const periodLabel = chartPeriodType === "week" ? "Week" : "Month";
  const isRate = !["datasets_assigned", "datasets_completed", "items_labeled"].includes(chartMetric);

  if (loading) return <p className="text-sm text-[var(--app-text-muted)]">Loading performance data...</p>;

  return (
    <div className="space-y-6">
      {/* Metric Tiles */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        <div className="app-card px-3 py-2.5 text-center" title="Total datasets assigned across all periods">
          <Inbox className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Assigned</span>
          <p className="text-base font-semibold text-[var(--app-text)]">{aggregated?.datasets_assigned ?? "—"}</p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Total datasets completed across all periods">
          <CheckCheck className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Completed</span>
          <p className="text-base font-semibold text-[var(--app-text)]">{aggregated?.datasets_completed ?? "—"}</p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Total items reviewed across all periods">
          <BarChart3 className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Items Reviewed</span>
          <p className="text-base font-semibold text-[var(--app-text)]">{aggregated?.items_labeled ?? "—"}</p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Average rate of items flagged for review">
          <Flag className="h-3.5 w-3.5 text-amber-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Flag Rate</span>
          <p className="text-base font-semibold text-[var(--app-text)]">
            {aggregated?.flag_rate != null ? `${(aggregated.flag_rate * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Average attribute match rate across periods">
          <LayoutGrid className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Attr Match</span>
          <p className="text-base font-semibold text-[var(--app-text)]">
            {aggregated?.attribute_error != null ? `${(aggregated.attribute_error * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Average label match rate across periods">
          <ClipboardList className="h-3.5 w-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Label Match</span>
          <p className="text-base font-semibold text-[var(--app-text)]">
            {aggregated?.label_error != null ? `${(aggregated.label_error * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Average correction rate (1 - accuracy)">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Correction</span>
          <p className="text-base font-semibold text-[var(--app-text)]">
            {aggregated?.correction != null ? `${(aggregated.correction * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="app-card px-3 py-2.5 text-center" title="Average accuracy across all periods">
          <CircleCheckBig className="h-3.5 w-3.5 text-emerald-400 mx-auto mb-1" />
          <span className="text-[10px] text-[var(--app-text-muted)] block mb-0.5">Accuracy</span>
          <p className="text-base font-semibold text-[var(--app-text)]">
            {aggregated?.accuracy != null ? `${(aggregated.accuracy * 100).toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>

      {/* Chart Section */}
      <div className="space-y-0">
        {/* Top bar: Timeframe + Metric tabs */}
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
                    <button className="app-btn app-btn-primary app-btn-sm text-xs" onClick={applyTimeframe}>Apply</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {metricOptions.map((o) => (
              <button
                key={o.value}
                className={`relative px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${chartMetric === o.value ? "text-[var(--app-text)]" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`}
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

        {/* Chart card */}
        <div className="app-card mt-4">
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-5 py-3">
            <h3 className="text-sm font-semibold text-[var(--app-text)]">
              {metricLabel} by {periodLabel}
            </h3>
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
          <div className="h-[280px] w-full px-3 py-4">
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-[var(--app-text-muted)]">No historical data available.</p>
              </div>
            ) : (
              <AnnotatorChart
                data={chartData}
                dataKey={currentUser}
                chartType={chartType}
                isRate={isRate}
              />
            )}
          </div>
        </div>
      </div>

      {/* Dataset Table */}
      <div className="app-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Performance by Dataset</h3>
          <div className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
            <span>Show</span>
            <select
              className="app-select px-1.5 py-0.5 text-xs"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>per page</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {datasetMetrics.length === 0 ? (
            <p className="px-5 py-8 text-sm text-[var(--app-text-muted)] text-center">No dataset metrics available.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--app-border)]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--app-text-subtle)]">Dataset</th>
                    {([
                      { key: "items_labeled", label: "Items" },
                      { key: "flag_rate", label: "Flag Rate" },
                      { key: "attribute_error", label: "Attr Match" },
                      { key: "label_error", label: "Label Match" },
                      { key: "accuracy", label: "Accuracy" },
                      { key: "correction", label: "Correction" },
                      { key: "status", label: "Status" },
                      { key: "updated_at", label: "Last Updated" },
                    ] as { key: keyof DatasetMetric; label: string }[]).map((col) => (
                      <th
                        key={col.key}
                        className="px-3 py-2 text-right text-xs font-medium text-[var(--app-text-subtle)] cursor-pointer select-none hover:text-[var(--app-text)]"
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && <span className="text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedData.map((ds) => (
                    <tr key={ds.id} className="border-b border-[var(--app-border)] hover:bg-[var(--app-table-row-hover)]">
                      <td className="px-3 py-2.5 font-medium text-[var(--app-text)]">
                        <div className="truncate max-w-[200px]">{ds.dataset_name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{ds.items_labeled}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(ds.flag_rate)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(ds.attribute_error)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(ds.label_error)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(ds.accuracy)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">{formatRate(ds.correction)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`app-badge ${STATUS_BADGE_CLASSES[ds.status] || STATUS_BADGE_CLASSES.draft}`}>
                          {STATUS_LABELS[ds.status] || ds.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--app-text-muted)]">
                        {ds.updated_at ? new Date(ds.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--app-border)]">
                <span className="text-xs text-[var(--app-text-muted)]">
                  Showing {showFrom}–{showTo} of {sortedDatasets.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="app-btn app-btn-toolbar app-btn-sm text-xs"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Prev
                  </button>
                  <button
                    className="app-btn app-btn-toolbar app-btn-sm text-xs"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnotatorChart({ data, dataKey, chartType, isRate }: { data: any[]; dataKey: string; chartType: "line" | "bar"; isRate: boolean }) {
  const formatLabel = (value: any) => {
    if (value === null || value === undefined) return "";
    if (isRate) return `${(value * 100).toFixed(0)}%`;
    return String(value);
  };
  const yTickFormatter = (value: number) => {
    if (isRate) return `${(value * 100).toFixed(0)}%`;
    return String(value);
  };
  const tooltipFormatter = (value: any) => {
    if (value === null || value === undefined) return "—";
    if (isRate) return `${(value * 100).toFixed(1)}%`;
    return String(value);
  };

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} tickFormatter={yTickFormatter} domain={isRate ? [0, 1] : undefined} />
          <Tooltip
            contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "var(--app-text-muted)" }}
            formatter={tooltipFormatter}
          />
          <Bar dataKey={dataKey} fill="#5cb8ff" radius={[3, 3, 0, 0]}>
            <LabelList dataKey={dataKey} position="top" formatter={formatLabel} style={{ fontSize: 10, fill: "var(--app-text-muted)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} />
        <YAxis tick={{ fontSize: 11, fill: "var(--app-text-subtle)" }} tickFormatter={yTickFormatter} domain={isRate ? [0, 1] : undefined} />
        <Tooltip
          contentStyle={{ background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: "var(--app-text-muted)" }}
          formatter={tooltipFormatter}
        />
        <Line type="monotone" dataKey={dataKey} stroke="#5cb8ff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls>
          <LabelList dataKey={dataKey} position="top" formatter={formatLabel} style={{ fontSize: 10, fill: "var(--app-text-muted)" }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function Annotation({ detections }: { detections: Detection[] }) {
  const { notify } = useAppFeedback();
  const { pendingDatasetId, setPendingDatasetId } = useAppStore();
  const [currentUser, setCurrentUser] = useState("");
  const [annotators, setAnnotators] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<MyWorkDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [flagCounts, setFlagCounts] = useState<Record<string, number>>({});
  const [resolvedFlagCounts, setResolvedFlagCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<FilterTab>("all");
  const [sortCol, setSortCol] = useState<"name" | "detection" | "status" | "progress" | "open_flags" | "resolved_flags" | "assigned_at">("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [dsPage, setDsPage] = useState(1);
  const [dsPageSize, setDsPageSize] = useState(5);
  const [dsSearch, setDsSearch] = useState("");
  const [dsSearchFocused, setDsSearchFocused] = useState(false);
  const [subView, setSubView] = useState<SubView>("datasets");

  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [annotationItems, setAnnotationItems] = useState<DatasetItemRow[]>([]);
  const [loadingAnnotation, setLoadingAnnotation] = useState(false);
  const [corrections, setCorrections] = useState<Map<string, CorrectionEntry> | null>(null);
  const [itemFlags, setItemFlags] = useState<Record<string, { reason: string }>>({});

  useEffect(() => {
    fetch("/api/qa?action=annotators")
      .then((r) => r.json())
      .then((d) => setAnnotators(d.annotators || []));
  }, []);

  const loadMyDatasets = useCallback(async () => {
    if (!currentUser) {
      setDatasets([]);
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/qa?action=datasets&assigned_to=${encodeURIComponent(currentUser)}`);
    const data = await res.json();
    setDatasets(data.datasets || []);
    setLoading(false);
  }, [currentUser]);

  useEffect(() => {
    loadMyDatasets();
  }, [loadMyDatasets]);

  useEffect(() => {
    if (!pendingDatasetId) return;
    if (datasets.some((d) => d.dataset_id === pendingDatasetId)) {
      setActiveDatasetId(pendingDatasetId);
      setSubView("datasets");
      setPendingDatasetId(null);
    }
  }, [pendingDatasetId, datasets, setPendingDatasetId]);

  useEffect(() => {
    if (datasets.length === 0) { setFlagCounts({}); setResolvedFlagCounts({}); return; }
    const ids = datasets.map((d) => d.dataset_id).join(",");
    fetch(`/api/review-flags?action=counts&dataset_ids=${ids}`)
      .then((r) => r.json())
      .then((data) => {
        setFlagCounts(data.counts || {});
        setResolvedFlagCounts(data.resolvedCounts || {});
      });
  }, [datasets]);

  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser) { setNotifications([]); return; }
    fetch(`/api/notifications?action=list&recipient=${encodeURIComponent(currentUser)}`)
      .then((r) => r.json())
      .then((data) => setNotifications(data.notifications || []))
      .catch(() => {});
  }, [currentUser]);

  const dismissNotification = async (notificationId: string) => {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", notification_id: notificationId }),
    });
    setNotifications((prev) => prev.filter((n) => n.notification_id !== notificationId));
  };

  const openAnnotationView = useCallback(async (ds: MyWorkDataset) => {
    setActiveDatasetId(ds.dataset_id);
    setActiveItemIndex(null);
    setCorrections(null);
    setItemFlags({});
    setLoadingAnnotation(true);
    const res = await fetch(`/api/datasets?dataset_id=${ds.dataset_id}`);
    const data = await res.json();
    const rows: DatasetItemRow[] = (data.items || []).map((item: any) => ({
      ...item,
      segment_tags: Array.isArray(item.segment_tags)
        ? item.segment_tags
        : typeof item.segment_tags === "string"
          ? (() => { try { return JSON.parse(item.segment_tags); } catch { return []; } })()
          : [],
    }));
    setAnnotationItems(rows);
    setLoadingAnnotation(false);

    fetch(`/api/review-flags?dataset_id=${ds.dataset_id}`)
      .then((r) => r.json())
      .then((flagData) => {
        const openFlags: Record<string, { reason: string }> = {};
        for (const f of (flagData.flags || []).filter((fl: any) => fl.status === "open")) {
          if (f.dataset_item_id) openFlags[f.dataset_item_id] = { reason: f.reason };
        }
        setItemFlags(openFlags);
      });

    if (ds.qa_status === "archived") {
      const cRes = await fetch(`/api/datasets?corrections=${ds.dataset_id}`);
      const cData = await cRes.json();
      if (Array.isArray(cData.corrections)) {
        const map = new Map<string, CorrectionEntry>();
        for (const c of cData.corrections) {
          map.set(c.image_id, {
            parentLabel: c.parent_label,
            parentTags: c.parent_tags,
            childLabel: c.child_label,
            childTags: c.child_tags,
          });
        }
        setCorrections(map);
      }
    }
  }, []);

  useEffect(() => {
    if (activeDatasetId && activeItemIndex === null) {
      fetch(`/api/review-flags?dataset_id=${activeDatasetId}`)
        .then((r) => r.json())
        .then((flagData) => {
          const openFlags: Record<string, { reason: string }> = {};
          for (const f of (flagData.flags || []).filter((fl: any) => fl.status === "open")) {
            if (f.dataset_item_id) openFlags[f.dataset_item_id] = { reason: f.reason };
          }
          setItemFlags(openFlags);
        });
    }
  }, [activeDatasetId, activeItemIndex]);

  function navigateToWork(ds: MyWorkDataset) {
    openAnnotationView(ds);
  }

  // Summary card counts
  const summaryCards = useMemo(() => {
    const assignedCount = datasets.filter((d) => d.qa_status === "assigned").length;
    const needsRevisionCount = datasets.filter((d) => d.qa_status === "needs_revision").length;
    const inProgressCount = datasets.filter((d) => d.qa_status === "in_annotation").length;
    const submittedCount = datasets.filter((d) => ["submitted", "in_qa"].includes(d.qa_status)).length;
    const doneCount = datasets.filter((d) => ["approved", "finalized", "archived"].includes(d.qa_status)).length;
    return { assignedCount, needsRevisionCount, inProgressCount, submittedCount, doneCount };
  }, [datasets]);

  const detectionName = (id: string | null) =>
    detections.find((d) => d.detection_id === id)?.display_name || "Unassigned";

  // Filtered + sorted datasets
  const filteredDatasets = useMemo(() => {
    let filtered = datasets;
    switch (statusFilter) {
      case "all":
        filtered = datasets.filter((d) => d.qa_status !== "archived");
        break;
      case "assigned":
        filtered = datasets.filter((d) => d.qa_status === "assigned");
        break;
      case "needs_revision":
        filtered = datasets.filter((d) => d.qa_status === "needs_revision");
        break;
      case "in_progress":
        filtered = datasets.filter((d) => d.qa_status === "in_annotation");
        break;
      case "submitted":
        filtered = datasets.filter((d) => ["submitted", "in_qa"].includes(d.qa_status));
        break;
      case "done":
        filtered = datasets.filter((d) => ["approved", "finalized", "archived"].includes(d.qa_status));
        break;
    }

    if (dsSearch.trim()) {
      const q = dsSearch.trim().toLowerCase();
      filtered = filtered.filter((d) =>
        d.name.toLowerCase().includes(q)
      );
    }

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "detection":
          cmp = detectionName(a.detection_id).localeCompare(detectionName(b.detection_id));
          break;
        case "status":
          cmp = (ANNOTATOR_STATUS_ORDER[a.qa_status] ?? 99) - (ANNOTATOR_STATUS_ORDER[b.qa_status] ?? 99);
          break;
        case "progress": {
          const pA = a.size > 0 ? a.items_labeled / a.size : 0;
          const pB = b.size > 0 ? b.items_labeled / b.size : 0;
          cmp = pA - pB;
          break;
        }
        case "open_flags":
          cmp = (flagCounts[a.dataset_id] || 0) - (flagCounts[b.dataset_id] || 0);
          break;
        case "resolved_flags":
          cmp = (resolvedFlagCounts[a.dataset_id] || 0) - (resolvedFlagCounts[b.dataset_id] || 0);
          break;
        case "assigned_at":
          cmp = (a.assigned_at || "").localeCompare(b.assigned_at || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [datasets, detections, statusFilter, dsSearch, flagCounts, resolvedFlagCounts, sortCol, sortDir]);


  const totalOpenFlags = useMemo(
    () => Object.values(flagCounts).reduce((sum, n) => sum + n, 0),
    [flagCounts]
  );

  // Active annotation view
  if (activeDatasetId) {
    const activeDs = datasets.find((d) => d.dataset_id === activeDatasetId);
    if (!activeDs) {
      setActiveDatasetId(null);
      return null;
    }

    if (loadingAnnotation) {
      return (
        <div className="space-y-4">
          <button onClick={() => setActiveDatasetId(null)} className="flex items-center gap-1.5 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <ArrowLeft className="h-4 w-4" /> Back to datasets
          </button>
          <p className="text-sm text-[var(--app-text-muted)]">Loading dataset...</p>
        </div>
      );
    }

    const readOnly = isReadOnlyStatus(activeDs.qa_status);
    const showReportCard = activeDs.qa_status === "approved";
    const detection = detections.find((d) => d.detection_id === activeDs.detection_id) || null;

    if (activeItemIndex !== null) {
      return (
        <AnnotationView
          dataset={activeDs}
          items={annotationItems}
          detection={detection}
          readOnly={readOnly}
          showReportCard={showReportCard}
          onBack={() => setActiveItemIndex(null)}
          onRefresh={loadMyDatasets}
          onItemsChange={setAnnotationItems}
          initialIndex={activeItemIndex}
          corrections={corrections}
        />
      );
    }

    return (
      <DatasetListView
        dataset={activeDs}
        items={annotationItems}
        detection={detection}
        readOnly={readOnly}
        corrections={corrections}
        flags={itemFlags}
        onBack={() => { setActiveDatasetId(null); setCorrections(null); }}
        onSelectImage={(idx) => setActiveItemIndex(idx)}
      />
    );
  }

  // Dashboard
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--app-text)]">Annotation</h2>
          <p className="mt-1 text-sm text-[var(--app-text-muted)]">
            Your assigned datasets and annotation progress.
          </p>
        </div>
        <div className="w-1/5">
          <label className="app-label mb-1 block text-xs">View as</label>
          <select
            className="app-select px-3 py-2 text-sm w-full"
            value={currentUser}
            onChange={(e) => setCurrentUser(e.target.value)}
          >
            <option value="">Select an annotator...</option>
            {annotators.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {!currentUser ? (
        <div className="app-card p-8 text-center">
          <p className="text-sm text-[var(--app-text-muted)]">Select a name from the View As menu to see work assigned to the selected annotator.</p>
        </div>
      ) : loading ? (
        <p className="text-sm text-[var(--app-text-muted)]">Loading...</p>
      ) : (
        <>
          {/* Sub-tab navigation */}
          <div className="flex gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-1">
            {SUB_TABS.map((tab) => {
              const badge = tab.id === "flags" ? totalOpenFlags : null;
              return (
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
                  {badge != null && badge > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Notification banners */}
          {notifications.length > 0 && subView === "datasets" && (
            <div className="space-y-2">
              {notifications.map((n) => (
                <div
                  key={n.notification_id}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
                >
                  <Bell className="h-4 w-4 text-amber-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-100">{n.title}</p>
                    {n.message && <p className="text-xs text-amber-200/70 mt-0.5">{n.message}</p>}
                  </div>
                  {n.dataset_id && (
                    <button
                      onClick={() => {
                        const ds = datasets.find((d) => d.dataset_id === n.dataset_id);
                        if (ds) openAnnotationView(ds);
                      }}
                      className="app-btn app-btn-sm text-xs border border-amber-500/40 text-amber-200 hover:bg-amber-500/20"
                    >
                      View Results
                    </button>
                  )}
                  <button
                    onClick={() => dismissNotification(n.notification_id)}
                    className="text-amber-300/60 hover:text-amber-200 shrink-0"
                    title="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {subView === "datasets" && (
            datasets.length === 0 ? (
              <div className="app-card p-8 text-center">
                <p className="text-sm text-[var(--app-text-muted)]">No datasets assigned to you.</p>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <button
                    onClick={() => { setStatusFilter("assigned"); setDsPage(1); }}
                    className={`app-card p-4 text-left transition hover:bg-[var(--app-table-row-hover)] ${statusFilter === "assigned" ? "ring-1 ring-[rgba(182,223,255,0.22)]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Inbox className="h-4 w-4 text-blue-400" />
                      <span className="text-xs text-[var(--app-text-muted)]">Assigned</span>
                    </div>
                    <p className="text-2xl font-semibold text-[var(--app-text)]">{summaryCards.assignedCount}</p>
                  </button>
                  <button
                    onClick={() => { setStatusFilter("needs_revision"); setDsPage(1); }}
                    className={`app-card p-4 text-left transition hover:bg-[var(--app-table-row-hover)] ${statusFilter === "needs_revision" ? "ring-1 ring-[rgba(182,223,255,0.22)]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <span className="text-xs text-[var(--app-text-muted)]">Needs Revision</span>
                    </div>
                    <p className="text-2xl font-semibold text-[var(--app-text)]">{summaryCards.needsRevisionCount}</p>
                  </button>
                  <button
                    onClick={() => { setStatusFilter("in_progress"); setDsPage(1); }}
                    className={`app-card p-4 text-left transition hover:bg-[var(--app-table-row-hover)] ${statusFilter === "in_progress" ? "ring-1 ring-[rgba(182,223,255,0.22)]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-4 w-4 text-amber-400" />
                      <span className="text-xs text-[var(--app-text-muted)]">In Progress</span>
                    </div>
                    <p className="text-2xl font-semibold text-[var(--app-text)]">{summaryCards.inProgressCount}</p>
                  </button>
                  <button
                    onClick={() => { setStatusFilter("submitted"); setDsPage(1); }}
                    className={`app-card p-4 text-left transition hover:bg-[var(--app-table-row-hover)] ${statusFilter === "submitted" ? "ring-1 ring-[rgba(182,223,255,0.22)]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Send className="h-4 w-4 text-purple-400" />
                      <span className="text-xs text-[var(--app-text-muted)]">Submitted</span>
                    </div>
                    <p className="text-2xl font-semibold text-[var(--app-text)]">{summaryCards.submittedCount}</p>
                  </button>
                  <button
                    onClick={() => { setStatusFilter("done"); setDsPage(1); }}
                    className={`app-card p-4 text-left transition hover:bg-[var(--app-table-row-hover)] ${statusFilter === "done" ? "ring-1 ring-[rgba(182,223,255,0.22)]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <CircleCheckBig className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs text-[var(--app-text-muted)]">Done</span>
                    </div>
                    <p className="text-2xl font-semibold text-[var(--app-text)]">{summaryCards.doneCount}</p>
                  </button>
                </div>

                {/* Filter tabs + search */}
                <div className="flex items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-soft)] p-1">
                  <div className="flex gap-1">
                    {FILTER_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => { setStatusFilter(tab.id); setDsPage(1); }}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          statusFilter === tab.id
                            ? "bg-[rgba(92,184,255,0.12)] text-[var(--app-text)] ring-1 ring-[rgba(182,223,255,0.22)]"
                            : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                        }`}
                      >
                        {tab.icon}
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative ml-auto mr-1">
                    <div className="flex items-center gap-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-field-bg)] px-2.5 py-1.5">
                      <Search className="h-3.5 w-3.5 text-[var(--app-text-subtle)]" />
                      <input
                        type="text"
                        placeholder="Search datasets..."
                        className="bg-transparent text-sm text-[var(--app-text)] placeholder:text-[var(--app-text-subtle)] outline-none w-44"
                        value={dsSearch}
                        onChange={(e) => { setDsSearch(e.target.value); setDsPage(1); }}
                        onFocus={() => setDsSearchFocused(true)}
                        onBlur={() => setTimeout(() => setDsSearchFocused(false), 200)}
                      />
                      {dsSearch && (
                        <button onClick={() => { setDsSearch(""); setDsPage(1); }} className="text-[var(--app-text-subtle)] hover:text-[var(--app-text)]">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {dsSearchFocused && dsSearch.trim().length > 0 && (() => {
                      const q = dsSearch.trim().toLowerCase();
                      const suggestions: { label: string }[] = [];
                      const seen = new Set<string>();
                      for (const d of datasets) {
                        if (d.name.toLowerCase().includes(q) && !seen.has(d.name)) {
                          seen.add(d.name);
                          suggestions.push({ label: d.name });
                        }
                      }
                      if (suggestions.length === 0) return null;
                      return (
                        <div className="absolute top-full left-0 right-0 mt-1 z-30 max-h-48 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-strong)] shadow-lg">
                          {suggestions.slice(0, 8).map((s) => (
                            <button
                              key={s.label}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-[var(--app-table-row-hover)] transition-colors"
                              onMouseDown={(e) => { e.preventDefault(); setDsSearch(s.label); setDsPage(1); }}
                            >
                              <span className="text-[var(--app-text)] truncate">{s.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Dataset table */}
                <div className="app-card overflow-hidden">
                  <table className="app-table app-table-fixed">
                    <colgroup>
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "11%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        {([
                          { key: "status", label: "Status", center: false },
                          { key: "name", label: "Dataset", center: false },
                          { key: "detection", label: "Detection", center: false },
                          { key: "assigned_at", label: "Date Assigned", center: false },
                          { key: "progress", label: "Progress", center: false },
                          { key: "resolved_flags", label: "Resolved Flags", center: true },
                          { key: "open_flags", label: "Open Flags", center: true },
                        ] as const).map((col) => (
                          <th
                            key={col.key}
                            className={`app-table-col-label cursor-pointer select-none hover:text-[var(--app-text)] ${col.center ? "text-center" : ""}`}
                            onClick={() => {
                              if (sortCol === col.key) {
                                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                              } else {
                                setSortCol(col.key);
                                setSortDir("asc");
                              }
                              setDsPage(1);
                            }}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {sortCol === col.key && (
                                sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDatasets.slice((dsPage - 1) * dsPageSize, dsPage * dsPageSize).map((ds) => {
                        const pctVal = ds.size > 0 ? Math.round(((ds.items_labeled || 0) / ds.size) * 100) : 0;
                        const dsOpenFlags = flagCounts[ds.dataset_id] || 0;
                        const dsResolvedFlags = resolvedFlagCounts[ds.dataset_id] || 0;
                        return (
                          <tr
                            key={ds.dataset_id}
                            className="cursor-pointer border-t border-white/5 hover:bg-[rgba(92,184,255,0.04)]"
                            onClick={() => navigateToWork(ds)}
                          >
                            <td>
                              <span className={`app-badge ${STATUS_BADGE_CLASSES[ds.qa_status] || STATUS_BADGE_CLASSES.draft}`}>
                                {STATUS_LABELS[ds.qa_status] || ds.qa_status}
                              </span>
                            </td>
                            <td className="text-[var(--app-text)]">
                              <div className="truncate">{ds.name}</div>
                            </td>
                            <td className="app-table-muted">{detectionName(ds.detection_id)}</td>
                            <td className="text-xs text-[var(--app-text-muted)]">
                              {ds.assigned_at ? new Date(ds.assigned_at).toLocaleDateString() : "—"}
                            </td>
                            <td>
                              <span className="text-[11px] text-[var(--app-text-muted)] tabular-nums">
                                {ds.items_labeled || 0}/{ds.size} ({pctVal}%)
                              </span>
                            </td>
                            <td className="app-table-col-center">
                              {dsResolvedFlags > 0 ? (
                                <span className="flex items-center justify-center gap-1 text-emerald-300">
                                  <Flag className="h-3 w-3" />
                                  <span className="text-xs">{dsResolvedFlags}</span>
                                </span>
                              ) : (
                                <span className="text-[var(--app-text-subtle)]">—</span>
                              )}
                            </td>
                            <td className="app-table-col-center">
                              {dsOpenFlags > 0 ? (
                                <span className="flex items-center justify-center gap-1 text-red-300">
                                  <Flag className="h-3 w-3" />
                                  <span className="text-xs">{dsOpenFlags}</span>
                                </span>
                              ) : (
                                <span className="text-[var(--app-text-subtle)]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredDatasets.length === 0 && (
                        <tr>
                          <td colSpan={7} className="app-table-subtle px-3 py-6 text-center">
                            No datasets match this filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {filteredDatasets.length > 0 && (
                    <div className="flex items-center justify-between border-t border-[var(--app-border)] px-4 py-2">
                      <select
                        className="app-select py-0.5 text-[10px]"
                        style={{ width: "70px" }}
                        value={dsPageSize}
                        onChange={(e) => { setDsPageSize(parseInt(e.target.value)); setDsPage(1); }}
                      >
                        <option value="5">5 / page</option>
                        <option value="10">10 / page</option>
                        <option value="25">25 / page</option>
                        <option value="50">50 / page</option>
                      </select>
                      {Math.ceil(filteredDatasets.length / dsPageSize) > 1 && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setDsPage((p) => Math.max(1, p - 1))}
                            disabled={dsPage <= 1}
                            className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                          >Prev</button>
                          <span className="text-[11px] text-[var(--app-text-muted)] px-2 tabular-nums">{dsPage} / {Math.ceil(filteredDatasets.length / dsPageSize)}</span>
                          <button
                            onClick={() => setDsPage((p) => Math.min(Math.ceil(filteredDatasets.length / dsPageSize), p + 1))}
                            disabled={dsPage >= Math.ceil(filteredDatasets.length / dsPageSize)}
                            className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30"
                          >Next</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )
          )}

          {subView === "flags" && (
            <FlagsView currentUser={currentUser} datasets={datasets} />
          )}

          {subView === "performance" && (
            <PerformanceView currentUser={currentUser} datasets={datasets} />
          )}
        </>
      )}
    </div>
  );
}
