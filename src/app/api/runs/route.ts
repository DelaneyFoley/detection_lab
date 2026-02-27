import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { runDetectionInference } from "@/lib/gemini";
import { computeMetrics } from "@/lib/metrics";
import type { Prediction } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const runId = req.nextUrl.searchParams.get("run_id");
    const db = getDb();

    if (runId) {
      const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as any;
      if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const predictions = db
        .prepare("SELECT * FROM predictions WHERE run_id = ? ORDER BY image_id")
        .all(runId);

      return NextResponse.json({
        ...run,
        metrics_summary: safeParseJson(run.metrics_summary, {}),
        decoding_params: safeParseJson(run.decoding_params, {}),
        prompt_feedback_log: safeParseJson(run.prompt_feedback_log, {}),
        predictions,
      });
    }

    let rows;
    if (detectionId) {
      rows = db
        .prepare("SELECT * FROM runs WHERE detection_id = ? ORDER BY created_at DESC")
        .all(detectionId);
    } else {
      rows = db.prepare("SELECT * FROM runs ORDER BY created_at DESC").all();
    }

    const runs = rows.map((r: any) => ({
      ...r,
      metrics_summary: safeParseJson(r.metrics_summary, {}),
      prompt_feedback_log: safeParseJson(r.prompt_feedback_log, {}),
    }));

    return NextResponse.json(runs);
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    const { api_key, prompt_version_id, dataset_id, detection_id, model_override } = body;
    const requestedConcurrency = Number(body.max_concurrency);
    const maxConcurrency = Number.isFinite(requestedConcurrency)
      ? Math.max(1, Math.min(12, Math.floor(requestedConcurrency)))
      : 4;

    if (!api_key) {
      return NextResponse.json({ error: "API key required" }, { status: 400 });
    }

    // Fetch prompt
    const prompt = db
      .prepare("SELECT * FROM prompt_versions WHERE prompt_version_id = ?")
      .get(prompt_version_id) as any;
    if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    // Fetch dataset
    const dataset = db.prepare("SELECT * FROM datasets WHERE dataset_id = ?").get(dataset_id) as any;
    if (!dataset) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const items = db
      .prepare("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY image_id")
      .all(dataset_id) as any[];

    // Fetch detection
    const detection = db
      .prepare("SELECT * FROM detections WHERE detection_id = ?")
      .get(detection_id) as any;
    if (!detection) return NextResponse.json({ error: "Detection not found" }, { status: 404 });

    const runId = uuid();
    const now = new Date().toISOString();
    const decodingParams = {
      model: model_override || prompt.model,
      temperature: prompt.temperature,
      top_p: prompt.top_p,
      max_output_tokens: prompt.max_output_tokens,
    };

    // Create run record
    db.prepare(`
    INSERT INTO runs (run_id, detection_id, prompt_version_id, prompt_snapshot, decoding_params, dataset_id, dataset_hash, split_type, created_at, status, total_images, processed_images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, 0)
    `).run(
    runId,
    detection_id,
    prompt_version_id,
    JSON.stringify({ system_prompt: prompt.system_prompt, user_prompt_template: prompt.user_prompt_template }),
    JSON.stringify(decodingParams),
    dataset_id,
    dataset.dataset_hash,
    dataset.split_type,
    now,
    items.length
    );

    // Run inference for each image
    const insertPrediction = db.prepare(`
    INSERT INTO predictions (
      prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence, evidence,
      parse_ok, raw_response, parse_error_reason, parse_fix_suggestion
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const parsedPrompt = {
      ...prompt,
      prompt_structure: JSON.parse(prompt.prompt_structure || "{}"),
      model: model_override || prompt.model,
    };

    const predictions: Prediction[] = [];
    let nextIndex = 0;
    let processed = 0;

    const processItem = async (item: any): Promise<Prediction> => {
    try {
      const result = await runDetectionInference(
        api_key,
        parsedPrompt,
        detection.detection_code,
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
        corrected_label: null,
        error_tag: null,
        reviewer_note: null,
        corrected_at: null,
      };

      insertPrediction.run(
        pred.prediction_id,
        runId,
        pred.image_id,
        pred.image_uri,
        pred.ground_truth_label,
        pred.predicted_decision,
        pred.confidence,
        pred.evidence,
        pred.parse_ok ? 1 : 0,
        pred.raw_response,
        pred.parse_error_reason ?? null,
        pred.parse_fix_suggestion ?? null
      );

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
        corrected_label: null,
        error_tag: null,
        reviewer_note: null,
        corrected_at: null,
      };

      insertPrediction.run(
        pred.prediction_id,
        runId,
        pred.image_id,
        pred.image_uri,
        pred.ground_truth_label,
        null,
        null,
        null,
        0,
        pred.raw_response,
        pred.parse_error_reason ?? null,
        pred.parse_fix_suggestion ?? null
      );

      return pred;
    }
    };

    const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) return;
      nextIndex += 1;

      const pred = await processItem(items[currentIndex]);
      predictions.push(pred);

      processed += 1;
      db.prepare("UPDATE runs SET processed_images = ? WHERE run_id = ?").run(processed, runId);
    }
    };

    const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker());
    await Promise.all(workers);

    // Compute metrics
    const metrics = computeMetrics(predictions);

    db.prepare("UPDATE runs SET metrics_summary = ?, status = 'completed' WHERE run_id = ?").run(
      JSON.stringify(metrics),
      runId
    );

    return NextResponse.json({
      run_id: runId,
      metrics,
      status: "completed",
      total: items.length,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();

    if (!body.run_id) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }

    if (body.prompt_feedback_log !== undefined) {
      db.prepare("UPDATE runs SET prompt_feedback_log = ? WHERE run_id = ?").run(
        JSON.stringify(body.prompt_feedback_log || {}),
        body.run_id
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
