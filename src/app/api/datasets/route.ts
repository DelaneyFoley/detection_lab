import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import path from "path";
import { applyRateLimit, parseJsonWithSchema, parsePagination, parseSearch, toPaginatedResponse } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { DatasetDeleteSchema } from "@/lib/schemas";
import { fileStore } from "@/lib/services";
import { datasetRepository } from "@/lib/repositories";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const datasetId = req.nextUrl.searchParams.get("dataset_id");
    const search = parseSearch(req.nextUrl.searchParams.get("search"));
    const hasPagination = req.nextUrl.searchParams.has("page") || req.nextUrl.searchParams.has("page_size");
    const { page, pageSize } = parsePagination(req, { page: 1, pageSize: 50 });
    if (datasetId) {
      const { dataset, items } = datasetRepository.getDatasetWithItems(datasetId);
      return NextResponse.json({
        dataset,
        items: items.map((item: any) => ({
          ...item,
          segment_tags: parseSegmentTags(item.segment_tags),
        })),
      });
    }
    const { rows, total } = datasetRepository.listDatasets({
      detectionId: detectionId || undefined,
      search,
      page,
      pageSize,
      paginated: hasPagination,
    });

    if (hasPagination || search) {
      return NextResponse.json(
        toPaginatedResponse(rows, { page, pageSize, total })
      );
    }

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/datasets");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch datasets", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "datasets:write", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const id = uuid();
    const now = new Date().toISOString();
    const contentType = req.headers.get("content-type") || "";

    let name = "";
    let detectionId = "";
    let splitType = "ITERATION";
    let items: any[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      name = String(formData.get("name") || "").trim();
      detectionId = String(formData.get("detection_id") || "").trim();
      splitType = String(formData.get("split_type") || "ITERATION").trim();

      const metaRaw = String(formData.get("items") || "[]");
      const itemMeta = JSON.parse(metaRaw) as Array<{
        image_id: string;
        image_description?: string;
        segment_tags?: string[] | string | null;
        ai_assigned_label?: "DETECTED" | "NOT_DETECTED" | "PARSE_FAIL";
        ai_confidence?: number | null;
        ground_truth_label?: "DETECTED" | "NOT_DETECTED" | null;
      }>;
      const files = formData.getAll("files") as File[];

      if (!name || !detectionId) {
        return NextResponse.json({ error: "name and detection_id are required" }, { status: 400 });
      }
      if (!Array.isArray(itemMeta) || itemMeta.length === 0 || files.length === 0) {
        return NextResponse.json({ error: "files and items are required" }, { status: 400 });
      }
      if (itemMeta.length !== files.length) {
        return NextResponse.json({ error: "items/files length mismatch" }, { status: 400 });
      }

      const metaValidation = validateAndNormalizeItemMetas(itemMeta);
      if (!metaValidation.ok) {
        return NextResponse.json({ error: metaValidation.error }, { status: 400 });
      }

      const savedItems: any[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = itemMeta[i];
        const gt =
          meta?.ground_truth_label === "DETECTED" || meta?.ground_truth_label === "NOT_DETECTED"
            ? meta.ground_truth_label
            : null;

        const ext = path.extname(file.name || "").toLowerCase() || ".jpg";
        const safeBase = sanitizeName(meta.image_id);
        const safeFilename = `${safeBase}${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const imageUri = await fileStore.writeDatasetFile(id, safeFilename, buffer);

        savedItems.push({
          image_id: meta.image_id,
          image_uri: imageUri,
          image_description: meta.image_description || "",
          segment_tags: normalizeSegmentTags(meta.segment_tags),
          ai_assigned_label: null,
          ai_confidence: null,
          ground_truth_label: gt,
        });
      }

      items = savedItems;
    } else {
      const body = await req.json();

      if (body?.action === "create_split_datasets") {
        const namePrefix = String(body.name_prefix || "").trim();
        const detectionId = String(body.detection_id || "").trim();
        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (!namePrefix || !detectionId) {
          return NextResponse.json({ error: "name_prefix and detection_id are required" }, { status: 400 });
        }
        if (rawItems.length === 0) {
          return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
        }

        const normalizeRes = validateAndNormalizeItems(rawItems);
        if (!normalizeRes.ok) {
          return NextResponse.json({ error: normalizeRes.error }, { status: 400 });
        }

        const normalized = normalizeRes.items.map((item) => {
          const label = String(item.ground_truth_label || "").trim().toUpperCase();
          return {
            image_id: String(item.image_id || "").trim(),
            image_uri: String(item.image_uri || "").trim(),
            image_description: String(item.image_description || ""),
            segment_tags: normalizeSegmentTags(item.segment_tags),
            ground_truth_label:
              label === "DETECTED" || label === "NOT_DETECTED"
                ? (label as "DETECTED" | "NOT_DETECTED")
                : null,
          };
        });

        if (normalized.some((item) => !item.image_uri)) {
          return NextResponse.json({ error: "Each item needs image_uri for auto-splitting." }, { status: 400 });
        }
        if (normalized.some((item) => !item.ground_truth_label)) {
          return NextResponse.json(
            { error: "Each item needs ground_truth_label (DETECTED|NOT_DETECTED) for auto-splitting." },
            { status: 400 }
          );
        }

        const shuffled = shuffle([...normalized]);

        const detected = shuffled.filter((item) => item.ground_truth_label === "DETECTED");
        const notDetected = shuffled.filter((item) => item.ground_truth_label === "NOT_DETECTED");
        const splits = {
          ITERATION: [] as typeof normalized,
          GOLDEN: [] as typeof normalized,
          HELD_OUT_EVAL: [] as typeof normalized,
        };
        const order: Array<keyof typeof splits> = ["ITERATION", "GOLDEN", "HELD_OUT_EVAL"];

        const allocateByRatios = (bucket: typeof normalized, ratios: [number, number, number] = [0.7, 0.15, 0.15]) => {
          if (bucket.length === 0) return;
          const counts = countsByRatios(bucket.length, ratios);
          const assignments = assignWithSecondarySegmentBalancing(bucket, counts, order);
          for (const splitKey of order) {
            splits[splitKey].push(...assignments[splitKey]);
          }
        };

        allocateByRatios(detected);
        allocateByRatios(notDetected);

        const now = new Date().toISOString();
        const createDatasetWithItems = (
          splitType: "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL",
          splitItems: typeof normalized
        ) => {
          const datasetId = uuid();
          const hashContent = JSON.stringify(
            splitItems.map((i) => ({
              image_id: i.image_id,
              label: i.ground_truth_label,
              segment_tags: i.segment_tags || [],
            }))
          );
          const hash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 16);
          const splitLabel = splitType === "ITERATION" ? "TRAIN" : splitType === "GOLDEN" ? "TEST" : "EVAL";
          datasetRepository.createDataset({
            datasetId,
            name: `${namePrefix} (${splitLabel})`,
            detectionId,
            splitType,
            datasetHash: hash,
            size: splitItems.length,
            createdAt: now,
            updatedAt: now,
          });

          datasetRepository.insertDatasetItems(
            splitItems.map((item) => ({
              itemId: uuid(),
              datasetId,
              imageId: item.image_id,
              imageUri: item.image_uri,
              imageDescription: item.image_description || "",
              segmentTagsJson: JSON.stringify(item.segment_tags || []),
              groundTruthLabel: item.ground_truth_label,
            }))
          );
          return { dataset_id: datasetId, split_type: splitType, size: splitItems.length, name: `${namePrefix} (${splitLabel})` };
        };

        const created = [
          createDatasetWithItems("ITERATION", splits.ITERATION),
          createDatasetWithItems("GOLDEN", splits.GOLDEN),
          createDatasetWithItems("HELD_OUT_EVAL", splits.HELD_OUT_EVAL),
        ];

        return NextResponse.json({
          created,
          totals: {
            total: normalized.length,
            detected: detected.length,
            not_detected: notDetected.length,
          },
        });
      }

      name = body.name;
      detectionId = body.detection_id;
      splitType = body.split_type;
      items = body.items || [];
    }

    const postValidation = validateAndNormalizeItems(items);
    if (!postValidation.ok) {
      return NextResponse.json({ error: postValidation.error }, { status: 400 });
    }
    items = postValidation.items;

    const hashContent = JSON.stringify(
      items.map((i: any) => ({
        image_id: i.image_id,
        label: i.ground_truth_label,
        segment_tags: normalizeSegmentTags(i.segment_tags),
      }))
    );
    const hash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 16);

    datasetRepository.createDataset({
      datasetId: id,
      name,
      detectionId,
      splitType,
      datasetHash: hash,
      size: items.length,
      createdAt: now,
      updatedAt: now,
    });

    datasetRepository.insertDatasetItems(
      items.map((item) => ({
        itemId: uuid(),
        datasetId: id,
        imageId: item.image_id,
        imageUri: item.image_uri,
        imageDescription: item.image_description || "",
        segmentTagsJson: JSON.stringify(normalizeSegmentTags(item.segment_tags)),
        groundTruthLabel: item.ground_truth_label ?? null,
      }))
    );

    return NextResponse.json({ dataset_id: id });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/datasets");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create dataset", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function sanitizeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
}

export async function DELETE(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "datasets:delete", maxRequests: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, DatasetDeleteSchema);
    if (!parsedBody.success) return parsedBody.response;
    const datasetId = parsedBody.data.dataset_id;

    datasetRepository.deleteDatasetCascade(datasetId);

    await fileStore.removeDatasetUploadDir(datasetId);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/datasets");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete dataset", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { key: "datasets:update", maxRequests: 45, windowMs: 60_000 });
  if (rateLimited) return rateLimited;
  const now = new Date().toISOString();
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const action = String(formData.get("action") || "").trim();

    if (action === "append_files") {
      const datasetId = String(formData.get("dataset_id") || "").trim();
      if (!datasetId) {
        return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
      }
      const dataset = datasetRepository.getDatasetById(datasetId);
      if (!dataset) {
        return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
      }

      const files = formData.getAll("files") as File[];
      const metaRaw = String(formData.get("items") || "[]");
      const itemMeta = JSON.parse(metaRaw) as Array<{
        image_id: string;
        image_description?: string;
        segment_tags?: string[] | string | null;
        ground_truth_label?: "DETECTED" | "NOT_DETECTED" | null;
      }>;
      if (!Array.isArray(files) || files.length === 0) {
        return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
      }
      if (!Array.isArray(itemMeta) || itemMeta.length !== files.length) {
        return NextResponse.json({ error: "items/files length mismatch" }, { status: 400 });
      }

      const seen = new Set<string>();
      const existingIds = new Set<string>(datasetRepository.getDatasetImageIds(datasetId).map((v) => String(v || "").trim()));

      for (let i = 0; i < itemMeta.length; i++) {
        const imageId = normalizeImageId(itemMeta[i]?.image_id);
        if (!imageId) return NextResponse.json({ error: `image_id cannot be blank (item ${i + 1})` }, { status: 400 });
        if (seen.has(imageId) || existingIds.has(imageId)) {
          return NextResponse.json({ error: `Duplicate image_id: ${imageId}` }, { status: 400 });
        }
        seen.add(imageId);
        itemMeta[i].image_id = imageId;
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = itemMeta[i];
        const ext = path.extname(file.name || "").toLowerCase() || ".jpg";
        const safeBase = sanitizeName(meta.image_id);
        const safeFilename = `${safeBase}${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const imageUri = await fileStore.writeDatasetFile(datasetId, safeFilename, buffer);

        datasetRepository.insertDatasetItem({
          itemId: uuid(),
          datasetId,
          imageId: meta.image_id,
          imageUri,
          imageDescription: meta.image_description || "",
          segmentTagsJson: JSON.stringify(normalizeSegmentTags(meta.segment_tags)),
          groundTruthLabel:
            meta.ground_truth_label === "DETECTED" || meta.ground_truth_label === "NOT_DETECTED"
              ? meta.ground_truth_label
              : null,
        });
      }

      datasetRepository.refreshDatasetStats(datasetId, now);
      return NextResponse.json({ ok: true, added: files.length });
    }
  }

  const body = await req.json();

  if (body.action === "bulk_update_items") {
    const datasetId = String(body.dataset_id || "").trim();
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
    }

    const dataset = datasetRepository.getDatasetById(datasetId);
    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    const allItems = datasetRepository.getDatasetItemsForDataset(datasetId);
    const imageByItemId = new Map<string, string>(allItems.map((item) => [item.item_id, normalizeImageId(item.image_id)]));
    const pendingUpdates: Array<{
      itemId: string;
      imageId: string;
      imageUri: string;
      imageDescription: string;
      segmentTagsJson: string;
      aiAssignedLabel: string | null;
      aiConfidence: number | null;
      groundTruthLabel: string | null;
    }> = [];
    const seenItemIds = new Set<string>();

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i] ?? {};
      const itemId = String(item.item_id || "").trim();
      if (!itemId) {
        return NextResponse.json({ error: `item_id is required (item ${i + 1})` }, { status: 400 });
      }
      if (seenItemIds.has(itemId)) {
        return NextResponse.json({ error: `Duplicate item_id in request: ${itemId}` }, { status: 400 });
      }
      seenItemIds.add(itemId);

      const existing = datasetRepository.getDatasetItemById(itemId);
      if (!existing || existing.dataset_id !== datasetId) {
        return NextResponse.json({ error: `Invalid item_id for dataset: ${itemId}` }, { status: 400 });
      }

      const nextImageId = normalizeImageId(item.image_id ?? existing.image_id);
      if (!nextImageId) {
        return NextResponse.json({ error: `image_id cannot be blank (item ${i + 1})` }, { status: 400 });
      }

      imageByItemId.set(itemId, nextImageId);
      pendingUpdates.push({
        itemId,
        imageId: nextImageId,
        imageUri: item.image_uri ?? existing.image_uri,
        imageDescription: item.image_description ?? existing.image_description ?? "",
        segmentTagsJson: JSON.stringify(
          Object.prototype.hasOwnProperty.call(item, "segment_tags")
            ? normalizeSegmentTags(item.segment_tags)
            : parseSegmentTags(existing.segment_tags)
        ),
        aiAssignedLabel: existing.ai_assigned_label ?? null,
        aiConfidence: existing.ai_confidence ?? null,
        groundTruthLabel: Object.prototype.hasOwnProperty.call(item, "ground_truth_label")
          ? item.ground_truth_label ?? null
          : existing.ground_truth_label ?? null,
      });
    }

    const seenImageIds = new Set<string>();
    for (const imageId of imageByItemId.values()) {
      if (seenImageIds.has(imageId)) {
        return NextResponse.json({ error: `Duplicate image_id: ${imageId}` }, { status: 400 });
      }
      seenImageIds.add(imageId);
    }

    datasetRepository.bulkUpdateDatasetItems(pendingUpdates);
    datasetRepository.refreshDatasetStats(datasetId, now);
    return NextResponse.json({ ok: true, updated: pendingUpdates.length });
  }

  if (body.item_id) {
    const existing = datasetRepository.getDatasetItemById(body.item_id);
    if (!existing) {
      return NextResponse.json({ error: "Dataset item not found" }, { status: 404 });
    }

    let nextImageUri = body.image_uri ?? existing.image_uri;
    const nextImageId = normalizeImageId(body.image_id ?? existing.image_id);
    if (!nextImageId) {
      return NextResponse.json({ error: "image_id cannot be blank" }, { status: 400 });
    }
    const duplicate = datasetRepository.getDuplicateImageItem(existing.dataset_id, nextImageId, body.item_id);
    if (duplicate) {
      return NextResponse.json({ error: `Duplicate image_id: ${nextImageId}` }, { status: 400 });
    }
    const nextImageDescription = body.image_description ?? existing.image_description ?? "";
    const nextGroundTruth =
      Object.prototype.hasOwnProperty.call(body, "ground_truth_label")
        ? body.ground_truth_label
        : existing.ground_truth_label;
    const nextSegmentTags = Object.prototype.hasOwnProperty.call(body, "segment_tags")
      ? normalizeSegmentTags(body.segment_tags)
      : parseSegmentTags(existing.segment_tags);

    // If a local upload path is being renamed, rename underlying file too.
    if (typeof body.image_uri === "string" && body.image_uri !== existing.image_uri) {
      nextImageUri = await fileStore.renameLocalUri(existing.image_uri, body.image_uri);
    }

    datasetRepository.updateDatasetItem({
      itemId: body.item_id,
      imageId: nextImageId,
      imageUri: nextImageUri,
      imageDescription: nextImageDescription,
      segmentTagsJson: JSON.stringify(nextSegmentTags),
      aiAssignedLabel: existing.ai_assigned_label ?? null,
      aiConfidence: existing.ai_confidence ?? null,
      groundTruthLabel: nextGroundTruth ?? null,
    });

    datasetRepository.refreshDatasetStats(existing.dataset_id, now);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "delete_item") {
    if (!body.item_id) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    const existing = datasetRepository.getDatasetItemById(body.item_id);
    if (!existing) {
      return NextResponse.json({ error: "Dataset item not found" }, { status: 404 });
    }
    datasetRepository.deleteDatasetItem(body.item_id);
    await fileStore.removeLocalUri(existing.image_uri || "");
    datasetRepository.refreshDatasetStats(existing.dataset_id, now);
    return NextResponse.json({ ok: true });
  }

  if (!body.dataset_id) {
    return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
  }

  const dataset = datasetRepository.getDatasetById(body.dataset_id);
  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  datasetRepository.updateDatasetMeta(
    body.dataset_id,
    body.name ?? dataset.name,
    body.split_type ?? dataset.split_type,
    now
  );

  datasetRepository.refreshDatasetStats(body.dataset_id, now);
  return NextResponse.json({ ok: true });
}

function normalizeImageId(value: unknown): string {
  return String(value ?? "").trim();
}

function validateAndNormalizeItemMetas(
  items: Array<{
    image_id: string;
    image_description?: string;
    segment_tags?: string[] | string | null;
    ai_assigned_label?: "DETECTED" | "NOT_DETECTED" | "PARSE_FAIL";
    ai_confidence?: number | null;
    ground_truth_label?: "DETECTED" | "NOT_DETECTED" | null;
  }>
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const imageId = normalizeImageId(items[i]?.image_id);
    if (!imageId) return { ok: false, error: `image_id cannot be blank (item ${i + 1})` };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate image_id: ${imageId}` };
    seen.add(imageId);
    items[i].image_id = imageId;
  }
  return { ok: true };
}

function validateAndNormalizeItems(
  items: any[]
): { ok: true; items: any[] } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "items must be a non-empty array" };
  }
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const imageId = normalizeImageId(item.image_id);
    if (!imageId) return { ok: false, error: `image_id cannot be blank (item ${i + 1})` };
    if (seen.has(imageId)) return { ok: false, error: `Duplicate image_id: ${imageId}` };
    seen.add(imageId);
    item.image_id = imageId;
  }
  return { ok: true, items };
}

function countsByRatios(total: number, ratios: [number, number, number]): [number, number, number] {
  const exact = ratios.map((r) => r * total);
  const counts = exact.map((v) => Math.floor(v)) as [number, number, number];
  let remaining = total - counts.reduce((acc, n) => acc + n, 0);
  const remainders = exact
    .map((v, idx) => ({ idx, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  let k = 0;
  while (remaining > 0) {
    counts[remainders[k % remainders.length].idx] += 1;
    remaining -= 1;
    k += 1;
  }
  return counts;
}

function assignWithSecondarySegmentBalancing<T extends { segment_tags?: string[] }>(
  bucket: T[],
  counts: [number, number, number],
  order: Array<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL">
): Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", T[]> {
  const assignments: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", T[]> = {
    ITERATION: [],
    GOLDEN: [],
    HELD_OUT_EVAL: [],
  };
  const remaining = {
    ITERATION: counts[0],
    GOLDEN: counts[1],
    HELD_OUT_EVAL: counts[2],
  };
  const segmentCounts: Record<"ITERATION" | "GOLDEN" | "HELD_OUT_EVAL", Map<string, number>> = {
    ITERATION: new Map(),
    GOLDEN: new Map(),
    HELD_OUT_EVAL: new Map(),
  };

  const prioritized = [...bucket].sort((a, b) => (b.segment_tags?.length || 0) - (a.segment_tags?.length || 0));
  for (const item of prioritized) {
    const tags = normalizeSegmentTags(item.segment_tags);
    const candidates = order.filter((split) => remaining[split] > 0);
    if (candidates.length === 0) break;

    let bestSplit = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const split of candidates) {
      const cap = Math.max(1, counts[order.indexOf(split)]);
      const loadPenalty = assignments[split].length / cap;
      let segmentPenalty = 0;
      for (const tag of tags) {
        segmentPenalty += segmentCounts[split].get(tag) || 0;
      }
      const score = segmentPenalty + loadPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestSplit = split;
      }
    }

    assignments[bestSplit].push(item);
    remaining[bestSplit] -= 1;
    for (const tag of tags) {
      segmentCounts[bestSplit].set(tag, (segmentCounts[bestSplit].get(tag) || 0) + 1);
    }
  }

  return assignments;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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
  return [];
}

function normalizeSegmentTags(value: unknown): string[] {
  if (value == null) return [];
  const rawParts = Array.isArray(value)
    ? value.map((v) => String(v || ""))
    : String(value)
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
  return tags;
}
