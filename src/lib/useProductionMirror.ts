"use client";

import { useEffect, useState } from "react";
import type { PromptComposition, ProductionSnapshot, ProvenanceKind, PromptVersion } from "@/types";
import { buildCompositionFromSnapshot, computeProvenanceKind } from "@/lib/productionMirror";
import { compileAggregatePrompt, extractPreamble } from "@/lib/inference/aggregateCompile";

/**
 * Shared production-mirror state + handlers (Slice S2), used by both the
 * prompt-version form and the Production Replication detection-creation mode.
 * `active` gates the network effects so the hook is inert until production
 * mode is selected. `targetDescription` is the caller's compiled target
 * wording; handlers close over its latest value each render.
 */
export function useProductionMirror({
  active,
  initialData,
  productionLabel,
  targetDescription,
}: {
  active: boolean;
  initialData?: Partial<PromptVersion>;
  productionLabel?: string | null;
  targetDescription: string;
}) {
  const [contextNames, setContextNames] = useState<string[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>(initialData?.context_name || "");
  const [snapshot, setSnapshot] = useState<ProductionSnapshot | null>(null);
  const [composition, setComposition] = useState<PromptComposition | null>(
    (initialData?.composition as PromptComposition | undefined) || null
  );
  const [targetSource, setTargetSource] = useState<"baseline" | "structured">(
    ((initialData?.composition as PromptComposition | undefined)?.target_source as "baseline" | "structured") ||
      "baseline"
  );
  const [targetLabel, setTargetLabel] = useState<string>(initialData?.production_label || productionLabel || "");
  const [targetMatched, setTargetMatched] = useState(false);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState("");

  useEffect(() => {
    if (!active || contextNames.length > 0) return;
    fetch("/api/admin/contexts")
      .then((r) => r.json())
      .then((d) => setContextNames(Array.isArray(d?.names) ? d.names : []))
      .catch(() => setContextNames([]));
  }, [active, contextNames.length]);

  // When seeded from an existing production version, load its frozen snapshot so
  // the target/members/preview render — without rebuilding the seeded composition.
  useEffect(() => {
    const snapId = initialData?.production_snapshot_id;
    if (!active || !snapId || snapshot) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/contexts/snapshot?snapshot_id=${encodeURIComponent(snapId)}`);
        const data = await res.json();
        const snap = data?.snapshot as ProductionSnapshot | undefined;
        if (cancelled || !snap) return;
        setSnapshot(snap);
        setTargetMatched(!!targetLabel && snap.ordered_members.some((m) => m.label === targetLabel));
      } catch {
        /* leave snapshot unset; user can re-select the context */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provenance: ProvenanceKind | null =
    snapshot && composition
      ? computeProvenanceKind(snapshot, composition)
      : (initialData?.provenance_kind as ProvenanceKind | undefined) || null;

  const selectContext = async (name: string) => {
    setSelectedContext(name);
    setComposition(null);
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
      const snap = data.snapshot as ProductionSnapshot;
      setSnapshot(snap);
      const matched = !!targetLabel && snap.ordered_members.some((m) => m.label === targetLabel);
      setTargetMatched(matched);
      const src: "baseline" | "structured" = matched ? "baseline" : "structured";
      setTargetSource(src);
      setComposition(buildCompositionFromSnapshot(snap, { targetLabel, targetDescription, targetSource: src }));
    } catch (e) {
      setCtxError(e instanceof Error ? e.message : "Failed to import context snapshot");
    } finally {
      setCtxLoading(false);
    }
  };

  const changeTargetLabel = (label: string) => {
    setTargetLabel(label);
    if (!snapshot) return;
    const matched = snapshot.ordered_members.some((m) => m.label === label);
    setTargetMatched(matched);
    const src: "baseline" | "structured" = matched ? "baseline" : "structured";
    setTargetSource(src);
    setComposition(buildCompositionFromSnapshot(snapshot, { targetLabel: label, targetDescription, targetSource: src }));
  };

  const toggleMember = (index: number) => {
    setComposition((prev) =>
      prev
        ? { ...prev, members: prev.members.map((m, i) => (i === index && !m.is_target ? { ...m, enabled: !m.enabled } : m)) }
        : prev
    );
  };

  const toggleSupport = (index: number) => {
    setComposition((prev) =>
      prev
        ? { ...prev, members: prev.members.map((m, i) => (i === index && !m.is_target ? { ...m, is_support: !m.is_support } : m)) }
        : prev
    );
  };

  const editMemberDescription = (index: number, description: string) => {
    setComposition((prev) =>
      prev ? { ...prev, members: prev.members.map((m, i) => (i === index ? { ...m, description } : m)) } : prev
    );
  };

  const addMember = (label: string, description: string) => {
    const l = label.trim();
    if (!l) return;
    setComposition((prev) => {
      if (!prev) return prev;
      if (prev.members.some((m) => m.label === l)) return prev;
      const next = [
        ...prev.members,
        { role: "detection" as const, label: l, description, position: 0, enabled: true, is_target: false },
      ].map((m, i) => ({ ...m, position: i + 1 }));
      return { ...prev, members: next };
    });
  };

  const removeMember = (index: number) => {
    setComposition((prev) =>
      prev ? { ...prev, members: prev.members.filter((_, i) => i !== index).map((m, i) => ({ ...m, position: i + 1 })) } : prev
    );
  };

  const editTargetDescription = (text: string) => {
    setComposition((prev) =>
      prev
        ? { ...prev, target_source: "structured", members: prev.members.map((m) => (m.is_target ? { ...m, description: text } : m)) }
        : prev
    );
    setTargetSource("structured");
  };

  const resetTargetToBaseline = () => {
    if (!snapshot) return;
    const frozen = snapshot.ordered_members.find((m) => m.label === targetLabel);
    if (!frozen) return;
    setComposition((prev) =>
      prev
        ? { ...prev, target_source: "baseline", members: prev.members.map((m) => (m.is_target ? { ...m, description: frozen.description } : m)) }
        : prev
    );
    setTargetSource("baseline");
  };

  const currentTargetDescription = composition?.members.find((m) => m.is_target)?.description ?? "";
  const currentPreamble = composition?.preamble ?? (snapshot ? extractPreamble(snapshot.built_prompt) : "");
  const editPreamble = (text: string) => {
    setComposition((prev) => (prev ? { ...prev, preamble: text } : prev));
  };
  const resetPreamble = () => {
    if (!snapshot) return;
    setComposition((prev) => (prev ? { ...prev, preamble: extractPreamble(snapshot.built_prompt) } : prev));
  };
  const compiledPreview =
    snapshot && composition
      ? compileAggregatePrompt(
          composition.preamble ?? extractPreamble(snapshot.built_prompt),
          composition.members.filter((m) => m.enabled).map((m) => ({ label: m.label, description: m.description }))
        )
      : "";

  const reset = () => {
    setSelectedContext("");
    setSnapshot(null);
    setComposition(null);
    setTargetSource("baseline");
    setTargetLabel(productionLabel || "");
    setTargetMatched(false);
    setCtxLoading(false);
    setCtxError("");
  };

  return {
    contextNames,
    selectedContext,
    selectContext,
    snapshot,
    composition,
    provenance,
    ctxLoading,
    ctxError,
    setCtxError,
    targetLabel,
    changeTargetLabel,
    targetMatched,
    targetSource,
    currentTargetDescription,
    editTargetDescription,
    resetTargetToBaseline,
    currentPreamble,
    editPreamble,
    resetPreamble,
    toggleMember,
    toggleSupport,
    editMemberDescription,
    addMember,
    removeMember,
    compiledPreview,
    reset,
  };
}
