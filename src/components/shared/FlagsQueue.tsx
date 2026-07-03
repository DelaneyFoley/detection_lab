"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Flag, CheckCircle2 } from "lucide-react";
import type { ReviewFlag } from "@/types";

interface FlagsQueueProps {
  openFlags: ReviewFlag[];
  resolvedFlags: ReviewFlag[];
  onOpenFlagClick: (flag: ReviewFlag, index: number) => void;
  onResolvedFlagClick: (flag: ReviewFlag, index: number) => void;
  renderFlagSubtitle?: (flag: ReviewFlag) => React.ReactNode;
  loading?: boolean;
}

export default function FlagsQueue({
  openFlags,
  resolvedFlags,
  onOpenFlagClick,
  onResolvedFlagClick,
  renderFlagSubtitle,
  loading,
}: FlagsQueueProps) {
  const [openCollapsed, setOpenCollapsed] = useState(false);
  const [resolvedCollapsed, setResolvedCollapsed] = useState(true);
  const [openPage, setOpenPage] = useState(1);
  const [resolvedPage, setResolvedPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const openPageCount = Math.max(1, Math.ceil(openFlags.length / pageSize));
  const resolvedPageCount = Math.max(1, Math.ceil(resolvedFlags.length / pageSize));

  const paginatedOpen = openFlags.slice((openPage - 1) * pageSize, openPage * pageSize);
  const paginatedResolved = resolvedFlags.slice((resolvedPage - 1) * pageSize, resolvedPage * pageSize);

  if (loading) return <p className="text-sm text-[var(--app-text-muted)]">Loading flags...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <select
          className="app-select px-2 py-1 text-[11px]"
          style={{ width: "10%" }}
          value={pageSize}
          onChange={(e) => { setPageSize(parseInt(e.target.value)); setOpenPage(1); setResolvedPage(1); }}
        >
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
        </select>
      </div>

      {/* Open Flags Section */}
      <div className="app-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setOpenCollapsed(!openCollapsed)}
            className="flex items-center gap-2 text-left hover:opacity-80"
          >
            {openCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" />}
            <span className="text-sm font-medium text-[var(--app-text)]">Open Flags</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">{openFlags.length}</span>
          </button>
        </div>
        {!openCollapsed && (
          <div className="border-t border-[var(--app-border)]">
            {openFlags.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--app-text-muted)]">No open flags.</p>
            ) : (
              <>
                <div className="max-h-[400px] overflow-y-auto">
                  {paginatedOpen.map((flag, idx) => {
                    const globalIdx = (openPage - 1) * pageSize + idx;
                    return (
                      <div
                        key={flag.flag_id}
                        className="flex items-center gap-4 px-4 py-3 cursor-pointer border-b border-[var(--app-border)] last:border-b-0 hover:bg-[var(--app-table-row-hover)]"
                        onClick={() => onOpenFlagClick(flag, globalIdx)}
                      >
                        {(flag as any).image_uri ? (
                          <img src={(flag as any).image_uri} alt={flag.image_id} className="h-10 w-10 rounded object-cover border border-[var(--app-border)] shrink-0" />
                        ) : (
                          <div className="h-10 w-10 rounded border border-[var(--app-border)] bg-[var(--app-surface-soft)] flex items-center justify-center shrink-0">
                            <Flag className="h-4 w-4 text-amber-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{flag.image_id}</p>
                            {((flag as any).annotator || (flag as any).dataset_name) && (
                              <span className="text-[10px] text-[var(--app-text-muted)] truncate">
                                {(flag as any).annotator && <span>{(flag as any).annotator}</span>}
                                {(flag as any).annotator && (flag as any).dataset_name && <span> · </span>}
                                {(flag as any).dataset_name && <span>{(flag as any).dataset_name}</span>}
                              </span>
                            )}
                            {renderFlagSubtitle && renderFlagSubtitle(flag)}
                          </div>
                          <p className="mt-1 text-sm text-[var(--app-text)]">{flag.reason}</p>
                          <p className="mt-1 text-[11px] text-[var(--app-text-subtle)]">
                            Flagged {new Date(flag.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="text-xs text-[var(--app-text-subtle)]">Click to review</span>
                      </div>
                    );
                  })}
                </div>
                {openPageCount > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--app-border)] bg-[var(--app-surface-soft)]">
                    <span className="text-[11px] text-[var(--app-text-subtle)]">Page {openPage} of {openPageCount}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setOpenPage((p) => Math.max(1, p - 1))} disabled={openPage <= 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Prev</button>
                      <button onClick={() => setOpenPage((p) => Math.min(openPageCount, p + 1))} disabled={openPage >= openPageCount} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Resolved Flags Section */}
      <div className="app-card overflow-hidden">
        <button
          onClick={() => setResolvedCollapsed(!resolvedCollapsed)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-[var(--app-table-row-hover)]"
        >
          {resolvedCollapsed ? <ChevronRight className="h-4 w-4 text-[var(--app-text-subtle)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-subtle)]" />}
          <span className="text-sm font-medium text-[var(--app-text)]">Resolved Flags</span>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">{resolvedFlags.length}</span>
        </button>
        {!resolvedCollapsed && (
          <div className="border-t border-[var(--app-border)]">
            {resolvedFlags.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--app-text-muted)]">No resolved flags yet.</p>
            ) : (
              <>
                <div className="max-h-[400px] overflow-y-auto">
                  {paginatedResolved.map((flag, idx) => {
                    const globalIdx = (resolvedPage - 1) * pageSize + idx;
                    return (
                      <div
                        key={flag.flag_id}
                        className="flex items-center gap-4 px-4 py-3 border-b border-[var(--app-border)] last:border-b-0 cursor-pointer hover:bg-[var(--app-table-row-hover)]"
                        onClick={() => onResolvedFlagClick(flag, globalIdx)}
                      >
                        {(flag as any).image_uri ? (
                          <img src={(flag as any).image_uri} alt={flag.image_id} className="h-10 w-10 rounded object-cover border border-[var(--app-border)] shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-mono text-[var(--app-text-subtle)] truncate">{flag.image_id}</p>
                            {((flag as any).annotator || (flag as any).dataset_name) && (
                              <span className="text-[10px] text-[var(--app-text-muted)] truncate">
                                {(flag as any).annotator && <span>{(flag as any).annotator}</span>}
                                {(flag as any).annotator && (flag as any).dataset_name && <span> · </span>}
                                {(flag as any).dataset_name && <span>{(flag as any).dataset_name}</span>}
                              </span>
                            )}
                            {renderFlagSubtitle && renderFlagSubtitle(flag)}
                          </div>
                          <p className="mt-1 text-sm text-[var(--app-text)]">{flag.reason}</p>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--app-text-subtle)]">
                            {flag.resolution_action && (
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
                                {flag.resolution_action.replace(/_/g, " ")}
                              </span>
                            )}
                            {(flag as any).resolved_by && <span>by {(flag as any).resolved_by}</span>}
                            {flag.resolution_note && <span className="truncate max-w-[200px]">{flag.resolution_note}</span>}
                            {flag.resolved_at && <span>{new Date(flag.resolved_at).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                          flag.status === "dismissed" ? "bg-gray-500/20 text-gray-400" : "bg-emerald-500/20 text-emerald-300"
                        }`}>
                          {flag.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {resolvedPageCount > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--app-border)] bg-[var(--app-surface-soft)]">
                    <span className="text-[11px] text-[var(--app-text-subtle)]">Page {resolvedPage} of {resolvedPageCount}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setResolvedPage((p) => Math.max(1, p - 1))} disabled={resolvedPage <= 1} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Prev</button>
                      <button onClick={() => setResolvedPage((p) => Math.min(resolvedPageCount, p + 1))} disabled={resolvedPage >= resolvedPageCount} className="app-btn app-btn-subtle app-btn-sm text-xs disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
