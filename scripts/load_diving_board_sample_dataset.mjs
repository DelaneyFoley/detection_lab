import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data", "vlm-eval.db");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

const now = new Date().toISOString();
const detectionCode = "DIVING_BOARD_PRESENT";
const detectionId = "det_diving_board_present";
const promptVersionId = "prompt_diving_board_v1";
const datasetId = "dataset_diving_board_iteration_50";
const assetDir = path.join(process.cwd(), "public", "sample-data", "pools-diving-board");

const skyColors = ["#9dd9ff", "#b6e3ff", "#87ceeb", "#a9dcff", "#8fc8ff"];
const wallColors = ["#e8d8c3", "#f0e1cc", "#e4d4be", "#dccbb4", "#f2e6d5"];
const roofColors = ["#a65644", "#8d4f3f", "#7b3f2f", "#9d5a48", "#734334"];
const deckColors = ["#d9c2a3", "#ceb594", "#e0ccb0", "#c9af8b", "#d6bea0"];
const poolColors = ["#4db6ff", "#36aaf7", "#63c2ff", "#42b3ff", "#2f9fe8"];
const foliageColors = ["#4f8f3a", "#5c9d45", "#3f7f32", "#5a8c3f", "#4b9a3f"];

function ensureAssets() {
  fs.mkdirSync(assetDir, { recursive: true });
}

function writeSceneSvg(filename, hasDivingBoard, n) {
  const sky = skyColors[n % skyColors.length];
  const wall = wallColors[n % wallColors.length];
  const roof = roofColors[n % roofColors.length];
  const deck = deckColors[n % deckColors.length];
  const pool = poolColors[n % poolColors.length];
  const foliage = foliageColors[n % foliageColors.length];
  const sunX = 560 - (n % 6) * 45;
  const umbrellaX = 120 + (n % 7) * 46;
  const floaty = n % 2 === 0;
  const chairs = n % 3 !== 0;
  const palm = n % 4 === 0;

  const board = hasDivingBoard
    ? `
    <rect x="500" y="208" width="22" height="36" fill="#dadada" />
    <rect x="486" y="196" width="94" height="12" rx="4" fill="#f3f3f3" />
    <rect x="570" y="194" width="10" height="14" rx="2" fill="#cfcfcf" />`
    : "";

  const lounge = chairs
    ? `
    <rect x="84" y="292" width="58" height="10" rx="2" fill="#8d6e63" />
    <rect x="150" y="292" width="58" height="10" rx="2" fill="#8d6e63" />`
    : "";

  const palmTree = palm
    ? `
    <rect x="52" y="160" width="10" height="85" fill="#7a4a2f" />
    <ellipse cx="58" cy="150" rx="34" ry="10" fill="${foliage}" />
    <ellipse cx="73" cy="136" rx="28" ry="8" fill="${foliage}" />
    <ellipse cx="43" cy="136" rx="28" ry="8" fill="${foliage}" />`
    : "";

  const poolToy = floaty
    ? `<ellipse cx="360" cy="250" rx="28" ry="14" fill="#ff7e67" opacity="0.9" />`
    : `<ellipse cx="332" cy="270" rx="20" ry="9" fill="#ffe082" opacity="0.85" />`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="${sky}" />
  <circle cx="${sunX}" cy="62" r="26" fill="#ffd25f" />
  <rect x="20" y="142" width="260" height="120" fill="${wall}" />
  <polygon points="20,142 150,74 280,142" fill="${roof}" />
  <rect x="64" y="182" width="58" height="80" fill="#c7ad8e" />
  <rect x="168" y="178" width="70" height="42" fill="#9ec4df" />
  <rect x="0" y="245" width="640" height="115" fill="${deck}" />
  <rect x="220" y="210" width="360" height="110" rx="10" fill="${pool}" />
  <rect x="220" y="210" width="360" height="8" fill="#e5f7ff" opacity="0.75" />
  <rect x="560" y="170" width="10" height="75" fill="#c5c5c5" />
  <line x1="570" y1="170" x2="590" y2="170" stroke="#c5c5c5" stroke-width="4" />
  ${board}
  ${poolToy}
  <rect x="${umbrellaX}" y="196" width="6" height="52" fill="#6d4c41" />
  <polygon points="${umbrellaX - 28},196 ${umbrellaX + 3},170 ${umbrellaX + 34},196" fill="#ef5350" />
  ${lounge}
  ${palmTree}
  <ellipse cx="603" cy="234" rx="22" ry="12" fill="${foliage}" />
  <ellipse cx="618" cy="220" rx="20" ry="10" fill="${foliage}" />
  <text x="18" y="28" font-family="Arial, sans-serif" font-size="14" fill="#1d3557">Residential Pool Exterior</text>
  <text x="18" y="48" font-family="Arial, sans-serif" font-size="12" fill="#1d3557">${hasDivingBoard ? "Diving board present" : "No diving board"}</text>
</svg>`;

  fs.writeFileSync(path.join(assetDir, filename), svg, "utf8");
}

ensureAssets();

const detectedItems = Array.from({ length: 25 }, (_, i) => {
  const file = `pool_db_${String(i + 1).padStart(3, "0")}.svg`;
  writeSceneSvg(file, true, i);
  return {
  image_id: `pool_db_${String(i + 1).padStart(3, "0")}`,
  image_uri: `/sample-data/pools-diving-board/${file}`,
  ground_truth_label: "DETECTED",
  };
});

const notDetectedItems = Array.from({ length: 25 }, (_, i) => {
  const file = `pool_nodb_${String(i + 1).padStart(3, "0")}.svg`;
  writeSceneSvg(file, false, i + 100);
  return {
  image_id: `pool_nodb_${String(i + 1).padStart(3, "0")}`,
  image_uri: `/sample-data/pools-diving-board/${file}`,
  ground_truth_label: "NOT_DETECTED",
  };
});

const items = [...detectedItems, ...notDetectedItems];
const datasetHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(items.map((i) => ({ image_id: i.image_id, label: i.ground_truth_label }))))
  .digest("hex")
  .slice(0, 16);

const tx = db.transaction(() => {
  const existingDetection = db
    .prepare("SELECT detection_id FROM detections WHERE detection_code = ?")
    .get(detectionCode);

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
      "Detects whether a residential swimming pool scene includes a diving board.",
      [
        "DETECTED: A clear, physical diving board structure is visible adjacent to or extending over a residential pool.",
        "NOT_DETECTED: Residential pool with no visible diving board.",
        "Edge case: If only a jumping platform/ledge is visible and no board is discernible, choose NOT_DETECTED.",
      ].join("\n"),
      JSON.stringify([
        "Confirm the image is a residential exterior with a visible pool.",
        "Look for a narrow elevated board attached near pool edge.",
        "Do not confuse slides, deck planks, or ladders with diving boards.",
        "If occlusion prevents confident confirmation of a board, choose NOT_DETECTED.",
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
  } else {
    db.prepare("UPDATE detections SET updated_at = ? WHERE detection_code = ?").run(now, detectionCode);
  }

  const activeDetection = db
    .prepare("SELECT detection_id FROM detections WHERE detection_code = ?")
    .get(detectionCode);

  const existingPrompt = db
    .prepare("SELECT prompt_version_id FROM prompt_versions WHERE prompt_version_id = ?")
    .get(promptVersionId);

  if (!existingPrompt) {
    db.prepare(`
      INSERT INTO prompt_versions (
        prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template,
        prompt_structure, model, temperature, top_p, max_output_tokens, change_notes,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      promptVersionId,
      activeDetection.detection_id,
      "v1.0",
      "You are a visual detection system. Return JSON only.",
      [
        "Analyze this residential property exterior image for detection: {{DETECTION_CODE}}.",
        "",
        "Label policy:",
        "- DETECTED: a real diving board is visible at/over the pool edge.",
        "- NOT_DETECTED: no diving board is visible.",
        "",
        "Return ONLY JSON:",
        '{"detection_code":"{{DETECTION_CODE}}","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}',
      ].join("\n"),
      JSON.stringify({
        detection_identity: "Residential Pool Diving Board Presence",
        label_policy: "DETECTED when a diving board is visible; otherwise NOT_DETECTED.",
        decision_rubric:
          "1. Find pool edge hardware. 2. Confirm board shape and placement. 3. Exclude slides/ladders.",
        output_schema:
          '{"detection_code":"DIVING_BOARD_PRESENT","decision":"DETECTED|NOT_DETECTED","confidence":0.0,"evidence":"short phrase"}',
        examples: "",
      }),
      "gemini-2.5-flash",
      0,
      1,
      1024,
      "Baseline prompt for diving board detection.",
      "system",
      now
    );
  }

  const existingDataset = db
    .prepare("SELECT dataset_id FROM datasets WHERE dataset_id = ?")
    .get(datasetId);

  if (!existingDataset) {
    db.prepare(`
      INSERT INTO datasets (
        dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      datasetId,
      "Residential Pools Iteration Set (Diving Board, 50)",
      activeDetection.detection_id,
      "ITERATION",
      datasetHash,
      items.length,
      now,
      now
    );
  } else {
    db.prepare(`
      UPDATE datasets
      SET name = ?, detection_id = ?, split_type = 'ITERATION', dataset_hash = ?, size = ?, updated_at = ?
      WHERE dataset_id = ?
    `).run(
      "Residential Pools Iteration Set (Diving Board, 50, Local Assets)",
      activeDetection.detection_id,
      datasetHash,
      items.length,
      now,
      datasetId
    );
    db.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(datasetId);
  }

  const insertItem = db.prepare(`
    INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, ground_truth_label)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const item of items) {
    const itemId = `${datasetId}__${item.image_id}`;
    insertItem.run(itemId, datasetId, item.image_id, item.image_uri, item.ground_truth_label);
  }
});

tx();

const detection = db
  .prepare("SELECT detection_id, detection_code, display_name FROM detections WHERE detection_code = ?")
  .get(detectionCode);
const dataset = db
  .prepare("SELECT dataset_id, name, split_type, size FROM datasets WHERE dataset_id = ?")
  .get(datasetId);
const labelCounts = db
  .prepare("SELECT ground_truth_label, COUNT(*) as c FROM dataset_items WHERE dataset_id = ? GROUP BY ground_truth_label")
  .all(datasetId);

console.log("Loaded detection:", detection);
console.log("Loaded dataset:", dataset);
console.log("Label counts:", labelCounts);
console.log("Assets directory:", assetDir);

db.close();
