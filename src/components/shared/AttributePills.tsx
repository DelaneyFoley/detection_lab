"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CURRENT_USER, reconcileLayout, taxonomyKey } from "@/lib/attributeLayout";

type AttributePillsProps = {
  /** The full set of attribute options for this detection's taxonomy. */
  options: string[];
  /** Currently selected attributes. */
  selected: string[];
  /** Called when a pill is clicked to toggle selection. Omit for read-only. */
  onToggle?: (attr: string) => void;
  /** When true, pills cannot be toggled (still organizable). */
  disabled?: boolean;
  /** Per-user identity the layout is saved under. Defaults to the app user. */
  userKey?: string;
  className?: string;
};

const MIN_SCALE = 0.55;

// Module-level cache so navigating between images / remounting does not refetch
// or flash the default layout. Keyed by `${user}|${taxonomyKey}`.
const layoutCache = new Map<string, string[][]>();

type DropHint = { row: number; index: number } | null;

export function AttributePills({
  options,
  selected,
  onToggle,
  disabled = false,
  userKey = CURRENT_USER,
  className = "",
}: AttributePillsProps) {
  const cleanOptions = useMemo(
    () => Array.from(new Set(options.map((o) => String(o).trim()).filter(Boolean))),
    [options]
  );
  const key = useMemo(() => taxonomyKey(cleanOptions), [cleanOptions]);
  const cacheKey = `${userKey}|${key}`;

  const [rows, setRows] = useState<string[][]>(() => {
    const cached = layoutCache.get(`${userKey}|${key}`);
    return cached ? reconcileLayout(cached, cleanOptions) : reconcileLayout([], cleanOptions);
  });

  // Keep a ref to the latest options so async loads reconcile correctly.
  const optionsRef = useRef(cleanOptions);
  optionsRef.current = cleanOptions;

  const [dragAttr, setDragAttr] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [showNewRow, setShowNewRow] = useState(false);

  // Load saved layout (from cache or server) whenever the user/taxonomy changes.
  useEffect(() => {
    if (cleanOptions.length === 0) {
      setRows([]);
      return;
    }
    const cached = layoutCache.get(cacheKey);
    if (cached) {
      setRows(reconcileLayout(cached, optionsRef.current));
      return;
    }
    let cancelled = false;
    fetch(`/api/attribute-layouts?user=${encodeURIComponent(userKey)}&taxonomy=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const saved: string[][] = Array.isArray(d.layout) ? d.layout : [];
        const reconciled = reconcileLayout(saved, optionsRef.current);
        layoutCache.set(cacheKey, reconciled);
        setRows(reconciled);
      })
      .catch(() => {
        if (!cancelled) setRows(reconcileLayout([], optionsRef.current));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, key, userKey]);

  const persist = useCallback(
    (next: string[][]) => {
      const norm = next.filter((r) => r.length);
      layoutCache.set(cacheKey, norm);
      fetch("/api/attribute-layouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: userKey, taxonomy: key, layout: norm }),
      }).catch(() => {});
    },
    [cacheKey, key, userKey]
  );

  const moveAttr = useCallback(
    (attr: string, targetRow: number, targetIndex: number) => {
      setRows((prev) => {
        // Remove the attribute from its current position, tracking the offset
        // so an intra-row move to a later index stays correct.
        let removedRow = -1;
        let removedIndex = -1;
        const stripped = prev.map((r, ri) => {
          const idx = r.indexOf(attr);
          if (idx !== -1) {
            removedRow = ri;
            removedIndex = idx;
            return r.filter((a) => a !== attr);
          }
          return r;
        });

        let insertRow = targetRow;
        let insertIndex = targetIndex;
        if (removedRow === targetRow && removedIndex < targetIndex) {
          insertIndex -= 1;
        }

        let next: string[][];
        if (insertRow >= stripped.length) {
          next = [...stripped, [attr]];
        } else {
          next = stripped.map((r, ri) => {
            if (ri !== insertRow) return r;
            const copy = [...r];
            copy.splice(Math.max(0, Math.min(copy.length, insertIndex)), 0, attr);
            return copy;
          });
        }
        next = next.filter((r) => r.length);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const endDrag = useCallback(() => {
    setDragAttr(null);
    setDropHint(null);
    setShowNewRow(false);
  }, []);

  if (cleanOptions.length === 0) return null;

  return (
    <div
      className={`space-y-1.5 ${className}`}
      onDragOver={(e) => {
        if (dragAttr) e.preventDefault();
      }}
    >
      {rows.map((row, rowIndex) => (
        <PillRow
          key={rowIndex}
          rowIndex={rowIndex}
          row={row}
          selected={selected}
          disabled={disabled}
          onToggle={onToggle}
          dragAttr={dragAttr}
          dropHint={dropHint}
          onPillDragStart={(attr) => {
            setDragAttr(attr);
            setShowNewRow(true);
          }}
          onPillDragEnd={endDrag}
          onHint={setDropHint}
          onDropAt={(index) => {
            if (dragAttr) moveAttr(dragAttr, rowIndex, index);
            endDrag();
          }}
        />
      ))}

      {showNewRow && dragAttr && (
        <div
          className="rounded-md border border-dashed border-sky-400/40 bg-sky-500/[0.04] px-3 py-2 text-center text-[11px] text-sky-200/70"
          onDragOver={(e) => {
            e.preventDefault();
            setDropHint({ row: rows.length, index: 0 });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragAttr) moveAttr(dragAttr, rows.length, 0);
            endDrag();
          }}
        >
          Drop here to start a new row
        </div>
      )}
    </div>
  );
}

type PillRowProps = {
  rowIndex: number;
  row: string[];
  selected: string[];
  disabled: boolean;
  onToggle?: (attr: string) => void;
  dragAttr: string | null;
  dropHint: DropHint;
  onPillDragStart: (attr: string) => void;
  onPillDragEnd: () => void;
  onHint: (hint: DropHint) => void;
  onDropAt: (index: number) => void;
};

function PillRow({
  rowIndex,
  row,
  selected,
  disabled,
  onToggle,
  dragAttr,
  dropHint,
  onPillDragStart,
  onPillDragEnd,
  onHint,
  onDropAt,
}: PillRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Shrink pills to fit when a single row overflows its available width.
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      el.style.setProperty("--pill-scale", "1");
      const needed = el.scrollWidth;
      const avail = el.clientWidth;
      let scale = 1;
      if (needed > avail + 1 && needed > 0) {
        scale = Math.max(MIN_SCALE, avail / needed);
      }
      el.style.setProperty("--pill-scale", String(scale));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [row]);

  return (
    <div
      ref={rowRef}
      className="flex flex-nowrap items-center overflow-hidden"
      style={{
        gap: "calc(0.5rem * var(--pill-scale, 1))",
        // @ts-expect-error custom property
        "--pill-scale": 1,
      }}
      onDragOver={(e) => {
        if (!dragAttr) return;
        e.preventDefault();
        // Dropping on the row's empty tail appends to the end.
        onHint({ row: rowIndex, index: row.length });
      }}
      onDrop={(e) => {
        if (!dragAttr) return;
        e.preventDefault();
        onDropAt(row.length);
      }}
    >
      {row.map((attr, index) => {
        const isSelected = selected.includes(attr);
        const showBefore = dropHint && dropHint.row === rowIndex && dropHint.index === index;
        return (
          <div key={attr} className="flex items-center" style={{ gap: 0 }}>
            {showBefore && <span className="mr-1 h-4 w-0.5 rounded bg-sky-400" aria-hidden />}
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", attr);
                onPillDragStart(attr);
              }}
              onDragEnd={onPillDragEnd}
              onDragOver={(e) => {
                if (!dragAttr) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                onHint({ row: rowIndex, index: after ? index + 1 : index });
              }}
              onDrop={(e) => {
                if (!dragAttr) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                onDropAt(after ? index + 1 : index);
              }}
              onClick={() => {
                if (!disabled) onToggle?.(attr);
              }}
              disabled={disabled && !onToggle}
              title={disabled ? attr : "Click to toggle · drag to organize"}
              className={`shrink-0 cursor-grab whitespace-nowrap rounded-md border transition active:cursor-grabbing ${
                isSelected
                  ? "border-sky-400/50 bg-sky-500/12 text-sky-100"
                  : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]"
              } ${dragAttr === attr ? "opacity-40" : ""}`}
              style={{
                fontSize: "calc(0.6875rem * var(--pill-scale, 1))",
                padding: "calc(0.28em) calc(0.62em)",
                lineHeight: 1.2,
              }}
            >
              {attr}
            </button>
          </div>
        );
      })}
      {dropHint && dropHint.row === rowIndex && dropHint.index === row.length && (
        <span className="ml-1 h-4 w-0.5 rounded bg-sky-400" aria-hidden />
      )}
    </div>
  );
}
