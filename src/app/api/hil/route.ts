import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeMetrics } from "@/lib/metrics";
import type { Prediction } from "@/types";

// Update a prediction (correction, error tag, note)
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const now = new Date().toISOString();
  const pred = db.prepare("SELECT * FROM predictions WHERE prediction_id = ?").get(body.prediction_id) as any;
  if (!pred) {
    return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
  }

  db.prepare(`
    UPDATE predictions SET
      corrected_label = ?,
      error_tag = ?,
      reviewer_note = ?,
      corrected_at = ?
    WHERE prediction_id = ?
  `).run(
    body.corrected_label || null,
    body.error_tag || null,
    body.reviewer_note || null,
    now,
    body.prediction_id
  );

  // Reviewer can set ground truth directly during HIL review.
  if (Object.prototype.hasOwnProperty.call(body, "ground_truth_label")) {
    db.prepare("UPDATE predictions SET ground_truth_label = ? WHERE prediction_id = ?").run(
      body.ground_truth_label,
      body.prediction_id
    );

    if (body.update_ground_truth) {
      const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(pred.run_id) as any;
      if (run) {
        db.prepare(
          "UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?"
        ).run(body.ground_truth_label, run.dataset_id, pred.image_id);
      }
    }
  }

  // If correcting an ITERATION dataset, also update ground truth
  if (body.corrected_label && body.update_ground_truth) {
    const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(pred.run_id) as any;
    if (run) {
      const dataset = db.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(run.dataset_id) as any;
      if (dataset && dataset.split_type === "ITERATION") {
        db.prepare(
          "UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?"
        ).run(body.corrected_label, run.dataset_id, pred.image_id);
      }
    }
  }

  // Always recompute and persist metrics for this run after HIL edits,
  // so all run logs/views stay consistent.
  const predictions = db
    .prepare("SELECT * FROM predictions WHERE run_id = ?")
    .all(pred.run_id) as Prediction[];
  const metrics = computeMetrics(predictions);
  db.prepare("UPDATE runs SET metrics_summary = ? WHERE run_id = ?").run(
    JSON.stringify(metrics),
    pred.run_id
  );

  return NextResponse.json({ ok: true, run_id: pred.run_id, metrics });
}

// Recompute metrics for a run (after HIL corrections)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  const predictions = db
    .prepare("SELECT * FROM predictions WHERE run_id = ?")
    .all(body.run_id) as Prediction[];

  const metrics = computeMetrics(predictions);

  db.prepare("UPDATE runs SET metrics_summary = ? WHERE run_id = ?").run(
    JSON.stringify(metrics),
    body.run_id
  );

  return NextResponse.json({ metrics });
}
