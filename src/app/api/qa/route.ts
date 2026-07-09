import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import {
  QaStatusUpdateSchema,
  QaAssignSchema,
  QaLinkDatasetsSchema,
  QaCreateSamplesSchema,
  QaReviewSampleSchema,
  QaResolveDiscrepancySchema,
  QaResolveNwaySchema,
  DatasetSubmitSchema,
  QA_STATUS_TRANSITIONS,
} from "@/lib/schemas";
import { qaRepository, datasetRepository } from "@/lib/repositories";
import { dataStore } from "@/lib/services";

export async function GET(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:read", maxRequests: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    if (action === "datasets") {
      const parseList = (raw: string | null) =>
        raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const qaStatus = parseList(searchParams.get("qa_status"));
      const detectionId = parseList(searchParams.get("detection_id"));
      const assignedTo = parseList(searchParams.get("assigned_to"));
      const datasets = qaRepository.getDatasetsWithQaInfo({ qaStatus, detectionId, assignedTo });
      return NextResponse.json({ datasets });
    }

    if (action === "discrepancies") {
      const datasetA = searchParams.get("dataset_a");
      const datasetB = searchParams.get("dataset_b");
      if (!datasetA || !datasetB) {
        return NextResponse.json({ error: "dataset_a and dataset_b required" }, { status: 400 });
      }
      const discrepancies = qaRepository.getDiscrepancies(datasetA, datasetB);
      const overlapCount = qaRepository.getOverlapCount(datasetA, datasetB);
      return NextResponse.json({ discrepancies, overlap_count: overlapCount });
    }

    if (action === "resolved_discrepancies") {
      const datasetA = searchParams.get("dataset_a");
      const datasetB = searchParams.get("dataset_b");
      if (!datasetA || !datasetB) {
        return NextResponse.json({ error: "dataset_a and dataset_b required" }, { status: 400 });
      }
      const resolved = qaRepository.getResolvedDiscrepancies(datasetA, datasetB);
      return NextResponse.json({ resolved });
    }

    if (action === "eligible_parents") {
      const allDatasets = qaRepository.getDatasetsWithQaInfo({});
      const parentIds = new Set<string>();
      for (const d of allDatasets) {
        if (d.linked_dataset_id) parentIds.add(d.linked_dataset_id);
      }
      const eligible: any[] = [];
      for (const parentId of parentIds) {
        const children = datasetRepository.getChildDatasets(parentId, { includeArchived: false });
        if (children.length >= 2 && children.every((c: any) => c.qa_status === "approved")) {
          const parent = datasetRepository.getDatasetById(parentId);
          if (parent && parent.qa_status !== "finalized" && parent.qa_status !== "archived") {
            eligible.push({ ...parent, child_count: children.length, children: children.map((c: any) => ({ dataset_id: c.dataset_id, name: c.name, assigned_to: c.assigned_to })) });
          }
        }
      }
      return NextResponse.json({ parents: eligible });
    }

    if (action === "nway_conflicts") {
      const parentId = searchParams.get("parent_id");
      if (!parentId) {
        return NextResponse.json({ error: "parent_id required" }, { status: 400 });
      }
      const parentDataset = datasetRepository.getDatasetById(parentId);
      const excludeAttributes = !!parentDataset?.exclude_attributes;
      const conflicts = datasetRepository.getMergeConflicts(parentId, excludeAttributes);
      const children = datasetRepository.getChildDatasets(parentId);
      const parentSize = dataStore.get<{ c: number }>(
        "SELECT COUNT(*) as c FROM dataset_items WHERE dataset_id = ?",
        parentId
      );

      const resolvedLogs = dataStore.all<{ details: string }>(
        `SELECT details FROM qa_logs WHERE dataset_id = ? AND action = 'nway_discrepancy_resolved'`,
        parentId
      );
      const resolvedImageIds = new Set(
        resolvedLogs.map((log) => { try { return JSON.parse(log.details).image_id; } catch { return null; } }).filter(Boolean)
      );

      const unresolvedConflicts = conflicts.filter((c) => !resolvedImageIds.has(c.image_id));
      const enriched = unresolvedConflicts.map((c) => {
        const item = dataStore.get<{ image_uri: string }>(
          "SELECT image_uri FROM dataset_items WHERE image_id = ? LIMIT 1",
          c.image_id
        );
        return { ...c, image_uri: item?.image_uri || "" };
      });
      return NextResponse.json({
        conflicts: enriched,
        children: children.map((c: any) => ({ dataset_id: c.dataset_id, name: c.name, assigned_to: c.assigned_to })),
        total_images: parentSize?.c || 0,
        exclude_attributes: excludeAttributes,
      });
    }

    if (action === "nway_resolved") {
      const parentId = searchParams.get("parent_id");
      if (!parentId) {
        return NextResponse.json({ error: "parent_id required" }, { status: 400 });
      }
      const logs = dataStore.all<any>(
        `SELECT * FROM qa_logs WHERE dataset_id = ? AND action = 'nway_discrepancy_resolved' ORDER BY created_at DESC`,
        parentId
      );
      const children = datasetRepository.getChildDatasets(parentId);
      const parseTagList = (raw: string | null | undefined): string[] => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      };
      const tagsEqual = (a: string[], b: string[]): boolean => {
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((v, i) => v === sortedB[i]);
      };
      const resolved = logs.map((log: any) => {
        const details = JSON.parse(log.details || "{}");
        const item = dataStore.get<{ image_uri: string }>(
          "SELECT image_uri FROM dataset_items WHERE image_id = ? LIMIT 1",
          details.image_id
        );
        const finalLabel: string | null = details.resolved_label ?? null;
        const finalTags: string[] = Array.isArray(details.corrected_tags)
          ? details.corrected_tags.map(String)
          : parseTagList(details.corrected_tags);
        const annotatorAnswers = children.map((child: any) => {
          const childItem = dataStore.get<{ ground_truth_label: string | null; segment_tags: string | null }>(
            "SELECT ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ? AND image_id = ?",
            child.dataset_id,
            details.image_id
          );
          const annotator = child.assigned_to || child.name;
          const label = childItem?.ground_truth_label ?? null;
          const tags = parseTagList(childItem?.segment_tags);
          const labelMatches = finalLabel != null && label === finalLabel;
          const tagsMatch = tagsEqual(tags, finalTags);
          const accepted = labelMatches && tagsMatch;
          return { annotator, label, tags, accepted };
        });
        return {
          ...details,
          image_uri: item?.image_uri || "",
          actor: log.actor,
          resolved_at: log.created_at,
          log_id: log.log_id,
          annotator_answers: annotatorAnswers,
        };
      });
      return NextResponse.json({ resolved });
    }

    if (action === "samples") {
      const datasetId = searchParams.get("dataset_id");
      if (!datasetId) {
        return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
      }
      const status = searchParams.get("status") || undefined;
      const maxAttempt = qaRepository.getMaxAttempt(datasetId);

      const dataset = dataStore.get<{ qa_status: string }>(
        "SELECT qa_status FROM datasets WHERE dataset_id = ?",
        datasetId
      );
      const isAwaitingNewSamples = dataset?.qa_status === "submitted";

      const currentAttempt = isAwaitingNewSamples ? maxAttempt + 1 : maxAttempt;
      const totalAttempts = currentAttempt;

      const samples = (!isAwaitingNewSamples && maxAttempt > 0)
        ? qaRepository.getSamplesByDataset(datasetId, status, maxAttempt)
        : [];
      const stats = (!isAwaitingNewSamples && maxAttempt > 0)
        ? qaRepository.getSampleStats(datasetId, maxAttempt)
        : { total: 0, reviewed: 0, correct: 0, incorrect: 0, ambiguous: 0 };
      const history = maxAttempt > 0
        ? qaRepository.getSampleHistory(datasetId, isAwaitingNewSamples ? undefined : maxAttempt)
        : [];

      const overrideAttemptRows = dataStore.all<{ attempt_number: number | null }>(
        `SELECT DISTINCT CAST(json_extract(details, '$.qa_attempt_number') AS INTEGER) as attempt_number
         FROM qa_logs
         WHERE dataset_id = ?
           AND action = 'approved'
           AND COALESCE(CAST(json_extract(details, '$.qa_override_applied') AS INTEGER), 0) = 1
           AND json_extract(details, '$.qa_attempt_number') IS NOT NULL`,
        datasetId
      );
      const overrideAttempts = overrideAttemptRows
        .map((r) => r.attempt_number)
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);

      return NextResponse.json({ samples, stats, history, currentAttempt, totalAttempts, override_attempts: overrideAttempts });
    }

    if (action === "logs") {
      const datasetId = searchParams.get("dataset_id") || undefined;
      const logAction = searchParams.get("log_action") || undefined;
      const limit = parseInt(searchParams.get("limit") || "50", 10);
      const offset = parseInt(searchParams.get("offset") || "0", 10);
      const result = qaRepository.getLogs({ datasetId, action: logAction, limit, offset });
      return NextResponse.json(result);
    }

    if (action === "annotators") {
      const annotators = qaRepository.getKnownAnnotators();
      return NextResponse.json({ annotators });
    }

    if (action === "item_details") {
      const itemId = searchParams.get("item_id");
      const predictionId = searchParams.get("prediction_id");
      if (!itemId && !predictionId) {
        return NextResponse.json({ error: "item_id or prediction_id required" }, { status: 400 });
      }
      const result = itemId
        ? qaRepository.getItemWithPrediction(itemId)
        : qaRepository.getItemByPredictionId(predictionId!);
      return NextResponse.json(result);
    }

    if (action === "progress") {
      const datasetId = searchParams.get("dataset_id");
      if (!datasetId) {
        return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
      }
      const progress = datasetRepository.getDatasetProgress(datasetId);
      return NextResponse.json(progress);
    }

    if (action === "transitions") {
      const datasetId = searchParams.get("dataset_id");
      if (!datasetId) {
        return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
      }
      const dataset = datasetRepository.getDatasetById(datasetId);
      if (!dataset) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }
      const currentStatus = dataset.qa_status || "draft";
      const allowed = QA_STATUS_TRANSITIONS[currentStatus] || [];
      return NextResponse.json({ current_status: currentStatus, allowed_transitions: allowed });
    }

    return NextResponse.json({ error: "Unknown action. Use: datasets, discrepancies, resolved_discrepancies, samples, logs, annotators, item_details, progress, transitions" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA GET failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:write", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const action = body?.action;

    if (action === "create_samples") {
      const parsed = QaCreateSamplesSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const sampleIds = qaRepository.createSamples({
        datasetId: data.dataset_id,
        method: data.method,
        count: data.count,
        stratifyBy: data.stratify_by,
        reviewer: data.reviewer,
      });
      qaRepository.updateQaStatus(data.dataset_id, "in_qa");
      const attemptNumber = qaRepository.getMaxAttempt(data.dataset_id);
      qaRepository.createLog({
        datasetId: data.dataset_id,
        action: "samples_generated",
        actor: data.reviewer,
        details: { method: data.method, count: sampleIds.length, attempt_number: attemptNumber },
      });
      return NextResponse.json({ ok: true, sample_ids: sampleIds, count: sampleIds.length, attempt_number: attemptNumber });
    }

    if (action === "accept_samples") {
      const { dataset_id } = body;
      if (!dataset_id) return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
      qaRepository.acceptSamples(dataset_id);
      qaRepository.createLog({ datasetId: dataset_id, action: "samples_accepted", actor: body.actor, details: {} });
      return NextResponse.json({ ok: true });
    }

    if (action === "reset_samples") {
      const { dataset_id } = body;
      if (!dataset_id) return NextResponse.json({ error: "dataset_id required" }, { status: 400 });
      qaRepository.clearSamples(dataset_id);
      qaRepository.createLog({ datasetId: dataset_id, action: "samples_reset", actor: body.actor, details: {} });
      return NextResponse.json({ ok: true });
    }

    if (action === "finalize_pair") {
      const { dataset_id_a, dataset_id_b, name } = body;
      if (!dataset_id_a || !dataset_id_b) {
        return NextResponse.json({ error: "dataset_id_a and dataset_id_b required" }, { status: 400 });
      }
      const datasetA = datasetRepository.getDatasetById(dataset_id_a);
      const datasetB = datasetRepository.getDatasetById(dataset_id_b);
      if (!datasetA || !datasetB) {
        return NextResponse.json({ error: "One or both datasets not found" }, { status: 404 });
      }

      const masterName = name?.trim() || (datasetA.name.replace(/\s*\(Annotator.*?\)\s*$/, "").trim() || datasetA.name) + " (MASTER)";

      const masterId = datasetRepository.createMasterDataset({
        sourceDatasetIdA: dataset_id_a,
        sourceDatasetIdB: dataset_id_b,
        name: masterName,
        detectionId: datasetA.detection_id,
      });

      qaRepository.updateQaStatus(dataset_id_a, "archived");
      qaRepository.updateQaStatus(dataset_id_b, "archived");

      qaRepository.createLog({
        datasetId: masterId,
        action: "master_created",
        actor: body.actor,
        details: { source_a: dataset_id_a, source_b: dataset_id_b },
      });
      qaRepository.createLog({
        datasetId: dataset_id_a,
        action: "archived",
        actor: body.actor,
        details: { reason: "finalized_to_master", master_id: masterId },
      });
      qaRepository.createLog({
        datasetId: dataset_id_b,
        action: "archived",
        actor: body.actor,
        details: { reason: "finalized_to_master", master_id: masterId },
      });

      return NextResponse.json({ ok: true, master_dataset_id: masterId });
    }

    if (action === "submit") {
      const parsed = DatasetSubmitSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const dataset = datasetRepository.getDatasetById(data.dataset_id);
      if (!dataset) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }
      const currentStatus = dataset.qa_status || "draft";
      const allowedFrom = ["in_annotation", "needs_revision", "assigned"];
      if (!allowedFrom.includes(currentStatus)) {
        return NextResponse.json(
          { error: `Cannot submit from status '${currentStatus}'. Must be in_annotation, assigned, or needs_revision.` },
          { status: 400 }
        );
      }
      const progress = datasetRepository.getDatasetProgress(data.dataset_id);
      if (progress.labeled < progress.total) {
        return NextResponse.json(
          { error: `Not all items labeled. ${progress.labeled}/${progress.total} complete.` },
          { status: 400 }
        );
      }
      qaRepository.updateQaStatus(data.dataset_id, "submitted");
      datasetRepository.setRevisionNote(data.dataset_id, null);
      qaRepository.createLog({
        datasetId: data.dataset_id,
        action: "submitted",
        actor: data.actor,
        details: { from: currentStatus, items_labeled: progress.labeled },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA POST failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "qa:write", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const action = body?.action;

    if (action === "update_status") {
      const parsed = QaStatusUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const dataset = datasetRepository.getDatasetById(data.dataset_id);
      if (!dataset) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }
      const oldStatus = dataset.qa_status || "draft";
      const allowedNext = QA_STATUS_TRANSITIONS[oldStatus] || [];
      if (!allowedNext.includes(data.new_status)) {
        return NextResponse.json(
          { error: `Cannot transition from '${oldStatus}' to '${data.new_status}'. Allowed: ${allowedNext.join(", ")}` },
          { status: 400 }
        );
      }

      let approvalAccuracyPct: number | null = null;
      const approvalThreshold = 90;
      let approvalBelowThreshold = false;
      let approvalAttemptNumber: number | null = null;

      if (data.new_status === "approved") {
        const maxAttempt = qaRepository.getMaxAttempt(data.dataset_id);
        approvalAttemptNumber = maxAttempt > 0 ? maxAttempt : null;
        if (maxAttempt > 0) {
          const sampleStats = qaRepository.getSampleStats(data.dataset_id, maxAttempt);
          const allReviewed = sampleStats.total > 0 && sampleStats.reviewed === sampleStats.total;
          if (allReviewed && sampleStats.reviewed > 0) {
            approvalAccuracyPct = Math.round((sampleStats.correct / sampleStats.reviewed) * 100);
            approvalBelowThreshold = approvalAccuracyPct < approvalThreshold;
          }
        }

        if (approvalBelowThreshold && !data.qa_override_reason?.trim()) {
          return NextResponse.json(
            { error: "QA override reason is required to approve a dataset below threshold." },
            { status: 400 }
          );
        }
      }

      qaRepository.updateQaStatus(data.dataset_id, data.new_status);

      if (data.new_status === "needs_revision" && data.revision_note) {
        datasetRepository.setRevisionNote(data.dataset_id, data.revision_note);
      }
      if (data.new_status === "in_annotation" || data.new_status === "submitted") {
        datasetRepository.setRevisionNote(data.dataset_id, null);
      }

      const logAction = data.new_status === "needs_revision" ? "revision_requested"
        : data.new_status === "submitted" ? "submitted"
        : data.new_status === "approved" ? "approved"
        : data.new_status === "finalized" ? "finalized"
        : "status_change";

      qaRepository.createLog({
        datasetId: data.dataset_id,
        action: logAction,
        actor: data.actor,
        details: {
          from: oldStatus,
          to: data.new_status,
          revision_note: data.revision_note,
          qa_override_reason: data.qa_override_reason,
          qa_accuracy_pct: approvalAccuracyPct,
          qa_threshold_pct: data.new_status === "approved" ? approvalThreshold : null,
          qa_override_applied: data.new_status === "approved" ? approvalBelowThreshold : false,
          qa_attempt_number: data.new_status === "approved" ? approvalAttemptNumber : null,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      const parsed = QaAssignSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const dataset = datasetRepository.getDatasetById(data.dataset_id);
      if (!dataset) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }
      qaRepository.assignDataset(data.dataset_id, data.assigned_to);

      if (data.assigned_to && (dataset.qa_status === "draft" || !dataset.qa_status)) {
        qaRepository.updateQaStatus(data.dataset_id, "assigned");
      }

      qaRepository.createLog({
        datasetId: data.dataset_id,
        action: "assigned",
        actor: data.actor,
        details: { assigned_to: data.assigned_to },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "link_datasets") {
      const parsed = QaLinkDatasetsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      qaRepository.linkDatasets(data.dataset_id_a, data.dataset_id_b);
      qaRepository.createLog({
        datasetId: data.dataset_id_a,
        action: "linked",
        details: { linked_to: data.dataset_id_b },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "review_sample") {
      const parsed = QaReviewSampleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const sample = qaRepository.getSampleById(data.sample_id);
      if (!sample) {
        return NextResponse.json({ error: "Sample not found" }, { status: 404 });
      }
      const corrections = (data.original_label !== undefined || data.corrected_label !== undefined || data.original_tags !== undefined || data.corrected_tags !== undefined)
        ? {
            originalLabel: data.original_label ?? null,
            originalTags: data.original_tags ?? null,
            correctedLabel: data.corrected_label ?? null,
            correctedTags: data.corrected_tags ?? null,
          }
        : undefined;
      qaRepository.reviewSample(data.sample_id, data.outcome, data.note || null, data.reviewer, corrections);
      qaRepository.createLog({
        datasetId: sample.dataset_id,
        action: "sample_reviewed",
        actor: data.reviewer,
        details: { sample_id: data.sample_id, outcome: data.outcome },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "resolve_discrepancy") {
      const parsed = QaResolveDiscrepancySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const itemA = dataStore_getItemByImageAndDataset(data.dataset_id_a, data.image_id);
      const itemB = dataStore_getItemByImageAndDataset(data.dataset_id_b, data.image_id);
      const originalLabelA = itemA?.ground_truth_label ?? null;
      const originalLabelB = itemB?.ground_truth_label ?? null;
      const originalTagsA = itemA?.segment_tags ?? null;
      const originalTagsB = itemB?.segment_tags ?? null;
      let resolvedLabel: string | undefined;

      if (data.resolution === "accept_a") {
        resolvedLabel = originalLabelA ?? undefined;
      } else if (data.resolution === "accept_b") {
        resolvedLabel = originalLabelB ?? undefined;
      } else if (data.resolution === "override" && data.override_label) {
        resolvedLabel = data.override_label;
      }

      if (resolvedLabel) {
        updateItemLabelByImage(data.dataset_id_a, data.image_id, resolvedLabel);
        updateItemLabelByImage(data.dataset_id_b, data.image_id, resolvedLabel);
      }

      if (data.corrected_tags) {
        updateItemTagsByImage(data.dataset_id_a, data.image_id, data.corrected_tags);
        updateItemTagsByImage(data.dataset_id_b, data.image_id, data.corrected_tags);
      }

      qaRepository.createLog({
        datasetId: data.dataset_id_a,
        action: "discrepancy_resolved",
        actor: data.actor,
        details: { image_id: data.image_id, resolution: data.resolution, resolved_label: resolvedLabel, original_label_a: originalLabelA, original_label_b: originalLabelB, original_tags_a: originalTagsA, original_tags_b: originalTagsB },
      });
      return NextResponse.json({ ok: true, resolved_label: resolvedLabel });
    }

    if (action === "reopen_discrepancy") {
      const { dataset_id_a, dataset_id_b, image_id } = body;
      if (!dataset_id_a || !dataset_id_b || !image_id) {
        return NextResponse.json({ error: "dataset_id_a, dataset_id_b, and image_id are required" }, { status: 400 });
      }
      const log = qaRepository.getResolvedDiscrepancyLog(dataset_id_a, image_id);
      if (!log) {
        return NextResponse.json({ error: "No resolved discrepancy found for this image" }, { status: 404 });
      }
      const details = JSON.parse(log.details || "{}");
      if (details.original_label_a && details.original_label_b) {
        updateItemLabelByImage(dataset_id_a, image_id, details.original_label_a);
        updateItemLabelByImage(dataset_id_b, image_id, details.original_label_b);
      } else {
        const resolvedLabel = details.resolved_label;
        const oppositeLabel = resolvedLabel === "DETECTED" ? "NOT_DETECTED" : "DETECTED";
        updateItemLabelByImage(dataset_id_b, image_id, oppositeLabel);
      }
      if (details.original_tags_a) {
        updateItemTagsByImage(dataset_id_a, image_id, typeof details.original_tags_a === "string" ? JSON.parse(details.original_tags_a) : details.original_tags_a);
      }
      if (details.original_tags_b) {
        updateItemTagsByImage(dataset_id_b, image_id, typeof details.original_tags_b === "string" ? JSON.parse(details.original_tags_b) : details.original_tags_b);
      }
      qaRepository.deleteResolvedDiscrepancyLog(dataset_id_a, image_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "resolve_nway_discrepancy") {
      const parsed = QaResolveNwaySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
      }
      const data = parsed.data;
      const children = datasetRepository.getChildDatasets(data.parent_id);
      if (children.length === 0) {
        return NextResponse.json({ error: "No children found for parent" }, { status: 404 });
      }

      // When attributes are excluded from the review, tags are not part of the
      // resolution — the parent's tags are set to the union of the children on
      // finalize instead.
      const parentForResolve = datasetRepository.getDatasetById(data.parent_id);
      const excludeAttributesResolve = !!parentForResolve?.exclude_attributes;

      let resolvedLabel: string | null = null;
      let resolvedTags: string[] | null = excludeAttributesResolve ? null : (data.corrected_tags || null);

      if (data.accepted_annotator) {
        const child = children.find((c: any) => (c.assigned_to || c.name) === data.accepted_annotator);
        if (!child) {
          return NextResponse.json({ error: "Annotator not found among children" }, { status: 400 });
        }
        const item = dataStore.get<{ ground_truth_label: string; segment_tags: string }>(
          "SELECT ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ? AND image_id = ?",
          child.dataset_id,
          data.image_id
        );
        if (item) {
          resolvedLabel = item.ground_truth_label;
          if (!resolvedTags && !excludeAttributesResolve) {
            resolvedTags = JSON.parse(item.segment_tags || "[]");
          }
        }
      } else if (data.override_label) {
        resolvedLabel = data.override_label;
      }

      qaRepository.createLog({
        datasetId: data.parent_id,
        action: "nway_discrepancy_resolved",
        actor: data.actor,
        details: {
          image_id: data.image_id,
          resolution: data.accepted_annotator ? `accept_${data.accepted_annotator}` : "override",
          accepted_annotator: data.accepted_annotator || null,
          resolved_label: resolvedLabel,
          corrected_tags: resolvedTags,
        },
      });
      return NextResponse.json({ ok: true, resolved_label: resolvedLabel });
    }

    if (action === "reopen_nway_discrepancy") {
      const { parent_id, image_id } = body;
      if (!parent_id || !image_id) {
        return NextResponse.json({ error: "parent_id and image_id required" }, { status: 400 });
      }
      const log = dataStore.get<{ log_id: string }>(
        `SELECT log_id FROM qa_logs WHERE dataset_id = ? AND action = 'nway_discrepancy_resolved' AND json_extract(details, '$.image_id') = ?`,
        parent_id,
        image_id
      );
      if (!log) {
        return NextResponse.json({ error: "No resolved discrepancy found" }, { status: 404 });
      }
      dataStore.run("DELETE FROM qa_logs WHERE log_id = ?", log.log_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "set_discrepancy_exclude_attributes") {
      const { parent_id, exclude } = body;
      if (!parent_id) {
        return NextResponse.json({ error: "parent_id required" }, { status: 400 });
      }
      const parent = datasetRepository.getDatasetById(parent_id);
      if (!parent) {
        return NextResponse.json({ error: "Parent dataset not found" }, { status: 404 });
      }
      datasetRepository.setExcludeAttributes(parent_id, !!exclude);
      return NextResponse.json({ ok: true, exclude_attributes: !!exclude });
    }

    if (action === "add_annotator") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      qaRepository.addAnnotator(name);
      return NextResponse.json({ ok: true });
    }

    if (action === "remove_annotator") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      qaRepository.removeAnnotator(name);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/qa");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("QA PUT failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function dataStore_getItemByImageAndDataset(datasetId: string, imageId: string) {
  return dataStore.get<{ item_id: string; ground_truth_label: string | null; segment_tags: string | null }>(
    "SELECT item_id, ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ? AND image_id = ?",
    datasetId,
    imageId
  );
}

function updateItemLabelByImage(datasetId: string, imageId: string, label: string) {
  dataStore.run(
    "UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?",
    label,
    datasetId,
    imageId
  );
}

function updateItemTagsByImage(datasetId: string, imageId: string, tags: string[]) {
  dataStore.run(
    "UPDATE dataset_items SET segment_tags = ? WHERE dataset_id = ? AND image_id = ?",
    JSON.stringify(tags),
    datasetId,
    imageId
  );
}
