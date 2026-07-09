import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { promptRepository, runRepository, versionNoteEntryRepository } from "@/lib/repositories";
import { summarizeHilPerformance } from "@/lib/versionNoteAI";
import type { MetricsSummary } from "@/types";

function parseMetricsSummary(value: string | null | undefined): MetricsSummary {
  if (!value) {
    return {
      tp: 0, fp: 0, fn: 0, tn: 0,
      precision: 0, recall: 0, f1: 0, accuracy: 0, prevalence: 0,
      parse_failure_rate: 0, total: 0,
    };
  }
  try {
    return JSON.parse(value) as MetricsSummary;
  } catch {
    return {
      tp: 0, fp: 0, fn: 0, tn: 0,
      precision: 0, recall: 0, f1: 0, accuracy: 0, prevalence: 0,
      parse_failure_rate: 0, total: 0,
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("run_id");
    if (!runId) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }
    const finalized = versionNoteEntryRepository.hasHilEntryForRun(runId);
    return NextResponse.json({ finalized });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/finalize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to check HIL finalize state", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "hil:finalize", maxRequests: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const body = await req.json();
    const runId = String(body?.run_id || "").trim();
    if (!runId) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }
    const run = runRepository.getRunById(runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    if (run.status !== "completed") {
      return NextResponse.json(
        { error: `Run status must be 'completed' to finalize (current: ${run.status})` },
        { status: 409 }
      );
    }
    if (versionNoteEntryRepository.hasHilEntryForRun(runId)) {
      return NextResponse.json({ error: "This run has already been finalized" }, { status: 409 });
    }
    const promptVersion = promptRepository.getFullPromptById(run.prompt_version_id);
    if (!promptVersion) {
      return NextResponse.json({ error: "Prompt version not found for run" }, { status: 404 });
    }

    const metrics = parseMetricsSummary(run.metrics_summary);
    const summary = await summarizeHilPerformance({
      promptVersion,
      run,
      metrics,
    });

    const entry = versionNoteEntryRepository.createEntry({
      entryId: uuid(),
      promptVersionId: run.prompt_version_id,
      origin: "auto_hil",
      eventType: "hil_finalized",
      body: summary,
      metadata: { run_id: runId, metrics_snapshot: metrics },
      createdBy: "system",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ entry });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/finalize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to finalize HIL review", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
