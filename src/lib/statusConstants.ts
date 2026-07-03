// Single source of truth for dataset qa_status display, ordering, and gating.
// Transitions live in src/lib/schemas.ts as QA_STATUS_TRANSITIONS.

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_annotation: "In Annotation",
  submitted: "Submitted",
  in_qa: "In QA",
  needs_revision: "Needs Revision",
  approved: "Approved",
  finalized: "Finalized",
  archived: "Archived",
  rejected: "Rejected",
};

// Tailwind utility classes — fallback for inline badge styling.
export const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300",
  assigned: "bg-sky-400/20 text-sky-300",
  in_annotation: "bg-blue-500/20 text-blue-300",
  submitted: "bg-amber-300/20 text-amber-200",
  in_qa: "bg-amber-500/20 text-amber-400",
  needs_revision: "bg-red-500/20 text-red-300",
  rejected: "bg-red-500/20 text-red-300",
  approved: "bg-emerald-400/20 text-emerald-300",
  finalized: "bg-green-600/20 text-green-300",
  archived: "bg-slate-500/20 text-slate-400",
};

// app-badge-* CSS classes — used across all tabs.
export const STATUS_BADGE_CLASSES: Record<string, string> = {
  draft: "app-badge-muted",
  assigned: "app-badge-blue-deep",
  in_annotation: "app-badge-blue-light",
  submitted: "app-badge-amber-deep",
  in_qa: "app-badge-amber-light",
  needs_revision: "app-badge-danger",
  rejected: "app-badge-danger",
  approved: "app-badge-green-deep",
  finalized: "app-badge-green-light",
  archived: "app-badge-archived",
};

// Lower number = earlier in pipeline. needs_revision/rejected sit at 0 because
// they pull a parent's derived status down (worst child wins).
export const QA_STATUS_ORDER: Record<string, number> = {
  needs_revision: 0,
  rejected: 0,
  draft: 1,
  assigned: 2,
  in_annotation: 3,
  submitted: 4,
  in_qa: 5,
  approved: 6,
  finalized: 7,
  archived: 8,
};

// Statuses where annotators can edit labels/attributes.
export const EDITABLE_STATUSES = ["needs_revision", "assigned", "in_annotation"] as const;

// Statuses where annotators see a read-only view.
export const READ_ONLY_STATUSES = ["submitted", "in_qa", "approved", "finalized", "archived"] as const;

// Annotator-perspective "complete" — work has left their queue.
export const ANNOTATOR_DONE_STATUSES = ["submitted", "in_qa", "approved", "finalized", "archived"] as const;

// Statuses excluded from the QA pipeline overview (kanban + filter dropdown).
export const QA_PIPELINE_EXCLUDED = ["draft", "archived"] as const;

export function statusLabel(status: string | null | undefined): string {
  return STATUS_LABELS[status || "draft"] || (status ?? "Draft");
}

export function statusColor(status: string | null | undefined): string {
  return STATUS_COLORS[status || "draft"] || STATUS_COLORS.draft;
}

export function statusBadgeClass(status: string | null | undefined): string {
  return STATUS_BADGE_CLASSES[status || "draft"] || STATUS_BADGE_CLASSES.draft;
}

export function isEditableStatus(status: string | null | undefined): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status || "");
}

export function isReadOnlyStatus(status: string | null | undefined): boolean {
  return (READ_ONLY_STATUSES as readonly string[]).includes(status || "");
}

// Derived parent status: worst child status wins (needs_revision drags down).
export function derivedParentStatus(childStatuses: string[]): string {
  if (!childStatuses.length) return "draft";
  let minVal = Infinity;
  let minStatus = "draft";
  for (const s of childStatuses) {
    const v = QA_STATUS_ORDER[s || "draft"] ?? 1;
    if (v < minVal) {
      minVal = v;
      minStatus = s || "draft";
    }
  }
  return minStatus;
}
