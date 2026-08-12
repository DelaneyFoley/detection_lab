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

/** Returns the correction record for one image, or null if neither QA nor
 * discrepancy review changed anything the annotator is charged for. */
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
  if (!qaReal && !discReal) return null;

  const stages: string[] = [];
  if (qaReal) stages.push("QA");
  if (discReal) stages.push("Discrepancy");

  const labelCorrected = !!(qaReal?.labelCorrected || discReal?.labelCorrected);
  let labelFrom: string | null = null;
  let labelTo: string | null = null;
  if (labelCorrected) {
    labelFrom = qaReal?.labelCorrected ? qaReal.labelFrom : discReal?.labelCorrected ? discReal!.labelFrom : null;
    labelTo = discReal?.labelCorrected ? discReal.labelTo : qaReal?.labelCorrected ? qaReal!.labelTo : null;
    if (labelFrom == null) labelFrom = childCurrent.label;
    if (labelTo == null) labelTo = parentFinal.label;
  }

  const addedTags = new Set<string>([...(qaReal?.added ?? []), ...(discReal?.added ?? [])]);
  const removedTags = new Set<string>([...(qaReal?.removed ?? []), ...(discReal?.removed ?? [])]);
  const attrCorrected = addedTags.size > 0 || removedTags.size > 0 || (qaReal ? !qaReal.attrDetailKnown : false);
  const attrDetailKnown = qaReal ? qaReal.attrDetailKnown : true;

  const finalLabel = parentFinal.label ?? labelTo ?? childCurrent.label ?? null;
  const finalTags = parentFinal.tags;
  // Annotator's original submission: the pre-QA state recorded on the earliest
  // QA sample (exact), else the child's stored value when QA never touched it.
  const annotatorLabel = qa?.origLabel ?? childCurrent.label ?? null;
  const annotatorTags = qa?.origTags ?? childCurrent.tags;

  return {
    stages,
    qa: qaReal ? toStage(qaReal) : null,
    discrepancy: discReal ? toStage(discReal) : null,
    annotator_label: annotatorLabel,
    annotator_tags: annotatorTags,
    final_label: finalLabel,
    final_tags: finalTags,
    label_corrected: labelCorrected,
    label_from: labelFrom,
    label_to: labelTo,
    attr_corrected: attrCorrected,
    added_tags: [...addedTags],
    removed_tags: [...removedTags],
    attr_detail_known: attrDetailKnown,
  };
}
