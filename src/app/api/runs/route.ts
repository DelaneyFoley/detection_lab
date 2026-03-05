import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { runDetectionInference } from "@/lib/gemini";
import { computeMetricsWithSegments } from "@/lib/metrics";
import type { Prediction } from "@/types";
import { applyRateLimit, parseJsonWithSchema, parsePagination, parseSearch, toPaginatedResponse } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { RunCreateSchema, RunUpdateSchema } from "@/lib/schemas";
import { runQueue } from "@/lib/services";
import { runRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const runId = req.nextUrl.searchParams.get("run_id");
    const search = parseSearch(req.nextUrl.searchParams.get("search"));
    const status = parseSearch(req.nextUrl.searchParams.get("status"));
    const hasPagination = req.nextUrl.searchParams.has("page") || req.nextUrl.searchParams.has("page_size");
    const { page, pageSize } = parsePagination(req, { page: 1, pageSize: 50 });
    if (runId) {
      const run = runRepository.getRunById(runId);
      if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const predictions = runRepository.getRunPredictions(runId);

      return NextResponse.json({
        ...run,
        metrics_summary: safeParseJson(run.metrics_summary, {}),
        decoding_params: safeParseJson(run.decoding_params, {}),
        prompt_feedback_log: safeParseJson(run.prompt_feedback_log, {}),
        predictions,
      });
    }

    const { rows, total } = runRepository.listRuns({
      detectionId: detectionId || undefined,
      status: status || undefined,
      search,
      page,
      pageSize,
      paginated: hasPagination,
    });

    const runs = rows.map((r: any) => ({
      ...r,
      metrics_summary: safeParseJson(r.metrics_summary, {}),
      prompt_feedback_log: safeParseJson(r.prompt_feedback_log, {}),
    }));

    if (hasPagination || search || status) {
      return NextResponse.json(
        toPaginatedResponse(runs, { page, pageSize, total })
      );
    }

    return NextResponse.json(runs);
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/runs");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch runs", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "runs:create", maxRequests: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, RunCreateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const payload = parsedBody.data;
    const { prompt_version_id, dataset_id, detection_id, model_override } = payload;
    const apiKey = String(payload.api_key || process.env.GEMINI_API_KEY || "").trim();
    const requestedConcurrency = Number(payload.max_concurrency);
    const maxConcurrency = Number.isFinite(requestedConcurrency)
      ? Math.max(1, Math.min(12, Math.floor(requestedConcurrency)))
      : 4;

    if (!apiKey) {
      return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
    }

    // Fetch prompt
    const prompt = runRepository.getPromptVersionById(prompt_version_id);
    if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    // Fetch dataset
    const dataset = runRepository.getDatasetById(dataset_id);
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const items = runRepository.getDatasetItems(dataset_id);

    // Fetch detection
    const detection = runRepository.getDetectionById(detection_id);
    if (!detection) return NextResponse.json({ error: "Detection not found" }, { status: 404 });

    const runId = uuid();
    const now = new Date().toISOString();
    const modelUsed = model_override || prompt.model;
    const decodingParams = {
      model: modelUsed,
      temperature: prompt.temperature,
      top_p: prompt.top_p,
      max_output_tokens: prompt.max_output_tokens,
    };

    // Create run record
    runRepository.createRun({
      runId,
      detectionId: detection_id,
      promptVersionId: prompt_version_id,
      modelUsed,
      promptSnapshot: JSON.stringify({ system_prompt: prompt.system_prompt, user_prompt_template: prompt.user_prompt_template }),
      decodingParams: JSON.stringify(decodingParams),
      datasetId: dataset_id,
      datasetHash: dataset.dataset_hash,
      splitType: dataset.split_type,
      createdAt: now,
      totalImages: items.length,
    });

    // Run inference for each image in the background so UI can poll progress.
    runQueue.create(runId);
    void executeRunInBackground({
      runId,
      apiKey,
      parsedPrompt: {
        ...prompt,
        prompt_structure: JSON.parse(prompt.prompt_structure || "{}"),
        model: modelUsed,
      },
      detectionCode: detection.detection_code,
      items,
      maxConcurrency,
    });

    return NextResponse.json(
      {
        run_id: runId,
        status: "running",
        total_images: items.length,
        processed_images: 0,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/runs");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create run", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

async function executeRunInBackground({
  runId,
  apiKey,
  parsedPrompt,
  detectionCode,
  items,
  maxConcurrency,
}: {
  runId: string;
  apiKey: string;
  parsedPrompt: any;
  detectionCode: string;
  items: any[];
  maxConcurrency: number;
}) {
    const control = runQueue.get(runId) || runQueue.create(runId);

  const isCancellationRequested = () => {
    if (control.cancelRequested) return true;
    const row = runRepository.getRunStatus(runId);
    return row?.status === "cancelled";
  };

  try {
    const predictions: Prediction[] = [];
    const segmentTagsByImageId = new Map<string, string[]>(
      items.map((item) => [String(item.image_id || ""), parseSegmentTags(item.segment_tags)])
    );
    let nextIndex = 0;
    let processed = 0;

    const processItem = async (item: any): Promise<Prediction> => {
    try {
      const result = await runDetectionInference(
        apiKey,
        parsedPrompt,
        detectionCode,
        item.image_uri
      );

      const pred: Prediction = {
        prediction_id: uuid(),
        run_id: runId,
        image_id: item.image_id,
        image_uri: item.image_uri,
        ground_truth_label: item.ground_truth_label,
        predicted_decision: result.parsed?.decision || null,
        confidence: result.parsed?.confidence ?? null,
        evidence: result.parsed?.evidence || null,
        parse_ok: result.parseOk,
        raw_response: result.raw,
        parse_error_reason: result.parseErrorReason,
        parse_fix_suggestion: result.parseFixSuggestion,
        inference_runtime_ms: result.runtimeMs,
        parse_retry_count: result.retryCount,
        corrected_label: null,
        error_tag: null,
        reviewer_note: null,
        corrected_at: null,
      };

      runRepository.insertPrediction(pred, null);

      return pred;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const pred: Prediction = {
        prediction_id: uuid(),
        run_id: runId,
        image_id: item.image_id,
        image_uri: item.image_uri,
        ground_truth_label: item.ground_truth_label,
        predicted_decision: null,
        confidence: null,
        evidence: null,
        parse_ok: false,
        raw_response: `ERROR: ${errMsg}`,
        parse_error_reason: `Model/API error: ${errMsg}`,
        parse_fix_suggestion:
          "Verify API key/model availability, reduce concurrency, and retry. If this persists, inspect network/API quota errors.",
        inference_runtime_ms: null,
        parse_retry_count: 0,
        corrected_label: null,
        error_tag: "INFERENCE_CALL_FAILED",
        reviewer_note: null,
        corrected_at: null,
      };

      runRepository.insertPrediction(pred, "INFERENCE_CALL_FAILED");

      return pred;
    }
    };

    const worker = async () => {
    while (true) {
      if (isCancellationRequested()) return;
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) return;
      nextIndex += 1;

      const pred = await processItem(items[currentIndex]);
      predictions.push(pred);

      processed += 1;
      runRepository.updateProcessedImages(runId, processed);
    }
    };

    const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker());
    await Promise.all(workers);

    // Compute metrics on completed subset (full set if not cancelled).
    const metrics = computeMetricsWithSegments(predictions, segmentTagsByImageId);
    const finalStatus = isCancellationRequested() ? "cancelled" : "completed";

    runRepository.updateRunCompletion(runId, JSON.stringify(metrics), finalStatus, processed);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    runRepository.markRunFailed(runId);
    logger.error("Run execution failed", { runId, error: errMsg });
  } finally {
    runQueue.delete(runId);
  }
}

function parseSegmentTags(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeSegmentTags(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeSegmentTags(parsed);
    } catch {
      return normalizeSegmentTags(value);
    }
  }
  return ["Baseline"];
}

function normalizeSegmentTags(value: unknown): string[] {
  const rawParts = Array.isArray(value)
    ? value.map((v) => String(v || ""))
    : String(value || "")
        .split(/[;,|]/g)
        .map((v) => String(v || ""));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of rawParts) {
    const clean = part.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(clean);
  }
  return tags.length > 0 ? tags : ["Baseline"];
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "runs:update", maxRequests: 40, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, RunUpdateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;

    if (body.action === "cancel") {
      const run = runRepository.getRunStatus(body.run_id);
      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (run.status !== "running") {
        return NextResponse.json({ ok: true, status: run.status || "unknown" });
      }

      runQueue.requestCancel(body.run_id);
      runRepository.markRunCancelled(body.run_id);

      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (body.prompt_feedback_log !== undefined) {
      runRepository.setPromptFeedbackLog(body.run_id, JSON.stringify(body.prompt_feedback_log || {}));
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/runs");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update run", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
