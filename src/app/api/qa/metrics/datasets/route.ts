import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { qaRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:metrics:datasets", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const annotator = searchParams.get("annotator");
    if (!annotator) {
      return NextResponse.json({ error: "annotator parameter required" }, { status: 400 });
    }

    const datasets = qaRepository.getDatasetMetrics(annotator);
    return NextResponse.json({ datasets });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa/metrics/datasets");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA dataset metrics failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
