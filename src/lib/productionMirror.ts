import type {
  CompositionMember,
  ProductionSnapshot,
  PromptComposition,
  ProvenanceKind,
} from "@/types";
import { extractPreamble } from "@/lib/inference/aggregateCompile";

/**
 * Build the composition for a SINGLE DETECTION version (PC-001). A single
 * detection runs exactly like a production-context aggregate, but over a single
 * member: the shared preamble (user prompt shared instructions) extracted from
 * the selected context's frozen snapshot, followed by one detection block. The
 * target label is the detection's production label and DETECTED means that label
 * is returned. No sibling members, no system prompt, no decision policy/rubric.
 */
export function buildSingleDetectionComposition(
  snapshot: ProductionSnapshot,
  params: { label: string; description: string }
): PromptComposition {
  const label = String(params.label || "").trim();
  return {
    context_name: snapshot.context_name,
    google_model: snapshot.google_model,
    thinking_level: snapshot.thinking_level,
    preamble: extractPreamble(snapshot.built_prompt),
    target_source: "structured",
    multi_label: false,
    members: [
      {
        role: "detection",
        label,
        description: String(params.description || ""),
        position: 1,
        enabled: true,
        is_target: true,
      },
    ],
  };
}

/**
 * Pure production-mirror helpers (Slice S2).
 *
 * These compute the editable aggregate composition from an immutable production
 * snapshot and determine a version's provenance relative to that snapshot.
 * Provenance rule (D8/D9): a version is an EXACT mirror when every non-target
 * member, its order, and the pinned params (model + thinking level) are
 * byte-identical to the snapshot. The target detection may be freely authored
 * or inserted without breaking exact-mirror status; only non-target changes
 * make it a MODIFIED mirror.
 */

export type SnapshotMemberInput = {
  role: CompositionMember["role"];
  label: string;
  description: string;
  position: number;
};

/** Normalize a raw compiled/snapshot member into a CompositionMember. */
export function toCompositionMember(
  m: SnapshotMemberInput,
  opts: { enabled?: boolean; isTarget?: boolean } = {}
): CompositionMember {
  return {
    role: m.role,
    label: m.label,
    description: m.description,
    position: m.position,
    enabled: opts.enabled ?? true,
    is_target: opts.isTarget ?? false,
  };
}

/**
 * Build the initial editable composition for a PRODUCTION_MODE version from a
 * frozen snapshot. If `targetLabel` matches a production member, that member is
 * flagged as the target. Otherwise (target not yet in production) a new target
 * member is inserted at `targetInsertPosition` (1-based; defaults to the end).
 *
 * `targetSource` controls the target member's wording:
 * - "baseline": keep the frozen production description (true-baseline runs).
 * - "structured": use the lab's compiled structured fields (development runs).
 * A newly-inserted target has no frozen description, so it is always structured.
 */
export function buildCompositionFromSnapshot(
  snapshot: ProductionSnapshot,
  params: {
    targetLabel: string | null | undefined;
    targetDescription: string;
    targetInsertPosition?: number | null;
    targetSource?: "baseline" | "structured";
  }
): PromptComposition {
  const targetLabel = (params.targetLabel || "").trim();
  const requestedSource = params.targetSource ?? "structured";
  const base = snapshot.ordered_members.map((m) =>
    toCompositionMember(m, {
      isTarget: !!targetLabel && m.label === targetLabel,
      enabled: true,
    })
  );

  const alreadyPresent = base.some((m) => m.is_target);
  let members: CompositionMember[];
  let effectiveSource: "baseline" | "structured" | undefined = requestedSource;

  if (!targetLabel) {
    // No target designated yet (detection has no production label).
    members = base;
    effectiveSource = undefined;
  } else if (alreadyPresent) {
    // Existing production detection: keep frozen text (baseline) or use the
    // lab's structured fields (structured).
    members = base.map((m) =>
      m.is_target
        ? { ...m, description: requestedSource === "baseline" ? m.description : params.targetDescription }
        : m
    );
  } else {
    // New detection not yet in production: insert the target member (D6/D7).
    // A brand-new target has no frozen description, so it is always structured.
    effectiveSource = "structured";
    const inserted = toCompositionMember(
      {
        role: "detection",
        label: targetLabel,
        description: params.targetDescription,
        position: 0,
      },
      { isTarget: true, enabled: true }
    );
    const insertAt =
      params.targetInsertPosition && params.targetInsertPosition > 0
        ? Math.min(params.targetInsertPosition - 1, base.length)
        : base.length;
    members = [...base.slice(0, insertAt), inserted, ...base.slice(insertAt)];
  }

  return {
    context_name: snapshot.context_name,
    google_model: snapshot.google_model,
    thinking_level: snapshot.thinking_level,
    members: renumber(members),
    target_source: effectiveSource,
  };
}

/** Reassign 1-based positions in current array order. */
export function renumber(members: CompositionMember[]): CompositionMember[] {
  return members.map((m, i) => ({ ...m, position: i + 1 }));
}

/**
 * Apply accepted Prompt-Feedback edits (PC-002) to a Detection Prompt. Each edit
 * is an exact `old_text -> new_text` replacement (first occurrence), matching how
 * the single-detection feedback analyzer is instructed to anchor its edits.
 */
export function applyDetectionPromptEdits(
  current: string,
  edits: Array<{ old_text: string; new_text: string }>
): string {
  let out = String(current || "");
  for (const edit of edits) {
    if (edit && edit.old_text) {
      out = out.replace(edit.old_text, edit.new_text);
    }
  }
  return out;
}

/** Return a copy of a composition with the target member's description replaced. */
export function withTargetDescription(
  composition: PromptComposition,
  description: string
): PromptComposition {
  return {
    ...composition,
    members: composition.members.map((m) => (m.is_target ? { ...m, description } : m)),
  };
}

function nonTargetSignature(
  members: Array<SnapshotMemberInput | CompositionMember>,
  excludeLabel: string | null
): string {
  return JSON.stringify(
    members
      .filter((m) => !("is_target" in m) || !m.is_target)
      .filter((m) => !("enabled" in m) || m.enabled !== false)
      .filter((m) => excludeLabel == null || m.label !== excludeLabel)
      .map((m) => ({ role: m.role, label: m.label, description: m.description }))
  );
}

/**
 * Determine whether a version's composition is an exact or modified mirror of
 * its snapshot. Only non-target members and pinned params are compared; target
 * edits/insertions never flip an exact mirror to modified. The target label is
 * excluded from BOTH sides so the target's own wording is ignored.
 */
export function computeProvenanceKind(
  snapshot: ProductionSnapshot,
  composition: PromptComposition
): ProvenanceKind {
  const targetMember = composition.members.find((m) => m.is_target);
  const targetLabel = targetMember?.label ?? null;

  const snapshotSig = nonTargetSignature(snapshot.ordered_members, targetLabel);
  const compositionSig = nonTargetSignature(composition.members, targetLabel);
  const snapshotPreamble = extractPreamble(snapshot.built_prompt);
  const preambleMatch = (composition.preamble ?? snapshotPreamble) === snapshotPreamble;
  const paramsMatch =
    composition.google_model === snapshot.google_model &&
    composition.thinking_level === snapshot.thinking_level;

  return snapshotSig === compositionSig && paramsMatch && preambleMatch ? "exact_replication" : "modified_replication";
}

/**
 * Compile the target detection's structured fields into a single production-style
 * member description (option b). Mirrors how production represents a detection as
 * one freeform `description` while preserving the lab's structured authoring.
 */
export function compileTargetMemberDescription(input: {
  labelPolicy?: string | null;
  decisionRubric?: string | null;
  userPromptAddendum?: string | null;
  fixedGuidance?: string | null;
}): string {
  const labelPolicy = String(input.labelPolicy || "").trim();
  const rubric = String(input.decisionRubric || "").trim();
  const addendum = String(input.userPromptAddendum || "").trim();
  const fixed = String(input.fixedGuidance || "").trim();

  return [
    labelPolicy ? `Decision Policy:\n${labelPolicy}` : "",
    rubric ? `Decision Rubric:\n${rubric}` : "",
    fixed ? `Detection Guidelines (fixed):\n${fixed}` : "",
    addendum ? `Detection-Specific Addendum:\n${addendum}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
