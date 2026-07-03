import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, logger } from "@/lib/logger";
import { reviewRepository } from "@/lib/repositories";
import { dataStore } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("run_id");
    if (!runId) {
      return NextResponse.json({ error: "run_id required" }, { status: 400 });
    }
    const rows = reviewRepository.getGroundtruthCorrectionsByRun(runId);
    const normalized = rows.map((r: any) => ({
      correction_id: r.correction_id,
      prediction_id: r.prediction_id,
      run_id: r.run_id,
      dataset_id: r.dataset_id,
      image_id: r.image_id,
      old_label: r.old_label,
      new_label: r.new_label,
      predicted_decision: r.predicted_decision,
      ai_matches_new_gt:
        r.ai_matches_new_gt === null || r.ai_matches_new_gt === undefined
          ? null
          : Boolean(r.ai_matches_new_gt),
      reason: r.reason,
      actor: r.actor,
      created_at: r.created_at,
    }));
    return NextResponse.json({ corrections: normalized });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/gt-corrections");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch GT corrections", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const correctionId = String(body?.correction_id || "").trim();
    if (!correctionId) {
      return NextResponse.json({ error: "correction_id required" }, { status: 400 });
    }
    const reason = typeof body?.reason === "string" ? body.reason : null;
    dataStore.run(
      "UPDATE groundtruth_corrections SET reason = ? WHERE correction_id = ?",
      reason,
      correctionId
    );
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/gt-corrections");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update GT correction reason", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
