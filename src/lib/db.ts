import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "vlm-eval.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS detections (
      detection_id TEXT PRIMARY KEY,
      detection_code TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      label_policy TEXT NOT NULL DEFAULT '',
      decision_rubric TEXT NOT NULL DEFAULT '[]',
      metric_thresholds TEXT NOT NULL DEFAULT '{}',
      approved_prompt_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      prompt_version_id TEXT PRIMARY KEY,
      detection_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      prompt_structure TEXT NOT NULL DEFAULT '{}',
      model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      temperature REAL NOT NULL DEFAULT 0,
      top_p REAL NOT NULL DEFAULT 1,
      max_output_tokens INTEGER NOT NULL DEFAULT 1024,
      change_notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      golden_set_regression_result TEXT,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id)
    );

    CREATE TABLE IF NOT EXISTS datasets (
      dataset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      detection_id TEXT NOT NULL,
      split_type TEXT NOT NULL CHECK(split_type IN ('GOLDEN','ITERATION','HELD_OUT_EVAL','CUSTOM')),
      dataset_hash TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id)
    );

    CREATE TABLE IF NOT EXISTS dataset_items (
      item_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      image_description TEXT NOT NULL DEFAULT '',
      ai_assigned_label TEXT,
      ai_confidence REAL,
      ground_truth_label TEXT CHECK(ground_truth_label IN ('DETECTED','NOT_DETECTED') OR ground_truth_label IS NULL),
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      detection_id TEXT NOT NULL,
      prompt_version_id TEXT NOT NULL,
      prompt_snapshot TEXT NOT NULL,
      decoding_params TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      dataset_hash TEXT NOT NULL,
      split_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metrics_summary TEXT NOT NULL DEFAULT '{}',
      prompt_feedback_log TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'running',
      total_images INTEGER NOT NULL DEFAULT 0,
      processed_images INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id),
      FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(prompt_version_id),
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );

    CREATE TABLE IF NOT EXISTS predictions (
      prediction_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      ground_truth_label TEXT,
      predicted_decision TEXT,
      confidence REAL,
      evidence TEXT,
      parse_ok INTEGER NOT NULL DEFAULT 1,
      raw_response TEXT NOT NULL DEFAULT '',
      corrected_label TEXT,
      error_tag TEXT,
      reviewer_note TEXT,
      corrected_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_run_id ON predictions(run_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_detection_id ON prompt_versions(detection_id);
    CREATE INDEX IF NOT EXISTS idx_datasets_detection_id ON datasets(detection_id);
    CREATE INDEX IF NOT EXISTS idx_runs_detection_id ON runs(detection_id);
  `);

  ensureDatasetItemColumns(db);
  ensureNullableGroundTruthColumns(db);
  ensureRunsColumns(db);
}

function ensureDatasetItemColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(dataset_items)").all() as Array<{ name: string }>;
  const hasImageDescription = columns.some((c) => c.name === "image_description");
  const hasAiAssignedLabel = columns.some((c) => c.name === "ai_assigned_label");
  const hasAiConfidence = columns.some((c) => c.name === "ai_confidence");
  if (!hasImageDescription) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN image_description TEXT NOT NULL DEFAULT ''");
  }
  if (!hasAiAssignedLabel) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN ai_assigned_label TEXT");
  }
  if (!hasAiConfidence) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN ai_confidence REAL");
  }
}

function ensureNullableGroundTruthColumns(db: Database.Database) {
  const datasetItemColumns = db
    .prepare("PRAGMA table_info(dataset_items)")
    .all() as Array<{ name: string; notnull: number }>;
  const itemGt = datasetItemColumns.find((c) => c.name === "ground_truth_label");
  if (itemGt && itemGt.notnull === 1) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;

      CREATE TABLE dataset_items_new (
        item_id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        image_id TEXT NOT NULL,
        image_uri TEXT NOT NULL,
        image_description TEXT NOT NULL DEFAULT '',
        ai_assigned_label TEXT,
        ai_confidence REAL,
        ground_truth_label TEXT CHECK(ground_truth_label IN ('DETECTED','NOT_DETECTED') OR ground_truth_label IS NULL),
        FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
      );

      INSERT INTO dataset_items_new (item_id, dataset_id, image_id, image_uri, image_description, ai_assigned_label, ai_confidence, ground_truth_label)
      SELECT item_id, dataset_id, image_id, image_uri, COALESCE(image_description, ''), ai_assigned_label, ai_confidence, ground_truth_label
      FROM dataset_items;

      DROP TABLE dataset_items;
      ALTER TABLE dataset_items_new RENAME TO dataset_items;

      CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items(dataset_id);

      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  const predictionColumns = db
    .prepare("PRAGMA table_info(predictions)")
    .all() as Array<{ name: string; notnull: number }>;
  const predGt = predictionColumns.find((c) => c.name === "ground_truth_label");
  if (predGt && predGt.notnull === 1) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;

      CREATE TABLE predictions_new (
        prediction_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        image_id TEXT NOT NULL,
        image_uri TEXT NOT NULL,
        ground_truth_label TEXT,
        predicted_decision TEXT,
        confidence REAL,
        evidence TEXT,
        parse_ok INTEGER NOT NULL DEFAULT 1,
        raw_response TEXT NOT NULL DEFAULT '',
        corrected_label TEXT,
        error_tag TEXT,
        reviewer_note TEXT,
        corrected_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );

      INSERT INTO predictions_new (
        prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence,
        evidence, parse_ok, raw_response, corrected_label, error_tag, reviewer_note, corrected_at
      )
      SELECT
        prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence,
        evidence, parse_ok, raw_response, corrected_label, error_tag, reviewer_note, corrected_at
      FROM predictions;

      DROP TABLE predictions;
      ALTER TABLE predictions_new RENAME TO predictions;

      CREATE INDEX IF NOT EXISTS idx_predictions_run_id ON predictions(run_id);

      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function ensureRunsColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  const hasPromptFeedbackLog = columns.some((c) => c.name === "prompt_feedback_log");
  if (!hasPromptFeedbackLog) {
    db.exec("ALTER TABLE runs ADD COLUMN prompt_feedback_log TEXT NOT NULL DEFAULT '{}'");
  }
}
