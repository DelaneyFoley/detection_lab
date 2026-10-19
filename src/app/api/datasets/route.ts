import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import path from "path";
import { applyRateLimit, parseJsonWithSchema, parsePagination, parseSearch, toPaginatedResponse } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { DatasetDeleteSchema, DatasetDuplicateSchema, DatasetAssignAnnotatorsSchema, DatasetFinalizeParentSchema } from "@/lib/schemas";
import { isDatasetSplitType } from "@/lib/splitType";
import { fileStore } from "@/lib/services";
import { datasetRepository, qaRepository, notificationRepository, reviewRepository, detectionRepository } from "@/lib/repositories";
import { computeMetricsWithSegments } from "@/lib/metrics";
import { stratifyMultiLabel } from "@/lib/multiLabelStratify";
import { seedBundledDatasets } from "@/lib/seed";

export async function GET(req: NextRequest) {
  try {
    seedBundledDatasets();
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const datasetId = req.nextUrl.searchParams.get("dataset_id");
    const childrenOf = req.nextUrl.searchParams.get("children_of");
    const includeUnassigned = req.nextUrl.searchParams.get("include_unassigned") === "1";
    const unassignedOnly = req.nextUrl.searchParams.get("unassigned") === "1";
    const search = parseSearch(req.nextUrl.searchParams.get("search"));
    const hasPagination = req.nextUrl.searchParams.has("page") || req.nextUrl.searchParams.has("page_size");
    const { page, pageSize } = parsePagination(req, { page: 1, pageSize: 50 });

    if (childrenOf) {
      const children = datasetRepository.getChildDatasets(childrenOf);
      return NextResponse.json({ children });
    }

    const correctionsOf = req.nextUrl.searchParams.get("corrections");
    if (correctionsOf) {
      const corrections = datasetRepository.getAnnotatorCorrections(correctionsOf);
      const child = datasetRepository.getDatasetById(correctionsOf);
      const parent = child?.linked_dataset_id ? datasetRepository.getDatasetById(child.linked_dataset_id) : null;
      return NextResponse.json({ corrections, exclude_attributes: !!parent?.exclude_attributes });
    }

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
      includeUnassigned,
      unassignedOnly,
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
    let detectionId: string | null = null;
    let splitType = "ITERATION";
    let items: any[] = [];
    let segmentTaxonomy: string[] | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      name = String(formData.get("name") || "").trim();
      detectionId = String(formData.get("detection_id") || "").trim() || null;
      splitType = String(formData.get("split_type") || "ITERATION").trim();
      if (!isDatasetSplitType(splitType)) {
        return NextResponse.json({ error: `Invalid split_type: ${splitType}` }, { status: 400 });
      }
      const taxonomyRaw = formData.get("segment_taxonomy");
      if (typeof taxonomyRaw === "string" && taxonomyRaw.length > 0) {
        try {
          const parsed = JSON.parse(taxonomyRaw);
          if (Array.isArray(parsed)) segmentTaxonomy = parsed.map(String);
        } catch {
          /* ignore malformed taxonomy */
        }
      }

      const metaRaw = String(formData.get("items") || "[]");
      const itemMeta = JSON.parse(metaRaw) as Array<{
        image_id: string;
        image_description?: string;
        segment_tags?: string[] | string | null;
        ai_assigned_label?: "DETECTED" | "NOT_DETECTED" | "PARSE_FAIL";
        ai_confidence?: number | null;
        ground_truth_label?: "DETECTED" | "NOT_DETECTED" | null;
        ground_truth_labels?: string[] | string | null;
      }>;
      const files = formData.getAll("files") as File[];

      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
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

      const formUploadIds = itemMeta.map((m) => String(m.image_id || "")).filter(Boolean);
      const formDuplicates = datasetRepository.findDuplicateImageIds(formUploadIds);
      if (formDuplicates.length > 0) {
        const first = formDuplicates[0];
        return NextResponse.json(
          { error: `Duplicate image_id "${first.image_id}" already exists in dataset "${first.dataset_name}".` },
          { status: 400 }
        );
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
          ground_truth_labels: normalizeGroundTruthLabels(meta.ground_truth_labels),
        });
      }

      items = savedItems;
    } else {
      const body = await req.json();

      // Preview a multi-label merge: dedupe source dataset items by frame URL and
      // fold each source detection's production label into per-frame GT. Frames not
      // reviewed for a given detection become coverage gaps the user must resolve.
      if (body?.action === "merge_preview") {
        const datasetIds: string[] = Array.isArray(body.dataset_ids) ? body.dataset_ids.map(String) : [];
        if (datasetIds.length < 2) {
          return NextResponse.json({ error: "Select at least two datasets to merge." }, { status: 400 });
        }
        const sources: Array<{ dataset_id: string; name: string; label: string }> = [];
        const missing: Array<{ dataset_id: string; name: string; reason: string }> = [];
        for (const did of datasetIds) {
          const ds = datasetRepository.getDatasetById(did);
          if (!ds) {
            missing.push({ dataset_id: did, name: did, reason: "dataset not found" });
            continue;
          }
          const det = ds.detection_id ? detectionRepository.getDetectionById(ds.detection_id) : null;
          const label = det?.production_label ? String(det.production_label).trim() : "";
          if (!label) {
            missing.push({
              dataset_id: did,
              name: ds.name,
              reason: det ? "linked detection has no Production Label" : "no linked detection",
            });
            continue;
          }
          sources.push({ dataset_id: did, name: ds.name, label });
        }
        if (missing.length > 0) {
          return NextResponse.json(
            { error: "Some datasets can't be merged until their detection has a Production Label.", missing_label_datasets: missing },
            { status: 400 }
          );
        }

        const labels = Array.from(new Set(sources.map((s) => s.label)));
        type FrameState = {
          image_uri: string;
          present: Set<string>;
          absent: Set<string>;
          attributes: Set<string>;
        };
        const byFrame = new Map<string, FrameState>();
        // Union of attribute options across all source datasets' taxonomies + any
        // applied tags, so the merged dataset keeps the full attribute list.
        const attributeVocab = new Set<string>();
        for (const src of sources) {
          const { dataset: ds, items: dsItems } = datasetRepository.getDatasetWithItems(src.dataset_id);
          for (const t of normalizeSegmentTags(ds?.segment_taxonomy)) attributeVocab.add(t);
          for (const it of dsItems) {
            const url = String(it.image_uri || "").trim();
            if (!url) continue;
            let fs = byFrame.get(url);
            if (!fs) {
              fs = { image_uri: url, present: new Set(), absent: new Set(), attributes: new Set() };
              byFrame.set(url, fs);
            }
            if (it.ground_truth_label === "DETECTED") fs.present.add(src.label);
            else if (it.ground_truth_label === "NOT_DETECTED") fs.absent.add(src.label);
            // null/unlabeled → neither present nor absent → becomes a coverage gap.
            for (const t of normalizeSegmentTags(it.segment_tags)) {
              fs.attributes.add(t);
              attributeVocab.add(t);
            }
          }
        }

        const frames = Array.from(byFrame.values()).map((fs) => {
          // A label is a gap when it was never reviewed OR annotators disagreed
          // (present in one dataset, absent in another) — both need resolution.
          const definitivePresent = labels.filter((l) => fs.present.has(l) && !fs.absent.has(l));
          const definitiveAbsent = labels.filter((l) => fs.absent.has(l) && !fs.present.has(l));
          const conflicts = labels.filter((l) => fs.present.has(l) && fs.absent.has(l));
          const gaps = labels.filter((l) => !definitivePresent.includes(l) && !definitiveAbsent.includes(l));
          return {
            image_uri: fs.image_uri,
            present: definitivePresent,
            absent: definitiveAbsent,
            gaps,
            conflicts,
            attributes: Array.from(fs.attributes),
          };
        });

        return NextResponse.json({
          labels,
          sources,
          frames,
          attribute_vocabulary: Array.from(attributeVocab).sort((a, b) => a.localeCompare(b)),
          total_frames: frames.length,
          frames_with_gaps: frames.filter((f) => f.gaps.length > 0).length,
          conflict_frames: frames.filter((f) => f.conflicts.length > 0).length,
        });
      }

      if (body?.action === "create_split_datasets") {
        const namePrefix = String(body.name_prefix || "").trim();
        const detectionId = String(body.detection_id || "").trim() || null;
        const masterDatasetId = String(body.master_dataset_id || "").trim() || null;
        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (!namePrefix) {
          return NextResponse.json({ error: "name_prefix is required" }, { status: 400 });
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
            ground_truth_labels: normalizeGroundTruthLabels(item.ground_truth_labels),
          };
        });

        if (normalized.some((item) => !item.image_uri)) {
          return NextResponse.json({ error: "Each item needs image_uri for auto-splitting." }, { status: 400 });
        }

        // Multi-label datasets stratify over the label set via iterative
        // stratification; binary datasets stratify over DETECTED/NOT_DETECTED.
        const isMultiLabel = normalized.some((item) => item.ground_truth_labels.length > 0);
        if (!isMultiLabel && normalized.some((item) => !item.ground_truth_label)) {
          return NextResponse.json(
            { error: "Each item needs ground_truth_label (DETECTED|NOT_DETECTED) for auto-splitting." },
            { status: 400 }
          );
        }

        const splits = {
          ITERATION: [] as typeof normalized,
          GOLDEN: [] as typeof normalized,
          HELD_OUT_EVAL: [] as typeof normalized,
        };
        const order: Array<keyof typeof splits> = ["ITERATION", "GOLDEN", "HELD_OUT_EVAL"];

        let detected = 0;
        let notDetected = 0;
        if (isMultiLabel) {
          const stratified = stratifyMultiLabel(
            shuffle([...normalized]),
            (item) => item.ground_truth_labels,
            [
              { key: "ITERATION", ratio: 0.5 },
              { key: "GOLDEN", ratio: 0.2 },
              { key: "HELD_OUT_EVAL", ratio: 0.3 },
            ]
          );
          for (const splitKey of order) splits[splitKey].push(...stratified[splitKey]);
        } else {
          const shuffled = shuffle([...normalized]);
          const detectedItems = shuffled.filter((item) => item.ground_truth_label === "DETECTED");
          const notDetectedItems = shuffled.filter((item) => item.ground_truth_label === "NOT_DETECTED");
          detected = detectedItems.length;
          notDetected = notDetectedItems.length;
          const allocateByRatios = (bucket: typeof normalized, ratios: [number, number, number] = [0.5, 0.2, 0.3]) => {
            if (bucket.length === 0) return;
            const counts = countsByRatios(bucket.length, ratios);
            const assignments = assignWithSecondarySegmentBalancing(bucket, counts, order);
            for (const splitKey of order) {
              splits[splitKey].push(...assignments[splitKey]);
            }
          };
          allocateByRatios(detectedItems);
          allocateByRatios(notDetectedItems);
        }

        const now = new Date().toISOString();
        const createDatasetWithItems = async (
          splitType: "ITERATION" | "GOLDEN" | "HELD_OUT_EVAL",
          splitItems: typeof normalized
        ) => {
          const datasetId = uuid();
          const hashContent = JSON.stringify(
            splitItems.map((i) => ({
              image_id: i.image_id,
              label: i.ground_truth_label,
              labels: i.ground_truth_labels || [],
              segment_tags: i.segment_tags || [],
            }))
          );
          const hash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 16);
          const splitLabel = splitType === "ITERATION" ? "TRAIN" : splitType === "GOLDEN" ? "TEST" : "EVALUATE";
          datasetRepository.createDataset({
            datasetId,
            name: `${namePrefix} (${splitLabel})`,
            detectionId,
            splitType,
            datasetHash: hash,
            size: splitItems.length,
            createdAt: now,
            updatedAt: now,
            splitParentId: masterDatasetId,
            qaStatus: "finalized",
          });

          datasetRepository.insertDatasetItems(
            await Promise.all(
              splitItems.map(async (item) => {
                const localAbs = fileStore.localUriToAbsPath(item.image_uri);
                const ext = localAbs ? path.extname(localAbs) : path.extname(item.image_uri || "");
                const safeFilename = `${sanitizeName(item.image_id)}${ext.toLowerCase() || ".jpg"}`;
                const imageUri = localAbs
                  ? await fileStore.copyLocalUriToDataset(datasetId, item.image_uri, safeFilename)
                  : item.image_uri;
                return {
                  itemId: uuid(),
                  datasetId,
                  imageId: item.image_id,
                  imageUri,
                  imageDescription: item.image_description || "",
                  segmentTagsJson: JSON.stringify(item.segment_tags || []),
                  groundTruthLabel: item.ground_truth_label,
                  groundTruthLabelsJson: JSON.stringify(item.ground_truth_labels || []),
                };
              })
            )
          );
          datasetRepository.refreshItemsLabeledCount(datasetId);
          return { dataset_id: datasetId, split_type: splitType, size: splitItems.length, name: `${namePrefix} (${splitLabel})` };
        };

        const created = await Promise.all([
          createDatasetWithItems("ITERATION", splits.ITERATION),
          createDatasetWithItems("GOLDEN", splits.GOLDEN),
          createDatasetWithItems("HELD_OUT_EVAL", splits.HELD_OUT_EVAL),
        ]);

        return NextResponse.json({
          created,
          multi_label: isMultiLabel,
          totals: {
            total: normalized.length,
            detected,
            not_detected: notDetected,
          },
        });
      }

      name = body.name;
      detectionId = String(body.detection_id || "").trim() || null;
      splitType = body.split_type;
      if (!isDatasetSplitType(String(splitType || ""))) {
        return NextResponse.json({ error: `Invalid split_type: ${splitType}` }, { status: 400 });
      }
      items = body.items || [];
      if (Array.isArray(body.segment_taxonomy)) {
        segmentTaxonomy = body.segment_taxonomy.map(String);
      }
    }

    const postValidation = validateAndNormalizeItems(items);
    if (!postValidation.ok) {
      return NextResponse.json({ error: postValidation.error }, { status: 400 });
    }
    items = postValidation.items;

    const uploadImageIds = items.map((i: any) => String(i.image_id || "")).filter(Boolean);
    const duplicates = datasetRepository.findDuplicateImageIds(uploadImageIds);
    if (duplicates.length > 0) {
      const first = duplicates[0];
      return NextResponse.json(
        { error: `Duplicate image_id "${first.image_id}" already exists in dataset "${first.dataset_name}".` },
        { status: 400 }
      );
    }

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
      segmentTaxonomy,
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
        groundTruthLabelsJson: JSON.stringify(normalizeGroundTruthLabels(item.ground_truth_labels)),
      }))
    );

    datasetRepository.refreshItemsLabeledCount(id);

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
        ground_truth_labels?: string[] | string | null;
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
          groundTruthLabelsJson: JSON.stringify(normalizeGroundTruthLabels(meta.ground_truth_labels)),
        });
      }

      datasetRepository.refreshDatasetStats(datasetId, now);
      return NextResponse.json({ ok: true, added: files.length });
    }
  }

  const body = await req.json();

  if (body.action === "append_items") {
    const datasetId = String(body.dataset_id || "").trim();
    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }
    const dataset = datasetRepository.getDatasetById(datasetId);
    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
    }

    const existingIds = new Set<string>(
      datasetRepository.getDatasetImageIds(datasetId).map((v) => String(v || "").trim())
    );
    const seen = new Set<string>();
    const prepared: Array<{
      itemId: string;
      datasetId: string;
      imageId: string;
      imageUri: string;
      imageDescription: string;
      segmentTagsJson: string;
      groundTruthLabel: "DETECTED" | "NOT_DETECTED" | null;
      groundTruthLabelsJson: string;
    }> = [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i] ?? {};
      const imageId = normalizeImageId(item.image_id);
      if (!imageId) return NextResponse.json({ error: `image_id cannot be blank (item ${i + 1})` }, { status: 400 });
      const imageUri = String(item.image_uri ?? "").trim();
      if (!imageUri) return NextResponse.json({ error: `image_uri cannot be blank (item ${i + 1})` }, { status: 400 });
      if (seen.has(imageId) || existingIds.has(imageId)) {
        return NextResponse.json({ error: `Duplicate image_id: ${imageId}` }, { status: 400 });
      }
      seen.add(imageId);
      const label = item.ground_truth_label;
      prepared.push({
        itemId: uuid(),
        datasetId,
        imageId,
        imageUri,
        imageDescription: item.image_description || "",
        segmentTagsJson: JSON.stringify(normalizeSegmentTags(item.segment_tags)),
        groundTruthLabel: label === "DETECTED" || label === "NOT_DETECTED" ? label : null,
        groundTruthLabelsJson: JSON.stringify(normalizeGroundTruthLabels(item.ground_truth_labels)),
      });
    }

    datasetRepository.insertDatasetItems(prepared);
    datasetRepository.refreshDatasetStats(datasetId, now);
    datasetRepository.refreshItemsLabeledCount(datasetId);
    return NextResponse.json({ ok: true, added: prepared.length });
  }

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
      groundTruthLabelsJson?: string;
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
        groundTruthLabelsJson: Object.prototype.hasOwnProperty.call(item, "ground_truth_labels")
          ? JSON.stringify(normalizeGroundTruthLabels(item.ground_truth_labels))
          : existing.ground_truth_labels ?? "[]",
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
    datasetRepository.refreshItemsLabeledCount(datasetId);

    // Keep split <-> master in sync in whichever direction applies: editing a
    // split carries up to its MASTER; editing a MASTER carries down to its splits.
    const masterSync = datasetRepository.propagateLabelsToMaster(datasetId, now);
    datasetRepository.propagateLabelsToSplits(datasetId, now);

    const currentStatus = dataset.qa_status || "draft";
    if (currentStatus === "assigned") {
      qaRepository.updateQaStatus(datasetId, "in_annotation");
    }

    return NextResponse.json({ ok: true, updated: pendingUpdates.length, master_synced: masterSync.updated });
  }

  if (body.action === "update_attributes") {
    const datasetId = String(body.dataset_id || "").trim();
    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }
    const dataset = datasetRepository.getDatasetById(datasetId);
    if (!dataset) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }
    const taxonomy = Array.isArray(body.segment_taxonomy) ? body.segment_taxonomy.map(String) : [];
    datasetRepository.updateDatasetAttributes(datasetId, taxonomy);
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
    const { affectedRunIds } = datasetRepository.deleteDatasetItem(body.item_id);
    await fileStore.removeLocalUri(existing.image_uri || "");
    datasetRepository.refreshDatasetStats(existing.dataset_id, now);

    // Re-score every run the image was removed from so their stored metrics stay
    // accurate now that the deleted image's prediction is gone.
    if (affectedRunIds.length > 0) {
      const segmentTags = reviewRepository.getDatasetSegmentTagsByImageId(existing.dataset_id);
      for (const runId of affectedRunIds) {
        const predictions = reviewRepository.getRunPredictions(runId);
        const metrics = computeMetricsWithSegments(predictions, segmentTags);
        reviewRepository.updateRunMetrics(runId, JSON.stringify(metrics));
      }
    }
    return NextResponse.json({ ok: true, affected_runs: affectedRunIds.length });
  }

  if (body.action === "delete_items") {
    const itemIds = Array.isArray(body.item_ids)
      ? Array.from(new Set(body.item_ids.map((id: unknown) => String(id || "")).filter(Boolean)))
      : [];
    if (itemIds.length === 0) {
      return NextResponse.json({ error: "item_ids must be a non-empty array" }, { status: 400 });
    }

    const existingItems = itemIds
      .map((id) => datasetRepository.getDatasetItemById(String(id)))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (existingItems.length === 0) {
      return NextResponse.json({ error: "No valid dataset items found" }, { status: 404 });
    }

    const datasetIds = new Set<string>();
    const affectedRunToDataset = new Map<string, string>();
    for (const existing of existingItems) {
      const { affectedRunIds } = datasetRepository.deleteDatasetItem(existing.item_id);
      await fileStore.removeLocalUri(existing.image_uri || "");
      datasetIds.add(existing.dataset_id);
      for (const runId of affectedRunIds) affectedRunToDataset.set(runId, existing.dataset_id);
    }

    for (const datasetId of datasetIds) {
      datasetRepository.refreshDatasetStats(datasetId, now);
    }

    // Re-score every run that lost a prediction, using its own dataset's segment tags.
    if (affectedRunToDataset.size > 0) {
      const segmentTagsByDataset = new Map<string, ReturnType<typeof reviewRepository.getDatasetSegmentTagsByImageId>>();
      for (const [runId, datasetId] of affectedRunToDataset) {
        let segmentTags = segmentTagsByDataset.get(datasetId);
        if (!segmentTags) {
          segmentTags = reviewRepository.getDatasetSegmentTagsByImageId(datasetId);
          segmentTagsByDataset.set(datasetId, segmentTags);
        }
        const predictions = reviewRepository.getRunPredictions(runId);
        const metrics = computeMetricsWithSegments(predictions, segmentTags);
        reviewRepository.updateRunMetrics(runId, JSON.stringify(metrics));
      }
    }

    return NextResponse.json({
      ok: true,
      removed: existingItems.length,
      affected_runs: affectedRunToDataset.size,
    });
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
    datasetRepository.refreshItemsLabeledCount(existing.dataset_id);

    // Keep split <-> master in sync (no-op unless this dataset is a split or a master).
    datasetRepository.propagateLabelsToMaster(existing.dataset_id, now);
    datasetRepository.propagateLabelsToSplits(existing.dataset_id, now);

    const itemDataset = datasetRepository.getDatasetById(existing.dataset_id);
    const itemCurrentStatus = itemDataset?.qa_status || "draft";
    if (itemCurrentStatus === "assigned" && nextGroundTruth) {
      qaRepository.updateQaStatus(existing.dataset_id, "in_annotation");
    }

    return NextResponse.json({ ok: true });
  }

  if (body.action === "assign_annotators") {
    const parsed = DatasetAssignAnnotatorsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const data = parsed.data;
    const parent = datasetRepository.getDatasetById(data.parent_dataset_id);
    if (!parent) {
      return NextResponse.json({ error: "Parent dataset not found" }, { status: 404 });
    }
    const isParent = datasetRepository.isParentDataset(data.parent_dataset_id);
    if (parent.qa_status !== "draft" && !isParent) {
      return NextResponse.json({ error: "Dataset must be in draft status or already have children to assign annotators" }, { status: 400 });
    }
    const alreadyAssigned = qaRepository.getAnnotatorsAlreadyAssigned(data.parent_dataset_id);
    const duplicates = data.annotators.filter((a) => alreadyAssigned.includes(a));
    if (duplicates.length > 0) {
      return NextResponse.json({ error: `Annotator(s) already assigned: ${duplicates.join(", ")}` }, { status: 400 });
    }
    const childIds = datasetRepository.batchCreateChildDatasets({
      parentId: data.parent_dataset_id,
      annotators: data.annotators,
      resetLabels: data.reset_labels,
      resetSegments: data.reset_segments,
    });
    for (let i = 0; i < childIds.length; i++) {
      qaRepository.createLog({
        datasetId: childIds[i],
        action: "assigned",
        actor: undefined,
        details: { assigned_to: data.annotators[i] },
      });
    }
    return NextResponse.json({ ok: true, created: childIds });
  }

  if (body.action === "finalize_parent") {
    const parsed = DatasetFinalizeParentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const data = parsed.data;
    const parent = datasetRepository.getDatasetById(data.parent_dataset_id);
    if (!parent) {
      return NextResponse.json({ error: "Parent dataset not found" }, { status: 404 });
    }
    const children = datasetRepository.getChildDatasets(data.parent_dataset_id);
    if (children.length === 0) {
      return NextResponse.json({ error: "No child datasets to merge" }, { status: 400 });
    }
    const allApproved = children.every((c: any) => c.qa_status === "approved");
    if (!allApproved) {
      return NextResponse.json({ error: "All child datasets must be approved before finalizing" }, { status: 400 });
    }
    // DISCOVERY parents finalize by unioning attribute tags (no labels, no conflicts).
    if (parent.split_type === "DISCOVERY") {
      datasetRepository.mergeDiscoveryChildrenIntoParent(data.parent_dataset_id);
      for (const child of children) {
        if (child.assigned_to) {
          notificationRepository.createNotification({
            recipient: child.assigned_to,
            type: "archive_complete",
            datasetId: child.dataset_id,
            title: "Dataset Finalized",
            message: `Your tagging for "${child.name}" has been merged into the master dataset.`,
          });
        }
      }
      return NextResponse.json({ ok: true, status: "finalized" });
    }
    const excludeAttributes = !!parent.exclude_attributes;
    const conflicts = datasetRepository.getMergeConflicts(data.parent_dataset_id, excludeAttributes);
    if (conflicts.length > 0 && (!data.resolutions || data.resolutions.length === 0)) {
      return NextResponse.json({ conflicts });
    }
    datasetRepository.mergeChildrenIntoParent(data.parent_dataset_id, data.resolutions || [], excludeAttributes);

    for (const child of children) {
      if (child.assigned_to) {
        notificationRepository.createNotification({
          recipient: child.assigned_to,
          type: "archive_complete",
          datasetId: child.dataset_id,
          title: "Dataset Finalized",
          message: `Your annotations for "${child.name}" have been merged into the master dataset. Review your results to see how your labels compared.`,
        });
      }
    }

    return NextResponse.json({ ok: true, status: "finalized" });
  }

  if (body.action === "duplicate") {
    const parsed = DatasetDuplicateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
    }
    const data = parsed.data;
    const source = datasetRepository.getDatasetById(data.dataset_id);
    if (!source) {
      return NextResponse.json({ error: "Source dataset not found" }, { status: 404 });
    }
    const newId = uuid();

    const baseName = source.name.replace(/\s*-\s*\[.*?\]\s*$/, "");
    const sourceAssignee = source.assigned_to || null;
    const dupAssignee = data.assigned_to || null;

    let newName: string;
    let renameSource = false;
    let sourceNewName = "";

    if (dupAssignee) {
      newName = `${baseName} - [${dupAssignee}]`;
      if (!sourceAssignee) {
        renameSource = true;
        sourceNewName = `${baseName} - [Unassigned]`;
      } else if (!source.name.match(/\s*-\s*\[.*?\]\s*$/)) {
        renameSource = true;
        sourceNewName = `${baseName} - [${sourceAssignee}]`;
      }
    } else if (sourceAssignee) {
      newName = `${baseName} - [Unassigned]`;
      if (!source.name.match(/\s*-\s*\[.*?\]\s*$/)) {
        renameSource = true;
        sourceNewName = `${baseName} - [${sourceAssignee}]`;
      }
    } else {
      newName = `${baseName} - [Unassigned 2]`;
      renameSource = true;
      sourceNewName = `${baseName} - [Unassigned 1]`;
    }

    datasetRepository.duplicateDataset({
      sourceDatasetId: data.dataset_id,
      newDatasetId: newId,
      newName,
      assignedTo: dupAssignee,
      resetLabels: data.reset_labels,
    });
    if (renameSource) {
      datasetRepository.updateDatasetMeta(data.dataset_id, sourceNewName, source.detection_id ?? null, source.split_type, now);
    }
    if (data.link) {
      qaRepository.linkDatasets(data.dataset_id, newId);
    }
    return NextResponse.json({ ok: true, new_dataset_id: newId, new_name: newName });
  }

  if (!body.dataset_id) {
    return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
  }

  const dataset = datasetRepository.getDatasetById(body.dataset_id);
  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  if (Object.prototype.hasOwnProperty.call(body, "split_type") && !isDatasetSplitType(String(body.split_type || ""))) {
    return NextResponse.json({ error: `Invalid split_type: ${String(body.split_type || "")}` }, { status: 400 });
  }

  const newName = body.name ?? dataset.name;
  datasetRepository.updateDatasetMeta(
    body.dataset_id,
    newName,
    Object.prototype.hasOwnProperty.call(body, "detection_id")
      ? (String(body.detection_id || "").trim() || null)
      : (dataset.detection_id ?? null),
    Object.prototype.hasOwnProperty.call(body, "split_type") ? body.split_type : dataset.split_type,
    now
  );

  if (newName !== dataset.name) {
    const children = datasetRepository.getChildDatasets(body.dataset_id);
    for (const child of children) {
      const annotatorSuffix = child.assigned_to ? ` - ${child.assigned_to}` : "";
      datasetRepository.updateDatasetMeta(
        child.dataset_id,
        `${newName}${annotatorSuffix}`,
        child.detection_id ?? null,
        child.split_type,
        now
      );
    }
  }

  datasetRepository.refreshDatasetStats(body.dataset_id, now);
  return NextResponse.json({ ok: true });
}

function normalizeImageId(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Normalize a multi-label ground-truth value into a deduped array of label
 * strings. Accepts an array, a JSON-array string (mirrors the attributes format,
 * e.g. ["dog","pool"]), or a delimited string (comma, pipe, semicolon, newline).
 * Returns [] when empty. Used by multi-label production-replication datasets where
 * the GT column lists the attribute labels present on an image.
 */
function normalizeGroundTruthLabels(value: unknown): string[] {
  let parts: string[] = [];
  if (Array.isArray(value)) {
    parts = value.map((v) => String(v ?? ""));
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        parts = Array.isArray(parsed) ? parsed.map((v) => String(v ?? "")) : [];
      } catch {
        parts = trimmed.split(/[,|;\n]/);
      }
    } else {
      parts = trimmed.split(/[,|;\n]/);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
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
