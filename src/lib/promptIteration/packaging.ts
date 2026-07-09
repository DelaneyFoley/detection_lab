import type { Decision, Prediction } from "@/types";
import type { FailureMode, ReviewedRow } from "@/lib/promptIteration/types";
import { classifyOutcome } from "@/lib/promptIteration/metrics";

/**
 * Convert raw run predictions (already joined with dataset item notes) into the
 * normalized reviewed-row package used by the iteration workflow. Pure/testable.
 *
 * Finalized ground truth follows the same precedence the metrics layer uses:
 * a reviewer correction (`corrected_label`) wins over the original dataset label.
 */
export function toReviewedRows(predictions: Prediction[]): ReviewedRow[] {
  return predictions.map((p) => {
    const finalized = (p.corrected_label || p.ground_truth_label || null) as Decision | null;
    const original = (p.ground_truth_label || null) as Decision | null;
    const parseOk = Boolean(p.parse_ok) && p.error_tag !== "INFERENCE_CALL_FAILED";
    return {
      image_id: String(p.image_id || ""),
      image_uri: String(p.image_uri || ""),
      original_ground_truth: original,
      finalized_ground_truth: finalized,
      ai_predicted: (p.predicted_decision || null) as Decision | null,
      ai_evidence: p.evidence ?? null,
      reviewer_note: p.reviewer_note || p.image_description || null,
      attributes: parseSegmentTags((p as { segment_tags?: unknown }).segment_tags),
      confidence: p.confidence ?? null,
      parse_ok: parseOk,
      outcome: classifyOutcome((p.predicted_decision || null) as Decision | null, finalized, parseOk),
    };
  });
}

/** Parse a dataset item's segment_tags (JSON array or delimited string) to a clean list. */
function parseSegmentTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      return value.split(/[;,|]/g).map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

export interface ReviewedPackageSummary {
  total: number;
  labeled: number;
  positives: number;
  negatives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  parse_fail: number;
  reviewer_corrections: number;
}

export function summarizeReviewedRows(rows: ReviewedRow[]): ReviewedPackageSummary {
  const labeled = rows.filter(
    (r) => r.finalized_ground_truth === "DETECTED" || r.finalized_ground_truth === "NOT_DETECTED"
  );
  return {
    total: rows.length,
    labeled: labeled.length,
    positives: labeled.filter((r) => r.finalized_ground_truth === "DETECTED").length,
    negatives: labeled.filter((r) => r.finalized_ground_truth === "NOT_DETECTED").length,
    tp: rows.filter((r) => r.outcome === "TP").length,
    fp: rows.filter((r) => r.outcome === "FP").length,
    fn: rows.filter((r) => r.outcome === "FN").length,
    tn: rows.filter((r) => r.outcome === "TN").length,
    parse_fail: rows.filter((r) => r.outcome === "PARSE_FAIL").length,
    reviewer_corrections: rows.filter(
      (r) =>
        r.original_ground_truth != null &&
        r.finalized_ground_truth != null &&
        r.original_ground_truth !== r.finalized_ground_truth
    ).length,
  };
}

/**
 * Group FP and FN rows into coarse failure-mode buckets with a few example
 * evidence snippets. The AI uses these to target coherent failure modes rather
 * than one-off cases; we intentionally do NOT surface image ids to the model.
 */
export function summarizeFailureModes(rows: ReviewedRow[], maxExamples = 4): FailureMode[] {
  const fps = rows.filter((r) => r.outcome === "FP");
  const fns = rows.filter((r) => r.outcome === "FN");
  const parseFails = rows.filter((r) => r.outcome === "PARSE_FAIL");
  const modes: FailureMode[] = [];
  if (parseFails.length > 0) {
    // Parse errors are treated as a first-class failure mode: the tuned prompt
    // must eliminate them (schema-invalid output is never acceptable).
    modes.push({
      name: "Parse errors (model returned schema-invalid output)",
      kind: "PARSE",
      count: parseFails.length,
      example_evidence: [],
    });
  }
  if (fps.length > 0) {
    modes.push({
      name: "False positives (model over-detects)",
      kind: "FP",
      count: fps.length,
      example_evidence: fps
        .map((r) => (r.ai_evidence || r.reviewer_note || "").trim())
        .filter(Boolean)
        .slice(0, maxExamples),
    });
  }
  if (fns.length > 0) {
    modes.push({
      name: "False negatives (model misses true detections)",
      kind: "FN",
      count: fns.length,
      example_evidence: fns
        .map((r) => (r.ai_evidence || r.reviewer_note || "").trim())
        .filter(Boolean)
        .slice(0, maxExamples),
    });
  }
  return modes;
}
