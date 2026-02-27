import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { seedDefaultData, seedPipesRustingDetection } from "@/lib/seed";
import { v4 as uuid } from "uuid";
import fs from "fs/promises";
import path from "path";

export async function GET() {
  const db = getDb();
  seedDefaultData();
  seedPipesRustingDetection();
  const rows = db.prepare("SELECT * FROM detections ORDER BY created_at DESC").all();
  const detections = rows.map((r: any) => ({
    ...r,
    decision_rubric: safeParseJson(r.decision_rubric, []),
    metric_thresholds: safeParseJson(r.metric_thresholds, {}),
  }));
  return NextResponse.json(detections);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
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

    db.prepare(`
      INSERT INTO detections (detection_id, detection_code, display_name, description, label_policy, decision_rubric, metric_thresholds, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      detectionCode,
      displayName,
      body.description || "",
      body.label_policy || "",
      JSON.stringify(body.decision_rubric || []),
      JSON.stringify(body.metric_thresholds || { primary_metric: "f1" }),
      now,
      now
    );

    return NextResponse.json({ detection_id: id });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
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
  const body = await req.json();
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE detections SET
      display_name = ?,
      description = ?,
      label_policy = ?,
      decision_rubric = ?,
      metric_thresholds = ?,
      approved_prompt_version = ?,
      updated_at = ?
    WHERE detection_id = ?
  `).run(
    body.display_name,
    body.description || "",
    body.label_policy || "",
    JSON.stringify(body.decision_rubric || []),
    JSON.stringify(body.metric_thresholds || {}),
    body.approved_prompt_version || null,
    now,
    body.detection_id
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const detectionId = body.detection_id as string;
    if (!detectionId) {
      return NextResponse.json({ error: "detection_id is required" }, { status: 400 });
    }

    const db = getDb();
    const detection = db
      .prepare("SELECT detection_id FROM detections WHERE detection_id = ?")
      .get(detectionId) as any;
    if (!detection) {
      return NextResponse.json({ error: "Detection not found" }, { status: 404 });
    }

    const datasetIds = db
      .prepare("SELECT dataset_id FROM datasets WHERE detection_id = ?")
      .all(detectionId) as Array<{ dataset_id: string }>;

    const tx = db.transaction((targetDetectionId: string) => {
      const runs = db
        .prepare("SELECT run_id FROM runs WHERE detection_id = ?")
        .all(targetDetectionId) as Array<{ run_id: string }>;

      for (const r of runs) {
        db.prepare("DELETE FROM predictions WHERE run_id = ?").run(r.run_id);
      }
      db.prepare("DELETE FROM runs WHERE detection_id = ?").run(targetDetectionId);

      const ds = db
        .prepare("SELECT dataset_id FROM datasets WHERE detection_id = ?")
        .all(targetDetectionId) as Array<{ dataset_id: string }>;
      for (const d of ds) {
        db.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(d.dataset_id);
      }
      db.prepare("DELETE FROM datasets WHERE detection_id = ?").run(targetDetectionId);

      db.prepare("DELETE FROM prompt_versions WHERE detection_id = ?").run(targetDetectionId);
      db.prepare("DELETE FROM detections WHERE detection_id = ?").run(targetDetectionId);
    });

    tx(detectionId);

    // Best-effort cleanup for local uploaded files belonging to deleted datasets.
    for (const d of datasetIds) {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "datasets", d.dataset_id);
      await fs.rm(uploadDir, { recursive: true, force: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
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
