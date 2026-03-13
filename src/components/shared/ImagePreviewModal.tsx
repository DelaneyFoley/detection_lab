"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type ImagePreviewModalProps = {
  isOpen: boolean;
  imageUrl: string;
  imageAlt: string;
  title?: string;
  subtitle?: string;
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  details?: ReactNode;
  detailsClassName?: string;
};

export function ImagePreviewModal({
  isOpen,
  imageUrl,
  imageAlt,
  title,
  subtitle,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  details,
  detailsClassName = "",
}: ImagePreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imageNatural, setImageNatural] = useState({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const canPrev = useMemo(() => !!onPrev && index > 0, [onPrev, index]);
  const canNext = useMemo(() => !!onNext && index < total - 1, [onNext, index, total]);

  const clampedPan = useMemo(() => {
    const viewport = viewportRef.current;
    if (!viewport || imageNatural.width <= 0 || imageNatural.height <= 0) return { x: 0, y: 0 };
    const viewportW = viewport.clientWidth;
    const viewportH = viewport.clientHeight;
    if (viewportW <= 0 || viewportH <= 0) return { x: 0, y: 0 };

    const imageRatio = imageNatural.width / imageNatural.height;
    const viewportRatio = viewportW / viewportH;
    let baseW = viewportW;
    let baseH = viewportH;
    if (imageRatio > viewportRatio) {
      baseH = viewportW / imageRatio;
    } else {
      baseW = viewportH * imageRatio;
    }

    const scaledW = baseW * zoom;
    const scaledH = baseH * zoom;
    const maxX = Math.max(0, (scaledW - viewportW) / 2);
    const maxY = Math.max(0, (scaledH - viewportH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y)),
    };
  }, [imageNatural.height, imageNatural.width, pan.x, pan.y, zoom]);

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    dragStartRef.current = null;
    dialogRef.current?.focus();
  }, [isOpen, imageUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && canPrev) {
        event.preventDefault();
        onPrev?.();
      } else if ((event.key === "ArrowRight" || event.key === "ArrowDown") && canNext) {
        event.preventDefault();
        onNext?.();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((z) => Math.min(4, z + 0.25));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom((z) => Math.max(1, z - 0.25));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, canPrev, canNext, onClose, onPrev, onNext]);

  useEffect(() => {
    const onMouseUp = () => {
      setDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 md:p-6">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close preview" />
      <div
        className="relative z-10 w-full max-w-7xl max-h-[calc(100vh-3rem)] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-4 my-auto"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--app-text-subtle)]">Image Preview</div>
            <div className="mt-1 text-xs text-gray-400">
            {title || "Image Preview"} · {Math.max(0, index) + 1}/{total}
            {subtitle ? ` · ${subtitle}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="app-btn app-btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
              disabled={!canPrev}
              onClick={onPrev}
            >
              Prev
            </button>
            <button
              className="app-btn app-btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
              disabled={!canNext}
              onClick={onNext}
            >
              Next
            </button>
            <button
              className="app-btn app-btn-secondary px-3 py-1.5 text-xs"
              onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            >
              Zoom -
            </button>
            <button
              className="app-btn app-btn-secondary px-3 py-1.5 text-xs"
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            >
              Zoom +
            </button>
            <button
              className="app-btn app-btn-secondary px-3 py-1.5 text-xs"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              Reset
            </button>
            <button className="app-btn app-btn-primary px-3 py-1.5 text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className={details ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]" : ""}>
          <div
            ref={viewportRef}
            className="flex h-[52vh] items-center justify-center overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-2 lg:h-[70vh]"
            onMouseDown={(event) => {
              if (zoom <= 1) return;
              event.preventDefault();
              dragStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
              setDragging(true);
            }}
            onMouseMove={(event) => {
              if (!dragStartRef.current || !dragging || zoom <= 1) return;
              const dx = event.clientX - dragStartRef.current.x;
              const dy = event.clientY - dragStartRef.current.y;
              setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
            }}
            onMouseUp={() => {
              setDragging(false);
              dragStartRef.current = null;
            }}
            onMouseLeave={() => {
              setDragging(false);
              dragStartRef.current = null;
            }}
            style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
          >
            <img
              src={imageUrl}
              alt={imageAlt}
              className="max-h-[calc(52vh-1rem)] w-full origin-center select-none rounded object-contain lg:max-h-[calc(70vh-1rem)]"
              style={{
                transform: `translate(${clampedPan.x}px, ${clampedPan.y}px) scale(${zoom})`,
                willChange: "transform",
                backfaceVisibility: "hidden",
              }}
              onLoad={(event) => {
                const img = event.currentTarget;
                setImageNatural({
                  width: img.naturalWidth || 0,
                  height: img.naturalHeight || 0,
                });
              }}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
            />
          </div>
          {details && (
            <div className={`max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-xs ${detailsClassName}`}>
              {details}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
