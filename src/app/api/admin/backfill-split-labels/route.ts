import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { datasetRepository } from "@/lib/repositories";

export const runtime = "nodejs";

/**
 * One-time (re-runnable) maintenance: reconcile ground-truth labels and
 * attribute tags between TRAIN/TEST/EVAL splits and their linked MASTER.
 * `direction` controls which way drift is carried: "up" (split -> master,
 * default), "down" (master -> splits), or "both". Non-destructive — only
 * non-empty source values that differ from the target are applied.
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "admin:backfill-split-labels", maxRequests: 5, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const direction: "up" | "down" | "both" =
      body?.direction === "down" || body?.direction === "both" ? body.direction : "up";

    const now = new Date().toISOString();

    let upUpdated = 0;
    const mastersTouchedUp = new Set<string>();
    if (direction === "up" || direction === "both") {
      for (const splitId of datasetRepository.getSplitDatasetIds()) {
        const { masterId, updated } = datasetRepository.propagateLabelsToMaster(splitId, now, {
          skipEmpty: true,
          dryRun,
        });
        if (!masterId || updated === 0) continue;
        upUpdated += updated;
        mastersTouchedUp.add(masterId);
      }
    }

    let downUpdated = 0;
    const splitsTouchedDown = new Set<string>();
    if (direction === "down" || direction === "both") {
      for (const masterId of datasetRepository.getMasterDatasetIdsWithSplits()) {
        const { splitIds, updated } = datasetRepository.propagateLabelsToSplits(masterId, now, {
          skipEmpty: true,
          dryRun,
        });
        downUpdated += updated;
        for (const id of splitIds) splitsTouchedDown.add(id);
      }
    }

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      direction,
      up: { rows_updated: upUpdated, masters_touched: mastersTouchedUp.size },
      down: { rows_updated: downUpdated, splits_touched: splitsTouchedDown.size },
    });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/admin/backfill-split-labels");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to reconcile split/master labels", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
