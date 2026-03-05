import { describe, expect, it } from "vitest";
import { computeMetrics, computeMetricsWithSegments } from "@/lib/metrics";
import type { Prediction } from "@/types";

function basePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    prediction_id: "pred-1",
    run_id: "run-1",
    image_id: "img-1",
    image_uri: "/x.jpg",
    ground_truth_label: "DETECTED",
    predicted_decision: "DETECTED",
    confidence: 0.9,
    evidence: "x",
    parse_ok: true,
    raw_response: "{}",
    parse_error_reason: null,
    parse_fix_suggestion: null,
    inference_runtime_ms: 123,
    parse_retry_count: 0,
    corrected_label: null,
    error_tag: null,
    reviewer_note: null,
    corrected_at: null,
    ...overrides,
  };
}

describe("computeMetrics", () => {
  it("computes standard confusion matrix metrics", () => {
    const predictions: Prediction[] = [
      basePrediction({ prediction_id: "1", ground_truth_label: "DETECTED", predicted_decision: "DETECTED" }),
      basePrediction({ prediction_id: "2", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED" }),
      basePrediction({ prediction_id: "3", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED" }),
      basePrediction({ prediction_id: "4", ground_truth_label: "NOT_DETECTED", predicted_decision: "NOT_DETECTED" }),
    ];

    const metrics = computeMetrics(predictions);
    expect(metrics.tp).toBe(1);
    expect(metrics.fn).toBe(1);
    expect(metrics.fp).toBe(1);
    expect(metrics.tn).toBe(1);
    expect(metrics.total).toBe(4);
    expect(metrics.f1).toBe(0.5);
  });

  it("excludes inference call failures from totals", () => {
    const predictions: Prediction[] = [
      basePrediction({ prediction_id: "ok", ground_truth_label: "DETECTED", predicted_decision: "DETECTED" }),
      basePrediction({
        prediction_id: "failed-call",
        parse_ok: false,
        predicted_decision: null,
        error_tag: "INFERENCE_CALL_FAILED",
        raw_response: "ERROR: service unavailable",
        parse_error_reason: "Model/API error: timeout",
      }),
    ];

    const metrics = computeMetrics(predictions);
    expect(metrics.total).toBe(1);
    expect(metrics.tp).toBe(1);
    expect(metrics.parse_failure_rate).toBe(0);
  });

  it("uses corrected labels when present", () => {
    const predictions: Prediction[] = [
      basePrediction({
        prediction_id: "corrected",
        ground_truth_label: "NOT_DETECTED",
        corrected_label: "DETECTED",
        predicted_decision: "DETECTED",
      }),
    ];

    const metrics = computeMetrics(predictions);
    expect(metrics.tp).toBe(1);
    expect(metrics.total).toBe(1);
  });

  it("computes segment metrics and counts multi-tag images in each segment", () => {
    const predictions: Prediction[] = [
      basePrediction({ prediction_id: "a", image_id: "img_a", ground_truth_label: "DETECTED", predicted_decision: "DETECTED" }),
      basePrediction({ prediction_id: "b", image_id: "img_b", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED" }),
    ];
    const segmentMap = new Map<string, string[]>([
      ["img_a", ["Day", "Baseline"]],
      ["img_b", ["Baseline"]],
    ]);

    const metrics = computeMetricsWithSegments(predictions, segmentMap);
    expect(metrics.segment_metrics?.Baseline?.total).toBe(2);
    expect(metrics.segment_metrics?.Day?.total).toBe(1);
    expect(metrics.segment_metrics?.Day?.tp).toBe(1);
  });
});
