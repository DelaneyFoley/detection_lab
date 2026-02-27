import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const datasetId = req.nextUrl.searchParams.get("dataset_id");
    const db = getDb();

    if (datasetId) {
      const dataset = db.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(datasetId);
      const items = db.prepare("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY image_id").all(datasetId);
      return NextResponse.json({ dataset, items });
    }

    let rows;
    if (detectionId) {
      rows = db
        .prepare("SELECT * FROM datasets WHERE detection_id = ? ORDER BY created_at DESC")
        .all(detectionId);
    } else {
      rows = db.prepare("SELECT * FROM datasets ORDER BY created_at DESC").all();
    }

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
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

      const uploadDir = path.join(process.cwd(), "public", "uploads", "datasets", id);
      await fs.mkdir(uploadDir, { recursive: true });

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
        const absPath = path.join(uploadDir, safeFilename);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(absPath, buffer);

        savedItems.push({
          image_id: meta.image_id,
          image_uri: `/uploads/datasets/${id}/${safeFilename}`,
          image_description: meta.image_description || "",
          ai_assigned_label: null,
          ai_confidence: null,
          ground_truth_label: gt,
        });
      }

      items = savedItems;
    } else {
      const body = await req.json();
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

    const hashContent = JSON.stringify(items.map((i: any) => ({ image_id: i.image_id, label: i.ground_truth_label })));
    const hash = crypto.createHash("sha256").update(hashContent).digest("hex").slice(0, 16);

    db.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, detectionId, splitType, hash, items.length, now, now);

    const insertItem = db.prepare(`
    INSERT INTO dataset_items (
      item_id, dataset_id, image_id, image_uri, image_description, ai_assigned_label, ai_confidence, ground_truth_label
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items: any[]) => {
      for (const item of items) {
        insertItem.run(
          uuid(),
          id,
          item.image_id,
          item.image_uri,
          item.image_description || "",
          null,
          null,
          item.ground_truth_label
        );
      }
    });

    insertMany(items);

    return NextResponse.json({ dataset_id: id });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function sanitizeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "image";
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    const datasetId = body.dataset_id as string;

    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }

    const deleteTx = db.transaction((targetDatasetId: string) => {
      const runIds = db
        .prepare("SELECT run_id FROM runs WHERE dataset_id = ?")
        .all(targetDatasetId) as Array<{ run_id: string }>;

      for (const r of runIds) {
        db.prepare("DELETE FROM predictions WHERE run_id = ?").run(r.run_id);
      }
      db.prepare("DELETE FROM runs WHERE dataset_id = ?").run(targetDatasetId);
      db.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(targetDatasetId);
      db.prepare("DELETE FROM datasets WHERE dataset_id = ?").run(targetDatasetId);
    });

    deleteTx(datasetId);

    const uploadDir = path.join(process.cwd(), "public", "uploads", "datasets", datasetId);
    await fs.rm(uploadDir, { recursive: true, force: true });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const now = new Date().toISOString();

  if (body.item_id) {
    const existing = db
      .prepare("SELECT * FROM dataset_items WHERE item_id = ?")
      .get(body.item_id) as any;
    if (!existing) {
      return NextResponse.json({ error: "Dataset item not found" }, { status: 404 });
    }

    let nextImageUri = body.image_uri ?? existing.image_uri;
    const nextImageId = normalizeImageId(body.image_id ?? existing.image_id);
    if (!nextImageId) {
      return NextResponse.json({ error: "image_id cannot be blank" }, { status: 400 });
    }
    const duplicate = db
      .prepare("SELECT item_id FROM dataset_items WHERE dataset_id = ? AND image_id = ? AND item_id != ? LIMIT 1")
      .get(existing.dataset_id, nextImageId, body.item_id) as { item_id: string } | undefined;
    if (duplicate) {
      return NextResponse.json({ error: `Duplicate image_id: ${nextImageId}` }, { status: 400 });
    }
    const nextImageDescription = body.image_description ?? existing.image_description ?? "";
    const nextGroundTruth =
      Object.prototype.hasOwnProperty.call(body, "ground_truth_label")
        ? body.ground_truth_label
        : existing.ground_truth_label;

    // If a local upload path is being renamed, rename underlying file too.
    if (typeof body.image_uri === "string" && body.image_uri !== existing.image_uri) {
      const oldAbs = localUriToAbsPath(existing.image_uri);
      const requestedAbs = localUriToAbsPath(body.image_uri);
      if (oldAbs && requestedAbs) {
        await fs.mkdir(path.dirname(requestedAbs), { recursive: true });
        await fs.rename(oldAbs, requestedAbs);
        nextImageUri = absPathToLocalUri(requestedAbs);
      }
    }

    db.prepare(`
      UPDATE dataset_items
      SET image_id = ?, image_uri = ?, image_description = ?, ai_assigned_label = ?, ai_confidence = ?, ground_truth_label = ?
      WHERE item_id = ?
    `).run(
      nextImageId,
      nextImageUri,
      nextImageDescription,
      existing.ai_assigned_label ?? null,
      existing.ai_confidence ?? null,
      nextGroundTruth,
      body.item_id
    );

    refreshDatasetStats(db, existing.dataset_id, now);
    return NextResponse.json({ ok: true });
  }

  if (!body.dataset_id) {
    return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
  }

  const dataset = db
    .prepare("SELECT * FROM datasets WHERE dataset_id = ?")
    .get(body.dataset_id) as any;
  if (!dataset) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  db.prepare(`
    UPDATE datasets
    SET name = ?, split_type = ?, updated_at = ?
    WHERE dataset_id = ?
  `).run(
    body.name ?? dataset.name,
    body.split_type ?? dataset.split_type,
    now,
    body.dataset_id
  );

  refreshDatasetStats(db, body.dataset_id, now);
  return NextResponse.json({ ok: true });
}

function refreshDatasetStats(db: any, datasetId: string, now: string) {
  const items = db
    .prepare("SELECT image_id, ground_truth_label FROM dataset_items WHERE dataset_id = ? ORDER BY image_id")
    .all(datasetId) as Array<{ image_id: string; ground_truth_label: string }>;
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(items.map((i) => ({ image_id: i.image_id, label: i.ground_truth_label }))))
    .digest("hex")
    .slice(0, 16);

  db.prepare(`
    UPDATE datasets
    SET dataset_hash = ?, size = ?, updated_at = ?
    WHERE dataset_id = ?
  `).run(hash, items.length, now, datasetId);
}

function localUriToAbsPath(uri: string): string | null {
  if (!uri.startsWith("/uploads/datasets/")) return null;
  return path.join(process.cwd(), "public", uri.replace(/^\//, ""));
}

function absPathToLocalUri(absPath: string): string {
  const rel = path.relative(path.join(process.cwd(), "public"), absPath);
  return `/${rel.split(path.sep).join("/")}`;
}

function normalizeImageId(value: unknown): string {
  return String(value ?? "").trim();
}

function validateAndNormalizeItemMetas(
  items: Array<{
    image_id: string;
    image_description?: string;
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
