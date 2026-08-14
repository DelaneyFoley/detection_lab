import { describe, it, expect } from "vitest";
import { deriveImageCorrection, type ImageCorrectionInput } from "../src/lib/annotatorCorrections";

const D = "DETECTED";
const N = "NOT_DETECTED";
const sortT = (a: string[] | undefined) => [...(a ?? [])].sort();

// Convenience builder with sensible defaults.
function build(partial: Partial<ImageCorrectionInput>): ImageCorrectionInput {
  return {
    qaSamples: [],
    discrepancy: null,
    childCurrent: { label: null, tags: [] },
    parentFinal: { label: null, tags: [] },
    excludeAttributes: false,
    ...partial,
  };
}

describe("deriveImageCorrection", () => {
  it("1. QA label correction adopted (no discrepancy) — counts, annotator=original", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: ["a"], corrected_tags: ["a"] }],
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a"] },
    }))!;
    expect(r).not.toBeNull();
    expect(r.annotator_label).toBe(N);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.final_label).toBe(D);
    expect(r.qa!.label_from).toBe(N);
    expect(r.qa!.label_to).toBe(D);
    expect(r.qa!.added_tags).toEqual([]);
    expect(r.discrepancy).toBeNull();
    expect(r.stages).toEqual(["QA"]);
    expect(r.label_corrected).toBe(true);
  });

  it("2. QA attribute add only — annotator lacks the tag, final has it", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "attributes_corrected", original_label: D, corrected_label: D, original_tags: ["a"], corrected_tags: ["a", "b"] }],
      childCurrent: { label: D, tags: ["a", "b"] },
      parentFinal: { label: D, tags: ["a", "b"] },
    }))!;
    expect(r.annotator_label).toBe(D);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(sortT(r.final_tags)).toEqual(["a", "b"]);
    expect(sortT(r.qa!.added_tags)).toEqual(["b"]);
    expect(r.qa!.removed_tags).toEqual([]);
    expect(r.qa!.label_corrected).toBe(false);
    expect(r.discrepancy).toBeNull();
  });

  it("3. Discrepancy label flip only (no QA) — annotator=child, final=resolved", () => {
    const r = deriveImageCorrection(build({
      discrepancy: { resolved_label: N, corrected_tags: null },
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: N, tags: ["a"] },
    }))!;
    expect(r.qa).toBeNull();
    expect(r.annotator_label).toBe(D);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.final_label).toBe(N);
    expect(r.discrepancy!.label_from).toBe(D);
    expect(r.discrepancy!.label_to).toBe(N);
    expect(r.stages).toEqual(["Discrepancy"]);
  });

  it("4. Discrepancy adds an attribute the annotator was missing", () => {
    const r = deriveImageCorrection(build({
      discrepancy: { resolved_label: D, corrected_tags: ["a", "b"] },
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a", "b"] },
    }))!;
    expect(r.qa).toBeNull();
    expect(r.discrepancy!.label_corrected).toBe(false);
    expect(sortT(r.discrepancy!.added_tags)).toEqual(["b"]);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(sortT(r.final_tags)).toEqual(["a", "b"]);
  });

  it("5. Annotator WINS discrepancy (resolved == child) — not counted", () => {
    const r = deriveImageCorrection(build({
      discrepancy: { resolved_label: D, corrected_tags: ["a"] },
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a"] },
    }));
    expect(r).toBeNull();
  });

  it("6. Both stages: QA flips label, discrepancy adds an attribute", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: D, corrected_label: N, original_tags: ["a"], corrected_tags: ["a"] }],
      discrepancy: { resolved_label: N, corrected_tags: ["a", "b"] },
      childCurrent: { label: N, tags: ["a"] },
      parentFinal: { label: N, tags: ["a", "b"] },
    }))!;
    expect(r.stages).toEqual(["QA", "Discrepancy"]);
    expect(r.annotator_label).toBe(D);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.qa!.label_from).toBe(D);
    expect(r.qa!.label_to).toBe(N);
    expect(r.discrepancy!.label_corrected).toBe(false);
    expect(sortT(r.discrepancy!.added_tags)).toEqual(["b"]);
    expect(r.final_label).toBe(N);
    expect(sortT(r.final_tags)).toEqual(["a", "b"]);
  });

  it("7. QA adds a tag, discrepancy removes the SAME tag (regression: OT_5)", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "both_corrected", original_label: N, corrected_label: D, original_tags: ["a"], corrected_tags: ["a", "rust"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["a"] },
      childCurrent: { label: D, tags: ["a", "rust"] },
      parentFinal: { label: D, tags: ["a"] },
    }))!;
    // Annotator never had rust — this was the reported bug.
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.annotator_label).toBe(N);
    expect(sortT(r.qa!.added_tags)).toEqual(["rust"]);
    expect(sortT(r.discrepancy!.removed_tags)).toEqual(["rust"]);
    expect(r.final_label).toBe(D);
    expect(sortT(r.final_tags)).toEqual(["a"]);
  });

  it("8. QA removes a tag, discrepancy adds it back (no annotator edit) — net zero, null", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "attributes_corrected", original_label: D, corrected_label: D, original_tags: ["rust", "x"], corrected_tags: ["x"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["x", "rust"] },
      childCurrent: { label: D, tags: ["x"] },
      parentFinal: { label: D, tags: ["x", "rust"] },
    }));
    expect(r).toBeNull();
  });

  it("9. Pure self-revision (no QA, no discrepancy) — no correction at all", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [],
      discrepancy: null,
      childCurrent: { label: N, tags: ["b"] },
      parentFinal: { label: N, tags: ["b"] },
    }));
    expect(r).toBeNull();
  });

  it("10. Self-revision AFTER QA — the self-removed tag is NOT shown as a correction", () => {
    // Annotator D [rust]; QA adds oxidation -> [rust, oxidation]; annotator then
    // self-removes rust -> child [oxidation]; discrepancy adds borderline.
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "attributes_corrected", original_label: D, corrected_label: D, original_tags: ["rust"], corrected_tags: ["rust", "oxidation"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["oxidation", "borderline"] },
      childCurrent: { label: D, tags: ["oxidation"] },
      parentFinal: { label: D, tags: ["oxidation", "borderline"] },
    }))!;
    expect(sortT(r.annotator_tags)).toEqual(["rust"]);
    expect(sortT(r.qa!.added_tags)).toEqual(["oxidation"]);
    expect(sortT(r.discrepancy!.added_tags)).toEqual(["borderline"]);
    // The self-removed "rust" appears in neither stage's removed set.
    expect(r.qa!.removed_tags).toEqual([]);
    expect(r.discrepancy!.removed_tags).toEqual([]);
    expect(sortT(r.final_tags)).toEqual(["borderline", "oxidation"]);
  });

  it("11. exclude_attributes — attribute changes are dropped, only label counts", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "both_corrected", original_label: D, corrected_label: N, original_tags: ["a"], corrected_tags: ["a", "b"] }],
      discrepancy: { resolved_label: N, corrected_tags: ["a", "b", "c"] },
      childCurrent: { label: N, tags: ["a", "b"] },
      parentFinal: { label: N, tags: ["a", "b", "c"] },
      excludeAttributes: true,
    }))!;
    expect(r.qa!.label_corrected).toBe(true);
    expect(r.qa!.added_tags).toEqual([]);
    expect(r.qa!.removed_tags).toEqual([]);
    expect(r.attr_corrected).toBe(false);
    expect(r.added_tags).toEqual([]);
    expect(r.discrepancy).toBeNull(); // no label change (N==N) and attrs excluded
  });

  it("12. Label toggle D->N->D across stages (no annotator edit) — net zero, null", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: D, corrected_label: N, original_tags: ["a"], corrected_tags: ["a"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["a"] },
      childCurrent: { label: N, tags: ["a"] },
      parentFinal: { label: D, tags: ["a"] },
    }));
    expect(r).toBeNull();
  });

  it("13. Historical QA row with no stored diff — counts via outcome, detail unknown", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "both_corrected", original_label: null, corrected_label: null, original_tags: null, corrected_tags: null }],
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a"] },
    }))!;
    expect(r.qa!.label_corrected).toBe(true);
    expect(r.qa!.attr_detail_known).toBe(false);
    // Falls back to child value when the original wasn't recorded.
    expect(r.annotator_label).toBe(D);
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.attr_corrected).toBe(true);
  });

  it("14. Multiple QA attempts — earliest original wins, later corrections merge", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [
        { outcome: "label_corrected", original_label: D, corrected_label: N, original_tags: ["a"], corrected_tags: ["a"] },
        { outcome: "attributes_corrected", original_label: N, corrected_label: N, original_tags: ["a"], corrected_tags: ["a", "b"] },
      ],
      childCurrent: { label: N, tags: ["a", "b"] },
      parentFinal: { label: N, tags: ["a", "b"] },
    }))!;
    expect(r.annotator_label).toBe(D); // earliest original
    expect(sortT(r.annotator_tags)).toEqual(["a"]);
    expect(r.qa!.label_from).toBe(D);
    expect(r.qa!.label_to).toBe(N);
    expect(sortT(r.qa!.added_tags)).toEqual(["b"]);
    expect(sortT(r.final_tags)).toEqual(["a", "b"]);
  });

  it("15. Discrepancy replaces the entire attribute set (add + remove together)", () => {
    // OT_4-style: QA flips label only; discrepancy swaps all attributes.
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: ["oxidation", "borderline"], corrected_tags: ["oxidation", "borderline"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["dark_image", "blurry_image"] },
      childCurrent: { label: D, tags: ["oxidation", "borderline"] },
      parentFinal: { label: D, tags: ["dark_image", "blurry_image"] },
    }))!;
    expect(r.annotator_label).toBe(N);
    expect(sortT(r.annotator_tags)).toEqual(["borderline", "oxidation"]);
    expect(r.qa!.label_from).toBe(N);
    expect(r.qa!.label_to).toBe(D);
    expect(sortT(r.discrepancy!.added_tags)).toEqual(["blurry_image", "dark_image"]);
    expect(sortT(r.discrepancy!.removed_tags)).toEqual(["borderline", "oxidation"]);
    expect(sortT(r.final_tags)).toEqual(["blurry_image", "dark_image"]);
  });

  it("16. Fully accepted image (no QA, no discrepancy) — null", () => {
    const r = deriveImageCorrection(build({
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a"] },
    }));
    expect(r).toBeNull();
  });

  it("17. Annotator wins the label but discrepancy still fixes an attribute", () => {
    const r = deriveImageCorrection(build({
      discrepancy: { resolved_label: D, corrected_tags: ["a", "b"] },
      childCurrent: { label: D, tags: ["a"] },
      parentFinal: { label: D, tags: ["a", "b"] },
    }))!;
    expect(r.discrepancy!.label_corrected).toBe(false); // label agreed
    expect(sortT(r.discrepancy!.added_tags)).toEqual(["b"]);
    expect(r.label_corrected).toBe(false);
    expect(r.attr_corrected).toBe(true);
  });

  // ── Provenance / span scenario matrix (source-of-truth semantics) ──

  it("S1. Annotator N -> QA D (final D) — 1 label correction", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: [], corrected_tags: [] }],
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: D, tags: [] },
    }))!;
    expect(r.label_corrected).toBe(true);
    expect(r.label_correction_count).toBe(1);
  });

  it("S2. N -> QA D -> DR N (final N, no annotator edit) — net zero, null", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: [], corrected_tags: [] }],
      discrepancy: { resolved_label: N, corrected_tags: [] },
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: N, tags: [] },
    }));
    expect(r).toBeNull();
  });

  it("S3. Two QA rounds each correct the label — counts twice", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [
        { outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: [], corrected_tags: [] },
        { outcome: "label_corrected", original_label: N, corrected_label: D, original_tags: [], corrected_tags: [] },
      ],
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: D, tags: [] },
    }))!;
    expect(r.label_corrected).toBe(true);
    expect(r.label_correction_count).toBe(2);
  });

  it("S4. Annotator self-revises an unsampled image, DR corrects it — 1 (DR)", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [],
      discrepancy: { resolved_label: N, corrected_tags: [] },
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: N, tags: [] },
    }))!;
    expect(r.label_corrected).toBe(true);
    expect(r.label_correction_count).toBe(1);
    expect(r.stages).toEqual(["Discrepancy"]);
  });

  it("S5. Annotator self-fixes, no reviewer ever changes it — null", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [],
      discrepancy: null,
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: D, tags: [] },
    }));
    expect(r).toBeNull();
  });

  it("S6. Attribute: annotator absent -> QA add -> annotator remove -> DR add — counts twice", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "both_corrected", original_label: D, corrected_label: D, original_tags: [], corrected_tags: ["rust"] }],
      discrepancy: { resolved_label: D, corrected_tags: ["rust"] },
      childCurrent: { label: D, tags: [] },
      parentFinal: { label: D, tags: ["rust"] },
    }))!;
    expect(r.attribute_correction_count).toBe(2);
    expect(sortT(r.added_tags)).toEqual(["rust"]);
  });

  it("S7. exclude_attributes: net-zero attribute dropped, surviving label kept", () => {
    const r = deriveImageCorrection(build({
      qaSamples: [{ outcome: "both_corrected", original_label: N, corrected_label: D, original_tags: [], corrected_tags: ["rust"] }],
      discrepancy: { resolved_label: D, corrected_tags: [] },
      childCurrent: { label: D, tags: ["rust"] },
      parentFinal: { label: D, tags: [] },
      excludeAttributes: true,
    }))!;
    expect(r.label_corrected).toBe(true);
    expect(r.attr_corrected).toBe(false);
    expect(r.attribute_correction_count).toBe(0);
  });
});
