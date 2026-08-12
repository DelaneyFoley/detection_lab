import { NextRequest, NextResponse } from "next/server";
import { computeMetricsWithSegments } from "@/lib/metrics";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { runRepository, reviewRepository } from "@/lib/repositories";

/**
 * Re-score EVERY run against the dataset's CURRENT ground truth.
 *
 * Ground-truth edits made during HIL review only recompute the run being
 * reviewed, so runs scored earlier keep a stale GT snapshot and their stored
 * metrics are not comparable across time. This job re-syncs each run's
 * prediction snapshots from the dataset's canonical labels and recomputes its
 * metrics_summary, so every run's displayed numbers reflect today's ground truth.
 *
 * Optional body: { detection_id } to scope to one detection (default: all runs).
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "runs:recompute-all", maxRequests: 6, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const detectionId = body?.detection_id ? String(body.detection_id) : undefined;

    const runs = runRepository.listRuns(detectionId ? { detectionId } : {}).rows as Array<{
      run_id: string;
      dataset_id: string;
    }>;

    let updated = 0;
    const segMapCache = new Map<string, Map<string, string[]>>();

    for (const run of runs) {
      if (!run.dataset_id) continue;
      reviewRepository.syncRunGroundTruthFromDataset(run.run_id, run.dataset_id);

      // Score purely against the (now-synced) canonical ground truth: drop any
      // per-run corrected_label so cross-run numbers use the same truth.
      const preds = reviewRepository
        .getRunPredictions(run.run_id)
        .map((p) => ({ ...p, corrected_label: null }));

      let segMap = segMapCache.get(run.dataset_id);
      if (!segMap) {
        segMap = reviewRepository.getDatasetSegmentTagsByImageId(run.dataset_id);
        segMapCache.set(run.dataset_id, segMap);
      }

      const metrics = computeMetricsWithSegments(preds, segMap);
      reviewRepository.updateRunMetrics(run.run_id, JSON.stringify(metrics));
      updated += 1;
    }

    return NextResponse.json({ updated, total: runs.length });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to recompute all run metrics", {
      ...getRequestContext(req, "/api/runs/recompute-all"),
      error: errMsg,
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
