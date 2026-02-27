import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "./db";

export function seedDefaultData() {
  const db = getDb();
  const now = new Date().toISOString();

  // One-time seed guard. Once initialized, never auto-seed again.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const seeded = db
    .prepare("SELECT value FROM app_meta WHERE key = 'seed_initialized'")
    .get() as { value: string } | undefined;
  if (seeded?.value === "1") {
    return;
  }

  // If the user already has data, mark seeded and exit without seeding.
  const existingDetectionCount = db
    .prepare("SELECT COUNT(*) AS c FROM detections")
    .get() as { c: number };
  if (existingDetectionCount.c > 0) {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_initialized', '1')").run();
    return;
  }

  const detectionCode = "DIVING_BOARD_PRESENT";
  const existingDetection = db
    .prepare("SELECT detection_id FROM detections WHERE detection_code = ?")
    .get(detectionCode) as { detection_id: string } | undefined;

  const detectionId = existingDetection?.detection_id || uuid();

  if (!existingDetection) {
    db.prepare(`
      INSERT INTO detections (
        detection_id, detection_code, display_name, description, label_policy,
        decision_rubric, metric_thresholds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      detectionId,
      detectionCode,
      "Residential Pool Diving Board Presence",
      "Detects whether a residential property exterior image shows a swimming pool with a visible diving board.",
      [
        "DETECTED: A physical diving board is clearly visible at or extending over the pool edge.",
        "NOT_DETECTED: A residential pool is visible but no diving board is visible.",
        "EDGE_CASE: If only a platform/ledge is visible or occlusion prevents confidence, choose NOT_DETECTED.",
      ].join("\n"),
      JSON.stringify([
        "Confirm the scene is a residential exterior with a visible swimming pool.",
        "Identify a narrow elevated board-like structure attached near the pool edge.",
        "Do not confuse slides, deck planks, or ladders with diving boards.",
        "If board visibility is ambiguous due to distance/occlusion, choose NOT_DETECTED.",
      ]),
      JSON.stringify({
        primary_metric: "f1",
        min_precision: 0.8,
        min_recall: 0.8,
        min_f1: 0.8,
      }),
      now,
      now
    );
  }

  const promptCount = db
    .prepare("SELECT COUNT(*) AS c FROM prompt_versions WHERE detection_id = ?")
    .get(detectionId) as { c: number };

  if (promptCount.c === 0) {
    const promptId = uuid();
    db.prepare(`
      INSERT INTO prompt_versions (
        prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template,
        prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      promptId,
      detectionId,
      "v1.0",
      [
        "You are a visual detection system for home-inspection imagery.",
        "Return valid JSON only. No markdown, commentary, or extra keys.",
        "Follow the label policy and decision rubric exactly.",
      ].join("\n"),
      [
        "Analyze this residential exterior image for detection code: {{DETECTION_CODE}}.",
        "",
        "Return ONLY this JSON:",
        "{",
        '  "detection_code": "{{DETECTION_CODE}}",',
        '  "decision": "DETECTED" or "NOT_DETECTED",',
        '  "confidence": <float 0-1>,',
        '  "evidence": "<short visual basis phrase>"',
        "}",
      ].join("\n"),
      JSON.stringify({
        detection_identity: "Residential Pool Diving Board Presence",
        label_policy: [
          "DETECTED: A physical diving board is clearly visible at or extending over the pool edge.",
          "NOT_DETECTED: A residential pool is visible but no diving board is visible.",
          "EDGE_CASE: If only a platform/ledge is visible or occlusion prevents confidence, choose NOT_DETECTED.",
        ].join("\n"),
        decision_rubric: [
          "1. Confirm image shows residential exterior with a visible pool.",
          "2. Look for a narrow elevated board attached near pool edge.",
          "3. Exclude slides, ladders, deck planks, and pool toys.",
          "4. If visibility is insufficient for confidence, choose NOT_DETECTED.",
        ].join("\n"),
        output_schema:
          '{"detection_code":"DIVING_BOARD_PRESENT","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short visual basis phrase"}',
        examples: "",
      }),
      "gemini-2.5-flash",
      0,
      1,
      1024,
      "Initial well-formatted baseline prompt for diving board detection.",
      "system",
      now
    );

    db.prepare(`
      UPDATE detections
      SET approved_prompt_version = ?, updated_at = ?
      WHERE detection_id = ? AND approved_prompt_version IS NULL
    `).run(promptId, now, detectionId);
  }

  const datasetName = "Residential Pools Iteration Set (Diving Board, 50)";
  const existingDataset = db
    .prepare("SELECT dataset_id FROM datasets WHERE detection_id = ? AND name = ?")
    .get(detectionId, datasetName) as { dataset_id: string } | undefined;

  if (!existingDataset) {
    const detectedItems = Array.from({ length: 25 }, (_, i) => {
      const imageId = `pool_db_${String(i + 1).padStart(3, "0")}`;
      return {
        image_id: imageId,
        image_uri: `/sample-data/pools-diving-board/${imageId}.svg`,
        ground_truth_label: "DETECTED",
      };
    });
    const notDetectedItems = Array.from({ length: 25 }, (_, i) => {
      const imageId = `pool_nodb_${String(i + 1).padStart(3, "0")}`;
      return {
        image_id: imageId,
        image_uri: `/sample-data/pools-diving-board/${imageId}.svg`,
        ground_truth_label: "NOT_DETECTED",
      };
    });
    const items = [...detectedItems, ...notDetectedItems];

    const datasetHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(items.map((it) => ({ image_id: it.image_id, label: it.ground_truth_label }))))
      .digest("hex")
      .slice(0, 16);

    const datasetId = uuid();
    db.prepare(`
      INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(datasetId, datasetName, detectionId, "ITERATION", datasetHash, items.length, now, now);

    const insertItem = db.prepare(`
      INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, ground_truth_label)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(uuid(), datasetId, item.image_id, item.image_uri, item.ground_truth_label);
    }
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_initialized', '1')").run();
}

export function seedPipesRustingDetection() {
  const db = getDb();
  const now = new Date().toISOString();
  const metaKey = "seed_pipes_rusting_v1";

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const seeded = db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .get(metaKey) as { value: string } | undefined;
  if (seeded?.value === "1") {
    return;
  }

  const detectionCode = "PIPES_RUSTING";
  const existingDetection = db
    .prepare("SELECT detection_id FROM detections WHERE detection_code = ?")
    .get(detectionCode) as { detection_id: string } | undefined;

  const detectionId = existingDetection?.detection_id || uuid();

  if (!existingDetection) {
    db.prepare(`
      INSERT INTO detections (
        detection_id, detection_code, display_name, description, label_policy,
        decision_rubric, metric_thresholds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      detectionId,
      detectionCode,
      "Pipes: Rusting",
      "Detects visible rust deterioration on exposed residential plumbing components in property inspection imagery.",
      [
        "DETECTED: Visible rust (orange/red-brown corrosion) is present on exposed plumbing components such as supply lines, drain pipes, joints, valves, or connectors.",
        "NOT_DETECTED: No visible rust is present on exposed plumbing components, or rust-like coloration is not confidently attributable to plumbing material corrosion.",
      ].join("\n"),
      JSON.stringify([
        "Confirm the image contains exposed residential plumbing components relevant to underwriting (interior utility/plumbing areas, crawlspaces, basements, garages, exterior service lines).",
        "Locate signs of corrosion on pipes/fittings: orange/red-brown oxidation, flaking, pitting, scaling, or rust streaking originating from plumbing metal surfaces.",
        "Associate corrosion directly with plumbing components; exclude rust on nearby non-plumbing surfaces, tools, framing hardware, or appliances unless the plumbing itself is affected.",
        "Treat small, localized rust at joints/fittings as DETECTED when clearly visible, because early corrosion can indicate leakage risk progression.",
        "Do not infer rust when visibility is poor, the surface is painted/coated, or color cast/lighting could explain appearance without corrosion evidence.",
        "Prioritize precision in ambiguous scenes; if corrosion cannot be confidently tied to plumbing material, choose NOT_DETECTED.",
      ]),
      JSON.stringify({
        primary_metric: "f1",
        min_precision: 0.9,
        min_recall: 0.85,
        min_f1: 0.87,
      }),
      now,
      now
    );
  }

  const promptCount = db
    .prepare("SELECT COUNT(*) AS c FROM prompt_versions WHERE detection_id = ?")
    .get(detectionId) as { c: number };

  if (promptCount.c === 0) {
    const promptId = uuid();
    db.prepare(`
      INSERT INTO prompt_versions (
        prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template,
        prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      promptId,
      detectionId,
      "v1.0-underwriting-baseline",
      [
        "You are an underwriting-grade visual risk detector for residential property inspections.",
        "Your task is to determine whether exposed plumbing shows visible rust corrosion.",
        "Decide strictly from visible evidence in the image; do not infer unseen conditions.",
        "Return valid JSON only using the exact schema and keys. No markdown, no extra text, no extra keys.",
        "When uncertainty prevents confident corrosion attribution to plumbing, output NOT_DETECTED.",
      ].join("\n"),
      [
        "Detection Code: {{DETECTION_CODE}}",
        "",
        "Analyze the image for rusting on exposed residential plumbing components.",
        "Follow the label policy and decision rubric exactly.",
        "",
        "Return ONLY this JSON:",
        "{",
        '  "detection_code": "{{DETECTION_CODE}}",',
        '  "decision": "DETECTED" or "NOT_DETECTED",',
        '  "confidence": <float 0-1>,',
        '  "evidence": "<short phrase citing the visual basis>"',
        "}",
      ].join("\n"),
      JSON.stringify({
        detection_identity: "Pipes: Rusting",
        label_policy: [
          "DETECTED: Visible rust (orange/red-brown corrosion) is present on exposed plumbing components such as supply lines, drain pipes, joints, valves, or connectors.",
          "NOT_DETECTED: No visible rust is present on exposed plumbing components, or rust-like coloration is not confidently attributable to plumbing material corrosion.",
        ].join("\n"),
        decision_rubric: [
          "1. Confirm the image contains exposed residential plumbing components.",
          "2. Identify visual corrosion indicators on the plumbing itself (orange/red-brown oxidation, flaking, pitting, scaling, rust streaking).",
          "3. Verify corrosion is on plumbing, not adjacent non-plumbing materials.",
          "4. Count localized corrosion at joints/fittings as DETECTED when clearly visible.",
          "5. Exclude uncertain cases caused by lighting, blur, paint/coatings, or insufficient visibility.",
          "6. If corrosion cannot be confidently attributed to plumbing, choose NOT_DETECTED.",
        ].join("\n"),
        output_schema:
          '{"detection_code":"PIPES_RUSTING","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}',
        examples: "",
      }),
      "gemini-2.5-flash",
      0,
      1,
      1024,
      "Initial underwriting baseline for visible pipe rust detection.",
      "system",
      now
    );

    db.prepare(`
      UPDATE detections
      SET approved_prompt_version = ?, updated_at = ?
      WHERE detection_id = ? AND approved_prompt_version IS NULL
    `).run(promptId, now, detectionId);
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, '1')").run(metaKey);
}
