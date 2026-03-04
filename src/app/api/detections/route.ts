import { NextRequest, NextResponse } from "next/server";
import { seedDefaultData, seedPipesRustingDetection } from "@/lib/seed";
import { v4 as uuid } from "uuid";
import { applyRateLimit, parseJsonWithSchema, parsePagination, parseSearch, toPaginatedResponse } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import {
  DetectionCreateSchema,
  DetectionDeleteSchema,
  DetectionUpdateSchema,
} from "@/lib/schemas";
import { fileStore } from "@/lib/services";
import { detectionRepository, promptRepository, runRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  seedDefaultData();
  seedPipesRustingDetection();
  const search = parseSearch(req.nextUrl.searchParams.get("search"));
  const hasPagination = req.nextUrl.searchParams.has("page") || req.nextUrl.searchParams.has("page_size");
  if (hasPagination || search) {
    const { page, pageSize } = parsePagination(req, { page: 1, pageSize: 50 });
    const { rows, total } = detectionRepository.listDetections({
      search,
      page,
      pageSize,
      paginated: true,
    });
    const detections = rows.map((r: any) => ({
      ...r,
      decision_rubric: safeParseJson(r.decision_rubric, []),
      segment_taxonomy: safeParseJson(r.segment_taxonomy, []),
      metric_thresholds: safeParseJson(r.metric_thresholds, {}),
    }));
    return NextResponse.json(toPaginatedResponse(detections, { page, pageSize, total }));
  }
  const { rows } = detectionRepository.listDetections({});
  const detections = rows.map((r: any) => ({
    ...r,
    decision_rubric: safeParseJson(r.decision_rubric, []),
    segment_taxonomy: safeParseJson(r.segment_taxonomy, []),
    metric_thresholds: safeParseJson(r.metric_thresholds, {}),
  }));
  return NextResponse.json(detections);
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "detections:write", maxRequests: 40, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, DetectionCreateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;
    const id = uuid();
    const now = new Date().toISOString();

    const detectionCode = String(body?.detection_code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");
    const displayName = String(body?.display_name || "").trim();

    if (!detectionCode) {
      return NextResponse.json({ error: "detection_code is required" }, { status: 400 });
    }
    if (!displayName) {
      return NextResponse.json({ error: "display_name is required" }, { status: 400 });
    }

    detectionRepository.createDetection({
      detectionId: id,
      detectionCode,
      displayName,
      description: body.description || "",
      labelPolicy: body.label_policy || "",
      decisionRubricJson: JSON.stringify(body.decision_rubric || []),
      segmentTaxonomyJson: JSON.stringify(normalizeStringList(body.segment_taxonomy || [])),
      metricThresholdsJson: JSON.stringify(body.metric_thresholds || { primary_metric: "f1" }),
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ detection_id: id });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/detections");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create detection", { ...context, error: errMsg });
    if (errMsg.includes("UNIQUE constraint failed: detections.detection_code")) {
      return NextResponse.json(
        { error: "Detection code already exists. Choose a different detection code." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "detections:write", maxRequests: 40, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, DetectionUpdateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;
    const now = new Date().toISOString();
    const existing = detectionRepository.getDetectionById(body.detection_id);
    if (!existing) {
      return NextResponse.json({ error: "Detection not found" }, { status: 404 });
    }

    const requestedApprovedPromptVersion = body.approved_prompt_version || null;
    if (requestedApprovedPromptVersion) {
      const prompt = promptRepository.getPromptById(requestedApprovedPromptVersion) as
        | { prompt_version_id: string; detection_id: string }
        | undefined;
      if (!prompt || prompt.detection_id !== body.detection_id) {
        return NextResponse.json({ error: "approved_prompt_version does not belong to this detection" }, { status: 400 });
      }

      const thresholds = (body.metric_thresholds ||
        safeParseJson(existing.metric_thresholds, {})) as {
        min_precision?: number;
        min_recall?: number;
        min_f1?: number;
      };
      const evalRuns = runRepository.listRuns({
        detectionId: body.detection_id,
        status: "completed",
      }).rows.filter(
        (r: any) => r.prompt_version_id === requestedApprovedPromptVersion && r.split_type === "HELD_OUT_EVAL"
      ) as Array<{ metrics_summary: string | null }>;
      const hasPassingEval = evalRuns.some((r) =>
        metricsMeetThresholds(safeParseJson(r.metrics_summary, {}), thresholds)
      );
      if (!hasPassingEval) {
        return NextResponse.json(
          { error: "Prompt can only be approved after a completed EVAL run that meets thresholds." },
          { status: 400 }
        );
      }
    }

    detectionRepository.updateDetection({
      detectionId: body.detection_id,
      displayName: body.display_name,
      description: body.description || "",
      labelPolicy: body.label_policy || "",
      decisionRubricJson: JSON.stringify(body.decision_rubric || []),
      segmentTaxonomyJson: JSON.stringify(normalizeStringList(body.segment_taxonomy || safeParseJson(existing.segment_taxonomy, []))),
      metricThresholdsJson: JSON.stringify(body.metric_thresholds || {}),
      approvedPromptVersion: requestedApprovedPromptVersion,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/detections");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update detection", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "detections:delete", maxRequests: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, DetectionDeleteSchema);
    if (!parsedBody.success) return parsedBody.response;
    const detectionId = parsedBody.data.detection_id;

    const detection = detectionRepository.getDetectionById(detectionId);
    if (!detection) {
      return NextResponse.json({ error: "Detection not found" }, { status: 404 });
    }

    const datasetIds = detectionRepository.getDatasetIdsByDetection(detectionId);

    detectionRepository.deleteDetectionCascade(detectionId);

    // Best-effort cleanup for local uploaded files belonging to deleted datasets.
    for (const d of datasetIds) {
      await fileStore.removeDatasetUploadDir(d.dataset_id);
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/detections");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete detection", { ...context, error: errMsg });
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

function metricsMeetThresholds(
  metrics: any,
  thresholds: { min_precision?: number; min_recall?: number; min_f1?: number }
): boolean {
  if (!metrics) return false;
  if (thresholds.min_precision != null && Number(metrics.precision) < thresholds.min_precision) return false;
  if (thresholds.min_recall != null && Number(metrics.recall) < thresholds.min_recall) return false;
  if (thresholds.min_f1 != null && Number(metrics.f1) < thresholds.min_f1) return false;
  return true;
}

function normalizeStringList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    normalized.push(clean);
  }
  return normalized;
}
