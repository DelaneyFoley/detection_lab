import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit, parseJsonWithSchema } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { ReviewFlagCreateSchema, ReviewFlagResolveSchema } from "@/lib/schemas";
import { qaRepository, reviewFlagRepository } from "@/lib/repositories";
import { dataStore } from "@/lib/services";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "review-flags:read", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("run_id");
    const datasetId = searchParams.get("dataset_id");
    const detectionId = searchParams.get("detection_id");
    const status = searchParams.get("status") || undefined;
    const action = searchParams.get("action");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("page_size") || "10", 10);

    if (action === "counts") {
      const ids = (searchParams.get("dataset_ids") || "").split(",").filter(Boolean);
      const counts: Record<string, number> = {};
      const resolvedCounts: Record<string, number> = {};
      for (const id of ids) {
        counts[id] = reviewFlagRepository.getOpenFlagCountForDataset(id);
        resolvedCounts[id] = reviewFlagRepository.getResolvedFlagCountForDataset(id);
      }
      return NextResponse.json({ counts, resolvedCounts });
    }

    if (runId) {
      const flags = reviewFlagRepository.getFlagsByRun(runId);
      return NextResponse.json({ flags });
    }

    if (datasetId) {
      const flags = reviewFlagRepository.getFlagsByDataset(datasetId);
      return NextResponse.json({ flags });
    }

    if (detectionId) {
      const flags = reviewFlagRepository.getFlagsByDetection(detectionId, status);
      return NextResponse.json({ flags });
    }

    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      const result = reviewFlagRepository.getAllFlagsPaginated({ statuses, page, pageSize });
      return NextResponse.json({ flags: result.flags, total: result.total, page, page_size: pageSize });
    }

    return NextResponse.json({ error: "Provide run_id, dataset_id, detection_id, or status" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/review-flags");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch review flags", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "review-flags:create", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const parsedBody = await parseJsonWithSchema(req, ReviewFlagCreateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;

    if (!body.prediction_id && !body.dataset_item_id) {
      return NextResponse.json({ error: "Either prediction_id or dataset_item_id is required" }, { status: 400 });
    }

    const flagId = crypto.randomUUID();
    const now = new Date().toISOString();

    reviewFlagRepository.createFlag({
      flagId,
      predictionId: body.prediction_id,
      datasetItemId: body.dataset_item_id,
      detectionId: body.detection_id,
      imageId: body.image_id,
      reason: body.reason,
      createdAt: now,
    });

    return NextResponse.json({ ok: true, flag_id: flagId });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/review-flags");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create review flag", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "review-flags:delete", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const flagId = searchParams.get("flag_id");
    if (!flagId) {
      return NextResponse.json({ error: "flag_id is required" }, { status: 400 });
    }

    const existing = reviewFlagRepository.getFlagById(flagId);
    if (!existing) {
      return NextResponse.json({ error: "Flag not found" }, { status: 404 });
    }
    if (existing.status !== "open") {
      return NextResponse.json({ error: "Only open flags can be cancelled" }, { status: 400 });
    }

    reviewFlagRepository.deleteFlag(flagId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/review-flags");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete review flag", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "review-flags:resolve", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const parsedBody = await parseJsonWithSchema(req, ReviewFlagResolveSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;

    const existing = reviewFlagRepository.getFlagById(body.flag_id);
    if (!existing) {
      return NextResponse.json({ error: "Flag not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (body.status === "dismissed") {
      reviewFlagRepository.dismissFlag(body.flag_id, now, body.resolved_by);
    } else {
      reviewFlagRepository.resolveFlag({
        flagId: body.flag_id,
        resolutionAction: body.resolution_action,
        resolutionNote: body.resolution_note,
        resolvedAt: now,
        resolvedBy: body.resolved_by,
        previousGroundTruthLabel: body.previous_ground_truth_label ?? null,
        newGroundTruthLabel: body.new_ground_truth_label ?? null,
        previousAttributes: body.previous_attributes ?? null,
        newAttributes: body.new_attributes ?? null,
      });

      if (existing.dataset_item_id) {
        const itemRow = dataStore.get<{ dataset_id: string }>(
          "SELECT dataset_id FROM dataset_items WHERE item_id = ?",
          existing.dataset_item_id
        );
        if (itemRow?.dataset_id) {
          qaRepository.createLog({
            datasetId: itemRow.dataset_id,
            action: "review_flag_resolved",
            actor: body.resolved_by,
            details: {
              flag_id: body.flag_id,
              image_id: existing.image_id,
              resolution_action: body.resolution_action ?? null,
              resolution_note: body.resolution_note ?? null,
              previous_ground_truth_label: body.previous_ground_truth_label ?? null,
              new_ground_truth_label: body.new_ground_truth_label ?? null,
              previous_attributes: body.previous_attributes ?? null,
              new_attributes: body.new_attributes ?? null,
            },
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/review-flags");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to resolve review flag", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
