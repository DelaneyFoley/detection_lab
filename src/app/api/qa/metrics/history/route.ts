import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { qaRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:metrics:history", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const annotator = searchParams.get("annotator") || undefined;
    const periodType = (searchParams.get("period_type") || "week") as "week" | "month";
    const count = Math.min(Math.max(parseInt(searchParams.get("count") || "12", 10) || 12, 1), 52);

    const history = qaRepository.getMetricsHistory({ annotator, periodType, count });
    return NextResponse.json({ history });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa/metrics/history");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA metrics history failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
