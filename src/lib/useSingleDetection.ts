"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionSnapshot, PromptComposition } from "@/types";
import { buildSingleDetectionComposition } from "@/lib/productionMirror";
import { compileAggregatePrompt, extractPreamble } from "@/lib/inference/aggregateCompile";

/**
 * State + handlers for authoring a SINGLE DETECTION (PC-001). A single detection
 * runs exactly like a production-context aggregate but over one member: the
 * shared instructions (preamble) come from a selected production context's
 * frozen snapshot, followed by one detection block built from the Detection
 * Prompt. The production label is the block's label and the label whose presence
 * means DETECTED.
 */
export function useSingleDetection({
  active,
  initial,
}: {
  active: boolean;
  initial?: {
    context_name?: string | null;
    production_label?: string | null;
    composition?: PromptComposition | null;
    production_snapshot_id?: string | null;
  };
}) {
  const [contextNames, setContextNames] = useState<string[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>(initial?.context_name || "");
  const [snapshot, setSnapshot] = useState<ProductionSnapshot | null>(null);
  const [productionLabel, setProductionLabel] = useState<string>(initial?.production_label || "");
  const [detectionPrompt, setDetectionPrompt] = useState<string>(
    initial?.composition?.members?.find((m) => m.is_target)?.description || ""
  );
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState("");

  useEffect(() => {
    if (!active || contextNames.length > 0) return;
    fetch("/api/admin/contexts")
      .then((r) => r.json())
      .then((d) => setContextNames(Array.isArray(d?.names) ? d.names : []))
      .catch(() => setContextNames([]));
  }, [active, contextNames.length]);

  // When seeded from an existing single-detection version, load its frozen
  // snapshot so the preamble/preview render.
  useEffect(() => {
    const snapId = initial?.production_snapshot_id;
    if (!active || !snapId || snapshot) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/contexts/snapshot?snapshot_id=${encodeURIComponent(snapId)}`);
        const data = await res.json();
        const snap = data?.snapshot as ProductionSnapshot | undefined;
        if (!cancelled && snap) setSnapshot(snap);
      } catch {
        /* leave snapshot unset; user can re-select the context */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectContext = async (name: string) => {
    setSelectedContext(name);
    setSnapshot(null);
    if (!name) return;
    setCtxLoading(true);
    setCtxError("");
    try {
      const res = await fetch("/api/admin/contexts/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_name: name }),
      });
      const data = await res.json();
      if (!res.ok || !data?.snapshot) throw new Error(data?.error || "Failed to import context snapshot");
      setSnapshot(data.snapshot as ProductionSnapshot);
    } catch (e) {
      setCtxError(e instanceof Error ? e.message : "Failed to import context snapshot");
    } finally {
      setCtxLoading(false);
    }
  };

  const preamble = useMemo(
    () => (snapshot ? extractPreamble(snapshot.built_prompt) : ""),
    [snapshot]
  );

  const composition: PromptComposition | null = useMemo(() => {
    if (!snapshot) return null;
    return buildSingleDetectionComposition(snapshot, {
      label: productionLabel,
      description: detectionPrompt,
    });
  }, [snapshot, productionLabel, detectionPrompt]);

  const compiledPreview = useMemo(() => {
    if (!snapshot) return "";
    return compileAggregatePrompt(preamble, [
      { label: productionLabel.trim() || "(production label)", description: detectionPrompt },
    ]);
  }, [snapshot, preamble, productionLabel, detectionPrompt]);

  const reset = () => {
    setSelectedContext("");
    setSnapshot(null);
    setProductionLabel("");
    setDetectionPrompt("");
    setCtxError("");
  };

  return {
    contextNames,
    selectedContext,
    selectContext,
    snapshot,
    ctxLoading,
    ctxError,
    productionLabel,
    setProductionLabel,
    detectionPrompt,
    setDetectionPrompt,
    preamble,
    composition,
    compiledPreview,
    reset,
  };
}
