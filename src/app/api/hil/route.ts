import { NextRequest, NextResponse } from "next/server";
import { computeMetrics } from "@/lib/metrics";
import type { Prediction } from "@/types";
import { applyRateLimit, parseJsonWithSchema } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { HilRecomputeSchema, HilUpdateSchema } from "@/lib/schemas";
import { reviewRepository } from "@/lib/repositories";

// Update a prediction (correction, error tag, note)
export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "hil:update", maxRequests: 120, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, HilUpdateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;
    const now = new Date().toISOString();
    const pred = reviewRepository.getPredictionById(body.prediction_id);
    if (!pred) {
      return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
    }

    reviewRepository.updatePredictionReview({
      predictionId: body.prediction_id,
      correctedLabel: body.corrected_label || null,
      errorTag: body.error_tag || null,
      reviewerNote: body.reviewer_note || null,
      correctedAt: now,
    });

  // Reviewer can set ground truth directly during HIL review.
    const metricsImpactedByGroundTruthChange = Object.prototype.hasOwnProperty.call(body, "ground_truth_label");
    if (metricsImpactedByGroundTruthChange) {
      reviewRepository.updatePredictionGroundTruth(body.prediction_id, body.ground_truth_label ?? null);

      if (body.update_ground_truth) {
        const run = reviewRepository.getRunById(pred.run_id);
        if (run) {
          reviewRepository.updateDatasetItemGroundTruth(
            run.dataset_id,
            pred.image_id,
            body.ground_truth_label ?? null
          );
        }
      }
    }

  // If correcting an ITERATION dataset, also update ground truth
    const metricsImpactedByCorrectedLabel = Object.prototype.hasOwnProperty.call(body, "corrected_label");
    if (body.corrected_label && body.update_ground_truth) {
      const run = reviewRepository.getRunById(pred.run_id);
      if (run) {
        const dataset = reviewRepository.getDatasetById(run.dataset_id);
        if (dataset && dataset.split_type === "ITERATION") {
          reviewRepository.updateDatasetItemGroundTruth(run.dataset_id, pred.image_id, body.corrected_label);
        }
      }
    }

    // Recompute metrics only when labels changed.
    if (metricsImpactedByGroundTruthChange || metricsImpactedByCorrectedLabel) {
      const predictions = reviewRepository.getRunPredictions(pred.run_id);
      const metrics = computeMetrics(predictions);
      reviewRepository.updateRunMetrics(pred.run_id, JSON.stringify(metrics));
      return NextResponse.json({ ok: true, run_id: pred.run_id, metrics });
    }

    return NextResponse.json({ ok: true, run_id: pred.run_id, metrics: null });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update HIL prediction", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// Recompute metrics for a run (after HIL corrections)
export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "hil:recompute", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, HilRecomputeSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;
    const predictions = reviewRepository.getRunPredictions(body.run_id);

    const metrics = computeMetrics(predictions);

    reviewRepository.updateRunMetrics(body.run_id, JSON.stringify(metrics));

    return NextResponse.json({ metrics });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to recompute HIL metrics", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
