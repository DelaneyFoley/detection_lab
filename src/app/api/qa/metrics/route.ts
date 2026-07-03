import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { qaRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:metrics", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const annotator = searchParams.get("annotator") || undefined;
    const detectionId = searchParams.get("detection_id") || undefined;

    const { metrics, totals } = qaRepository.getAnnotatorMetrics({ annotator, detectionId });
    return NextResponse.json({ metrics, totals });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa/metrics");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA metrics failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
