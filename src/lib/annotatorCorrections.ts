// Pure, DB-independent derivation of a single image's correction record for an
// annotator's archived dataset. Kept separate from the repository so it can be
// exhaustively unit-tested. A "correction" is only what QA review or discrepancy
// review changed; the annotator's own self-revisions between submissions never
// appear here (they leave no QA/discrepancy record), so they are never counted.

export interface StageCorrection {
  label_corrected: boolean;
  label_from: string | null;
  label_to: string | null;
  added_tags: string[];
  removed_tags: string[];
  /** False when a QA outcome flagged attribute changes without a stored diff. */
  attr_detail_known: boolean;
}

export interface AnnotatorCorrection {
  image_id: string;
  stages: string[];
  qa: StageCorrection | null;
  discrepancy: StageCorrection | null;
  annotator_label: string | null;
  annotator_tags: string[];
  final_label: string | null;
  final_tags: string[];
  label_corrected: boolean;
  label_from: string | null;
  label_to: string | null;
  attr_corrected: boolean;
  added_tags: string[];
  removed_tags: string[];
  attr_detail_known: boolean;
  /** Number of surviving reviewer corrections to the label across the lifecycle
   * (0, 1, or more when the annotator was corrected in multiple spans). */
  label_correction_count: number;
  /** Total surviving reviewer attribute corrections across the lifecycle. */
  attribute_correction_count: number;
}

export interface QaSampleInput {
  /** 'label_corrected' | 'attributes_corrected' | 'both_corrected' */
  outcome: string;
  original_label: string | null;
  corrected_label: string | null;
  original_tags: string[] | null;
  corrected_tags: string[] | null;
}

export interface DiscrepancyInput {
  resolved_label: string | null;
  corrected_tags: string[] | null;
}

export interface ImageCorrectionInput {
  /** Non-accepted QA samples for the image, earliest attempt first. */
  qaSamples: QaSampleInput[];
  /** The n-way discrepancy resolution for the image, or null. */
  discrepancy: DiscrepancyInput | null;
  /** The child's currently stored value (post-QA, post any self-revision). */
  childCurrent: { label: string | null; tags: string[] };
  /** The finalized master value. */
  parentFinal: { label: string | null; tags: string[] };
  excludeAttributes: boolean;
}

interface StageAcc {
  labelCorrected: boolean;
  labelFrom: string | null;
  labelTo: string | null;
  added: Set<string>;
  removed: Set<string>;
  attrDetailKnown: boolean;
  origLabel: string | null;
  origTags: string[] | null;
}

const newStage = (): StageAcc => ({
  labelCorrected: false, labelFrom: null, labelTo: null,
  added: new Set(), removed: new Set(), attrDetailKnown: true,
  origLabel: null, origTags: null,
});

const stageHasCorrection = (s: StageAcc): boolean =>
  s.labelCorrected || s.added.size > 0 || s.removed.size > 0 || !s.attrDetailKnown;

const toStage = (s: StageAcc): StageCorrection => ({
  label_corrected: s.labelCorrected,
  label_from: s.labelFrom,
  label_to: s.labelTo,
  added_tags: [...s.added],
  removed_tags: [...s.removed],
  attr_detail_known: s.attrDetailKnown,
});

// ── Provenance / span accounting ────────────────────────────────────────────
// A single field's timeline is a list of authored values. An annotator event
// starts a new "span" (the annotator-authored baseline for that span); reviewer
// events change the value within the span. A span is charged (one correction)
// only when a reviewer's change SURVIVES to the end of the span (i.e. the last
// reviewer value in the span differs from that span's annotator baseline). So
// reviewer-undoes-reviewer within one span nets to zero, while an annotator
// edit between two reviewer changes yields two separately-charged spans.
type FieldEvent = { actor: "ann" | "rev"; val: string };
const lv = (s: string | null): string => (s == null ? "\u0000" : s);

function countCharges(events: FieldEvent[]): number {
  let charges = 0;
  let baseline: string | null = null;
  let lastRev: string | null = null;
  let open = false;
  for (const e of events) {
    if (e.actor === "ann") {
      if (open && lastRev !== null && lastRev !== baseline) charges++;
      baseline = e.val;
      lastRev = null;
      open = true;
    } else {
      lastRev = e.val;
    }
  }
  if (open && lastRev !== null && lastRev !== baseline) charges++;
  return charges;
}

/** Returns the correction record for one image, or null if neither QA nor
 * discrepancy review left a surviving change the annotator is charged for. */
export function deriveImageCorrection(input: ImageCorrectionInput): Omit<AnnotatorCorrection, "image_id"> | null {
  const { qaSamples, discrepancy, childCurrent, parentFinal, excludeAttributes } = input;

  // ── QA stage (earliest attempt records the annotator's true submission) ──
  let qa: StageAcc | null = null;
  for (const s of qaSamples) {
    if (!qa) qa = newStage();
    if (qa.origLabel == null && s.original_label != null) qa.origLabel = s.original_label;
    if (qa.origTags == null && s.original_tags != null) qa.origTags = [...s.original_tags];
    const labelOutcome = s.outcome === "label_corrected" || s.outcome === "both_corrected";
    const attrOutcome = s.outcome === "attributes_corrected" || s.outcome === "both_corrected";
    if (labelOutcome) {
      const detailPresent = s.original_label != null && s.corrected_label != null;
      if (!detailPresent || s.original_label !== s.corrected_label) {
        qa.labelCorrected = true;
        if (detailPresent) {
          if (qa.labelFrom == null) qa.labelFrom = s.original_label;
          qa.labelTo = s.corrected_label;
        }
      }
    }
    if (attrOutcome && !excludeAttributes) {
      if (s.original_tags != null && s.corrected_tags != null) {
        const orig = new Set(s.original_tags);
        const corr = new Set(s.corrected_tags);
        for (const t of corr) if (!orig.has(t)) qa.added.add(t);
        for (const t of orig) if (!corr.has(t)) qa.removed.add(t);
      } else {
        qa.attrDetailKnown = false;
      }
    }
  }

  // ── Discrepancy stage (charge only where the child differs from resolved) ──
  let disc: StageAcc | null = null;
  if (discrepancy) {
    disc = newStage();
    const resolvedLabel = discrepancy.resolved_label ?? null;
    if (resolvedLabel != null && childCurrent.label != null && childCurrent.label !== resolvedLabel) {
      disc.labelCorrected = true;
      disc.labelFrom = childCurrent.label;
      disc.labelTo = resolvedLabel;
    }
    if (!excludeAttributes && discrepancy.corrected_tags != null) {
      const resolvedTags = new Set(discrepancy.corrected_tags);
      const childTags = new Set(childCurrent.tags);
      for (const t of resolvedTags) if (!childTags.has(t)) disc.added.add(t);
      for (const t of childTags) if (!resolvedTags.has(t)) disc.removed.add(t);
    }
  }

  const qaReal = qa && stageHasCorrection(qa) ? qa : null;
  const discReal = disc && stageHasCorrection(disc) ? disc : null;

  // Annotator's first submission (frozen): earliest QA snapshot, else child value.
  const annotatorLabel = qa?.origLabel ?? childCurrent.label ?? null;
  const annotatorTags = qa?.origTags ?? childCurrent.tags;
  const finalLabel = parentFinal.label ?? null;
  const finalTags = parentFinal.tags;
  const hasDisc = discrepancy != null;

  // ── Charged label: surviving reviewer corrections across annotator spans ──
  let chargedLabel = 0;
  {
    const evs: FieldEvent[] = [];
    let cur: string | null = null;
    let sawDetail = false;
    let coarse = false;
    for (const s of qaSamples) {
      const labelOutcome = s.outcome === "label_corrected" || s.outcome === "both_corrected";
      if (s.original_label != null) {
        sawDetail = true;
        cur = s.original_label;
        evs.push({ actor: "ann", val: lv(cur) });
        if (labelOutcome && s.corrected_label != null && s.corrected_label !== cur) {
          cur = s.corrected_label;
          evs.push({ actor: "rev", val: lv(cur) });
        }
      } else if (labelOutcome) {
        coarse = true;
      }
    }
    if (qaSamples.length === 0 || !sawDetail) {
      cur = childCurrent.label;
      evs.push({ actor: "ann", val: lv(cur) });
    } else if (childCurrent.label !== cur) {
      cur = childCurrent.label;
      evs.push({ actor: "ann", val: lv(cur) });
    }
    if (hasDisc && finalLabel !== cur) {
      cur = finalLabel;
      evs.push({ actor: "rev", val: lv(cur) });
    }
    chargedLabel = countCharges(evs);
    if (coarse && chargedLabel === 0) chargedLabel = 1;
  }

  // ── Charged attributes: same span logic, per attribute (present/absent) ──
  const chargedAdded = new Set<string>();
  const chargedRemoved = new Set<string>();
  let attrCount = 0;
  let attrDetailUnknown = false;
  if (!excludeAttributes) {
    let coarseAttr = false;
    const universe = new Set<string>([...annotatorTags, ...finalTags]);
    for (const s of qaSamples) {
      (s.original_tags ?? []).forEach((t) => universe.add(t));
      (s.corrected_tags ?? []).forEach((t) => universe.add(t));
      const attrOutcome = s.outcome === "attributes_corrected" || s.outcome === "both_corrected";
      if (attrOutcome && s.original_tags == null) coarseAttr = true;
    }
    (discrepancy?.corrected_tags ?? []).forEach((t) => universe.add(t));
    for (const attr of universe) {
      const evs: FieldEvent[] = [];
      let cur = false;
      let sawDetail = false;
      for (const s of qaSamples) {
        if (s.original_tags == null) continue;
        sawDetail = true;
        cur = s.original_tags.includes(attr);
        evs.push({ actor: "ann", val: cur ? "1" : "0" });
        if (s.corrected_tags != null) {
          const qp = s.corrected_tags.includes(attr);
          if (qp !== cur) { cur = qp; evs.push({ actor: "rev", val: cur ? "1" : "0" }); }
        }
      }
      const childP = childCurrent.tags.includes(attr);
      if (qaSamples.length === 0 || !sawDetail) {
        cur = childP;
        evs.push({ actor: "ann", val: cur ? "1" : "0" });
      } else if (childP !== cur) {
        cur = childP;
        evs.push({ actor: "ann", val: cur ? "1" : "0" });
      }
      if (hasDisc) {
        const fp = finalTags.includes(attr);
        if (fp !== cur) { cur = fp; evs.push({ actor: "rev", val: cur ? "1" : "0" }); }
      }
      const c = countCharges(evs);
      if (c > 0) {
        attrCount += c;
        (finalTags.includes(attr) ? chargedAdded : chargedRemoved).add(attr);
      }
    }
    if (coarseAttr && chargedAdded.size === 0 && chargedRemoved.size === 0) {
      attrDetailUnknown = true;
      attrCount = Math.max(attrCount, 1);
    }
  }

  const labelCorrected = chargedLabel > 0;
  const attrCorrected = chargedAdded.size > 0 || chargedRemoved.size > 0 || attrDetailUnknown;
  if (!labelCorrected && !attrCorrected) return null;

  const stages: string[] = [];
  if (qaReal) stages.push("QA");
  if (discReal) stages.push("Discrepancy");
  if (stages.length === 0) stages.push("QA");

  return {
    stages,
    qa: qaReal ? toStage(qaReal) : null,
    discrepancy: discReal ? toStage(discReal) : null,
    annotator_label: annotatorLabel,
    annotator_tags: annotatorTags,
    final_label: finalLabel ?? annotatorLabel ?? childCurrent.label ?? null,
    final_tags: finalTags,
    label_corrected: labelCorrected,
    label_from: labelCorrected ? annotatorLabel : null,
    label_to: labelCorrected ? finalLabel : null,
    attr_corrected: attrCorrected,
    added_tags: [...chargedAdded],
    removed_tags: [...chargedRemoved],
    attr_detail_known: !attrDetailUnknown,
    label_correction_count: chargedLabel,
    attribute_correction_count: attrCount,
  };
}
