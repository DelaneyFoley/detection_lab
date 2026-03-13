"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function InfoTip({
  label = "More info",
  children,
  align = "left",
  widthClass = "w-72",
}: {
  label?: string;
  children: ReactNode;
  align?: "left" | "right";
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const positionClass = align === "right" ? "right-0" : "left-0";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] text-[var(--app-text-subtle)] transition hover:border-[rgba(165,189,218,0.46)] hover:text-[var(--app-text)]"
      >
        <Info className="h-3 w-3" />
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute top-6 ${positionClass} z-20 ${widthClass} rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface-strong)] p-3 text-[11px] leading-5 text-[var(--app-text-muted)] shadow-2xl transition-all ${
          open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
