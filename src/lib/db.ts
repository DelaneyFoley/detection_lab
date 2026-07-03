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
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("temp_store = MEMORY");

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
      detection_category TEXT NOT NULL DEFAULT 'HAZARD_IDENTIFICATION',
      label_policy TEXT NOT NULL DEFAULT '',
      user_prompt_addendum TEXT NOT NULL DEFAULT '',
      decision_rubric TEXT NOT NULL DEFAULT '[]',
      segment_taxonomy TEXT NOT NULL DEFAULT '[]',
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
      detection_id TEXT,
      split_type TEXT NOT NULL CHECK(split_type IN ('MASTER','GOLDEN','ITERATION','HELD_OUT_EVAL','CUSTOM')),
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
      segment_tags TEXT NOT NULL DEFAULT '[]',
      ai_assigned_label TEXT,
      ai_confidence REAL,
      ground_truth_label TEXT CHECK(ground_truth_label IN ('DETECTED','NOT_DETECTED') OR ground_truth_label IS NULL),
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      detection_id TEXT NOT NULL,
      prompt_version_id TEXT NOT NULL,
      model_used TEXT NOT NULL DEFAULT '',
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
      parse_error_reason TEXT,
      parse_fix_suggestion TEXT,
      inference_runtime_ms INTEGER,
      parse_retry_count INTEGER NOT NULL DEFAULT 0,
      corrected_label TEXT,
      error_tag TEXT,
      reviewer_note TEXT,
      corrected_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_run_id ON predictions(run_id);
    CREATE INDEX IF NOT EXISTS idx_predictions_run_id_parse_ok ON predictions(run_id, parse_ok);
    CREATE INDEX IF NOT EXISTS idx_predictions_run_id_error_tag ON predictions(run_id, error_tag);
    CREATE INDEX IF NOT EXISTS idx_predictions_error_tag ON predictions(error_tag);
    CREATE INDEX IF NOT EXISTS idx_predictions_parse_ok ON predictions(parse_ok);
    CREATE INDEX IF NOT EXISTS idx_predictions_image_id ON predictions(image_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id ON dataset_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_id_image_id ON dataset_items(dataset_id, image_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_image_id ON dataset_items(image_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_gt ON dataset_items(ground_truth_label);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_detection_id ON prompt_versions(detection_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_detection_id_created_at ON prompt_versions(detection_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_datasets_detection_id ON datasets(detection_id);
    CREATE INDEX IF NOT EXISTS idx_datasets_split_type ON datasets(split_type);
    CREATE INDEX IF NOT EXISTS idx_datasets_created_at ON datasets(created_at);
    CREATE INDEX IF NOT EXISTS idx_datasets_name ON datasets(name);
    CREATE INDEX IF NOT EXISTS idx_runs_detection_id ON runs(detection_id);
    CREATE INDEX IF NOT EXISTS idx_runs_prompt_version_id ON runs(prompt_version_id);
    CREATE INDEX IF NOT EXISTS idx_runs_detection_id_created_at ON runs(detection_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_split_type ON runs(split_type);
    CREATE INDEX IF NOT EXISTS idx_runs_dataset_id ON runs(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_flags (
      flag_id TEXT PRIMARY KEY,
      prediction_id TEXT,
      dataset_item_id TEXT,
      detection_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
      resolution_action TEXT CHECK(resolution_action IN ('accepted','label_confirmed','label_corrected','attributes_corrected','both_corrected','image_removed','needs_discussion','correct','incorrect_both','incorrect_attributes','incorrect_label','ambiguous')),
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (prediction_id) REFERENCES predictions(prediction_id),
      FOREIGN KEY (dataset_item_id) REFERENCES dataset_items(item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_review_flags_detection ON review_flags(detection_id);
    CREATE INDEX IF NOT EXISTS idx_review_flags_status ON review_flags(status);
    CREATE INDEX IF NOT EXISTS idx_review_flags_prediction ON review_flags(prediction_id);
    CREATE INDEX IF NOT EXISTS idx_review_flags_dataset_item ON review_flags(dataset_item_id);

    CREATE TABLE IF NOT EXISTS qa_samples (
      sample_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      sample_method TEXT NOT NULL CHECK(sample_method IN ('random','stratified','flagged','discrepancy')),
      reviewer TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','skipped','accepted')),
      outcome TEXT CHECK(outcome IN ('accepted','label_corrected','attributes_corrected','both_corrected')),
      note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id),
      FOREIGN KEY (item_id) REFERENCES dataset_items(item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qa_samples_dataset ON qa_samples(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_qa_samples_status ON qa_samples(status);

    CREATE TABLE IF NOT EXISTS qa_logs (
      log_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qa_logs_dataset ON qa_logs(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_qa_logs_action ON qa_logs(action);
    CREATE INDEX IF NOT EXISTS idx_qa_logs_created_at ON qa_logs(created_at);

    CREATE TABLE IF NOT EXISTS groundtruth_corrections (
      correction_id TEXT PRIMARY KEY,
      prediction_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      old_label TEXT,
      new_label TEXT,
      predicted_decision TEXT,
      ai_matches_new_gt INTEGER,
      reason TEXT,
      actor TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (prediction_id) REFERENCES predictions(prediction_id),
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gt_corrections_run ON groundtruth_corrections(run_id);
    CREATE INDEX IF NOT EXISTS idx_gt_corrections_prediction ON groundtruth_corrections(prediction_id);
    CREATE INDEX IF NOT EXISTS idx_gt_corrections_created_at ON groundtruth_corrections(created_at);
  `);

  ensureDatasetItemColumns(db);
  ensureDatasetTableShape(db);
  ensureDetectionColumns(db);
  ensureNullableGroundTruthColumns(db);
  ensureRunsColumns(db);
  ensurePredictionParseColumns(db);
  ensurePredictionRuntimeColumns(db);
  ensureDatasetQaColumns(db);
  ensureReviewFlagResolutionActions(db);
  ensureReviewFlagResolvedBy(db);
  ensureReviewFlagResolutionSnapshot(db);
  ensureItemStatusColumn(db);
  ensureDatasetProgressColumns(db);
  ensureAnnotatorsTable(db);
  ensureQaSamplesAttemptColumn(db);
  ensureQaSamplesCorrectionColumns(db);
  ensureMetricsSnapshotsTable(db);
  migrateQaSamplesConstraints(db);
  migrateLinkedDatasetsToParentChild(db);
  syncReviewerNotesToImageDescription(db);
  ensureNotificationsTable(db);
  ensurePromptVersionNotesColumn(db);
}

function ensurePromptVersionNotesColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(prompt_versions)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "version_notes")) {
    db.exec("ALTER TABLE prompt_versions ADD COLUMN version_notes TEXT NOT NULL DEFAULT ''");
  }
}

function ensureDatasetTableShape(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(datasets)").all() as Array<{ name: string; notnull: number }>;
  const detectionIdColumn = columns.find((c) => c.name === "detection_id");
  const tableSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'datasets'")
    .get() as { sql?: string } | undefined;
  const hasMasterSplit = String(tableSqlRow?.sql || "").includes("'MASTER'");
  if (detectionIdColumn?.notnull === 0 && hasMasterSplit) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;

    CREATE TABLE datasets_new (
      dataset_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      detection_id TEXT,
      split_type TEXT NOT NULL CHECK(split_type IN ('MASTER','GOLDEN','ITERATION','HELD_OUT_EVAL','CUSTOM')),
      dataset_hash TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (detection_id) REFERENCES detections(detection_id)
    );

    INSERT INTO datasets_new (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
    SELECT dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at
    FROM datasets;

    DROP TABLE datasets;
    ALTER TABLE datasets_new RENAME TO datasets;

    CREATE INDEX IF NOT EXISTS idx_datasets_detection_id ON datasets(detection_id);
    CREATE INDEX IF NOT EXISTS idx_datasets_split_type ON datasets(split_type);
    CREATE INDEX IF NOT EXISTS idx_datasets_created_at ON datasets(created_at);
    CREATE INDEX IF NOT EXISTS idx_datasets_name ON datasets(name);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureDatasetItemColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(dataset_items)").all() as Array<{ name: string }>;
  const hasImageDescription = columns.some((c) => c.name === "image_description");
  const hasSegmentTags = columns.some((c) => c.name === "segment_tags");
  const hasAiAssignedLabel = columns.some((c) => c.name === "ai_assigned_label");
  const hasAiConfidence = columns.some((c) => c.name === "ai_confidence");
  if (!hasImageDescription) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN image_description TEXT NOT NULL DEFAULT ''");
  }
  if (!hasSegmentTags) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN segment_tags TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasAiAssignedLabel) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN ai_assigned_label TEXT");
  }
  if (!hasAiConfidence) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN ai_confidence REAL");
  }
}

function ensureDetectionColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(detections)").all() as Array<{ name: string }>;
  const hasSegmentTaxonomy = columns.some((c) => c.name === "segment_taxonomy");
  const hasDetectionCategory = columns.some((c) => c.name === "detection_category");
  const hasUserPromptAddendum = columns.some((c) => c.name === "user_prompt_addendum");
  if (!hasSegmentTaxonomy) {
    db.exec("ALTER TABLE detections ADD COLUMN segment_taxonomy TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasDetectionCategory) {
    db.exec("ALTER TABLE detections ADD COLUMN detection_category TEXT NOT NULL DEFAULT 'HAZARD_IDENTIFICATION'");
  }
  if (!hasUserPromptAddendum) {
    db.exec("ALTER TABLE detections ADD COLUMN user_prompt_addendum TEXT NOT NULL DEFAULT ''");
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
        segment_tags TEXT NOT NULL DEFAULT '[]',
        ai_assigned_label TEXT,
        ai_confidence REAL,
        ground_truth_label TEXT CHECK(ground_truth_label IN ('DETECTED','NOT_DETECTED') OR ground_truth_label IS NULL),
        FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
      );

      INSERT INTO dataset_items_new (item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label)
      SELECT item_id, dataset_id, image_id, image_uri, COALESCE(image_description, ''), COALESCE(segment_tags, '[]'), ai_assigned_label, ai_confidence, ground_truth_label
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
        parse_error_reason TEXT,
        parse_fix_suggestion TEXT,
        inference_runtime_ms INTEGER,
        parse_retry_count INTEGER NOT NULL DEFAULT 0,
        corrected_label TEXT,
        error_tag TEXT,
        reviewer_note TEXT,
        corrected_at TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );

      INSERT INTO predictions_new (
        prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence,
        evidence, parse_ok, raw_response, parse_error_reason, parse_fix_suggestion, inference_runtime_ms, parse_retry_count, corrected_label, error_tag, reviewer_note, corrected_at
      )
      SELECT
        prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence,
        evidence, parse_ok, raw_response, NULL, NULL, NULL, 0, corrected_label, error_tag, reviewer_note, corrected_at
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
  const hasModelUsed = columns.some((c) => c.name === "model_used");
  if (!hasPromptFeedbackLog) {
    db.exec("ALTER TABLE runs ADD COLUMN prompt_feedback_log TEXT NOT NULL DEFAULT '{}'");
  }
  if (!hasModelUsed) {
    db.exec("ALTER TABLE runs ADD COLUMN model_used TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    UPDATE runs
    SET model_used = COALESCE(NULLIF(model_used, ''), json_extract(decoding_params, '$.model'), '')
    WHERE model_used IS NULL OR model_used = ''
  `);
}

function ensurePredictionParseColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(predictions)").all() as Array<{ name: string }>;
  const hasParseReason = columns.some((c) => c.name === "parse_error_reason");
  const hasParseFix = columns.some((c) => c.name === "parse_fix_suggestion");
  if (!hasParseReason) {
    db.exec("ALTER TABLE predictions ADD COLUMN parse_error_reason TEXT");
  }
  if (!hasParseFix) {
    db.exec("ALTER TABLE predictions ADD COLUMN parse_fix_suggestion TEXT");
  }
}

function ensurePredictionRuntimeColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(predictions)").all() as Array<{ name: string }>;
  const hasRuntime = columns.some((c) => c.name === "inference_runtime_ms");
  const hasRetryCount = columns.some((c) => c.name === "parse_retry_count");
  if (!hasRuntime) {
    db.exec("ALTER TABLE predictions ADD COLUMN inference_runtime_ms INTEGER");
  }
  if (!hasRetryCount) {
    db.exec("ALTER TABLE predictions ADD COLUMN parse_retry_count INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureDatasetQaColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(datasets)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "qa_status")) {
    db.exec("ALTER TABLE datasets ADD COLUMN qa_status TEXT NOT NULL DEFAULT 'draft'");
  }
  if (!columns.some((c) => c.name === "assigned_to")) {
    db.exec("ALTER TABLE datasets ADD COLUMN assigned_to TEXT");
  }
  if (!columns.some((c) => c.name === "linked_dataset_id")) {
    db.exec("ALTER TABLE datasets ADD COLUMN linked_dataset_id TEXT");
  }
  if (!columns.some((c) => c.name === "qa_notes")) {
    db.exec("ALTER TABLE datasets ADD COLUMN qa_notes TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((c) => c.name === "segment_taxonomy")) {
    db.exec("ALTER TABLE datasets ADD COLUMN segment_taxonomy TEXT NOT NULL DEFAULT '[]'");
  }
}

function ensureReviewFlagResolutionActions(db: Database.Database) {
  const tableSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_flags'")
    .get() as { sql?: string } | undefined;
  const sql = String(tableSqlRow?.sql || "");
  if (sql.includes("'accepted'")) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;

    CREATE TABLE review_flags_new (
      flag_id TEXT PRIMARY KEY,
      prediction_id TEXT,
      dataset_item_id TEXT,
      detection_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
      resolution_action TEXT CHECK(resolution_action IN ('accepted','label_confirmed','label_corrected','attributes_corrected','both_corrected','image_removed','needs_discussion','correct','incorrect_both','incorrect_attributes','incorrect_label','ambiguous')),
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (prediction_id) REFERENCES predictions(prediction_id),
      FOREIGN KEY (dataset_item_id) REFERENCES dataset_items(item_id)
    );

    INSERT INTO review_flags_new SELECT * FROM review_flags;
    DROP TABLE review_flags;
    ALTER TABLE review_flags_new RENAME TO review_flags;

    CREATE INDEX IF NOT EXISTS idx_review_flags_detection ON review_flags(detection_id);
    CREATE INDEX IF NOT EXISTS idx_review_flags_status ON review_flags(status);
    CREATE INDEX IF NOT EXISTS idx_review_flags_prediction ON review_flags(prediction_id);
    CREATE INDEX IF NOT EXISTS idx_review_flags_dataset_item ON review_flags(dataset_item_id);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureReviewFlagResolvedBy(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(review_flags)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "resolved_by")) {
    db.exec("ALTER TABLE review_flags ADD COLUMN resolved_by TEXT");
  }
}

function ensureReviewFlagResolutionSnapshot(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(review_flags)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));
  if (!names.has("previous_ground_truth_label")) {
    db.exec("ALTER TABLE review_flags ADD COLUMN previous_ground_truth_label TEXT");
  }
  if (!names.has("new_ground_truth_label")) {
    db.exec("ALTER TABLE review_flags ADD COLUMN new_ground_truth_label TEXT");
  }
  if (!names.has("previous_attributes")) {
    db.exec("ALTER TABLE review_flags ADD COLUMN previous_attributes TEXT");
  }
  if (!names.has("new_attributes")) {
    db.exec("ALTER TABLE review_flags ADD COLUMN new_attributes TEXT");
  }
}

function ensureItemStatusColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(dataset_items)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "item_status")) {
    db.exec("ALTER TABLE dataset_items ADD COLUMN item_status TEXT NOT NULL DEFAULT 'unlabeled'");
    db.exec(`
      UPDATE dataset_items SET item_status = 'labeled'
      WHERE ground_truth_label IS NOT NULL
    `);
  }
}

function ensureDatasetProgressColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(datasets)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "items_labeled")) {
    db.exec("ALTER TABLE datasets ADD COLUMN items_labeled INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      UPDATE datasets SET items_labeled = (
        SELECT COUNT(*) FROM dataset_items
        WHERE dataset_items.dataset_id = datasets.dataset_id
          AND dataset_items.ground_truth_label IS NOT NULL
      )
    `);
  }
  if (!columns.some((c) => c.name === "revision_note")) {
    db.exec("ALTER TABLE datasets ADD COLUMN revision_note TEXT");
  }
}

function ensureAnnotatorsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotators (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `);
  const count = db.prepare("SELECT COUNT(*) as c FROM annotators").get() as { c: number };
  if (count.c === 0) {
    const existing = db.prepare(
      "SELECT DISTINCT assigned_to FROM datasets WHERE assigned_to IS NOT NULL AND assigned_to != ''"
    ).all() as Array<{ assigned_to: string }>;
    const insert = db.prepare("INSERT OR IGNORE INTO annotators (name, created_at) VALUES (?, ?)");
    const now = new Date().toISOString();
    for (const row of existing) {
      insert.run(row.assigned_to, now);
    }
  }
}

function ensureQaSamplesAttemptColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(qa_samples)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "attempt_number")) {
    db.exec("ALTER TABLE qa_samples ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1");
  }
}

function ensureQaSamplesCorrectionColumns(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(qa_samples)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "original_label")) {
    db.exec("ALTER TABLE qa_samples ADD COLUMN original_label TEXT");
    db.exec("ALTER TABLE qa_samples ADD COLUMN original_tags TEXT");
    db.exec("ALTER TABLE qa_samples ADD COLUMN corrected_label TEXT");
    db.exec("ALTER TABLE qa_samples ADD COLUMN corrected_tags TEXT");
  }
}

function ensureMetricsSnapshotsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      annotator TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'week',
      datasets_assigned INTEGER NOT NULL DEFAULT 0,
      datasets_completed INTEGER NOT NULL DEFAULT 0,
      items_labeled INTEGER NOT NULL DEFAULT 0,
      flag_rate REAL,
      attribute_error REAL,
      label_error REAL,
      accuracy REAL,
      correction REAL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_snapshots_unique
      ON metrics_snapshots(annotator, period_start, period_type);

    CREATE TABLE IF NOT EXISTS dataset_metrics (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      dataset_name TEXT NOT NULL,
      annotator TEXT NOT NULL,
      items_labeled INTEGER NOT NULL DEFAULT 0,
      flag_rate REAL,
      attribute_error REAL,
      label_error REAL,
      accuracy REAL,
      correction REAL,
      status TEXT NOT NULL DEFAULT 'draft',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
}

function migrateQaSamplesConstraints(db: Database.Database) {
  const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='qa_samples'").get() as { sql: string } | undefined;
  if (!info?.sql) return;
  if (info.sql.includes("label_corrected")) return;
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE qa_samples_new (
      sample_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      sample_method TEXT NOT NULL CHECK(sample_method IN ('random','stratified','flagged','discrepancy')),
      reviewer TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','skipped','accepted')),
      outcome TEXT CHECK(outcome IN ('accepted','label_corrected','attributes_corrected','both_corrected')),
      note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id),
      FOREIGN KEY (item_id) REFERENCES dataset_items(item_id)
    );
    INSERT INTO qa_samples_new (sample_id, dataset_id, item_id, sample_method, reviewer, status, outcome, note, created_at, reviewed_at)
      SELECT sample_id, dataset_id, item_id, sample_method, reviewer, status, NULL, note, created_at, reviewed_at FROM qa_samples;
    DROP TABLE qa_samples;
    ALTER TABLE qa_samples_new RENAME TO qa_samples;
    CREATE INDEX IF NOT EXISTS idx_qa_samples_dataset ON qa_samples(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_qa_samples_status ON qa_samples(status);
    PRAGMA foreign_keys = ON;
  `);
}

function migrateLinkedDatasetsToParentChild(db: Database.Database) {
  const indexExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_datasets_linked_dataset_id'")
    .get();
  if (indexExists) return;

  db.exec(`CREATE INDEX IF NOT EXISTS idx_datasets_linked_dataset_id ON datasets(linked_dataset_id)`);

  const pairs = db.prepare(`
    SELECT a.dataset_id AS a_id, b.dataset_id AS b_id, a.created_at AS a_created, b.created_at AS b_created
    FROM datasets a
    JOIN datasets b ON a.linked_dataset_id = b.dataset_id AND b.linked_dataset_id = a.dataset_id
    WHERE a.dataset_id < b.dataset_id
  `).all() as Array<{ a_id: string; b_id: string; a_created: string; b_created: string }>;

  const clearLink = db.prepare("UPDATE datasets SET linked_dataset_id = NULL WHERE dataset_id = ?");
  for (const pair of pairs) {
    const parentId = pair.a_created <= pair.b_created ? pair.a_id : pair.b_id;
    clearLink.run(parentId);
  }
}

function syncReviewerNotesToImageDescription(db: Database.Database) {
  db.exec(`
    UPDATE dataset_items
    SET image_description = (
      SELECT p.reviewer_note
      FROM predictions p
      JOIN runs r ON p.run_id = r.run_id
      WHERE r.dataset_id = dataset_items.dataset_id
        AND p.image_id = dataset_items.image_id
        AND p.reviewer_note IS NOT NULL
        AND p.reviewer_note != ''
      ORDER BY p.corrected_at DESC
      LIMIT 1
    )
    WHERE (image_description IS NULL OR image_description = '')
      AND EXISTS (
        SELECT 1 FROM predictions p
        JOIN runs r ON p.run_id = r.run_id
        WHERE r.dataset_id = dataset_items.dataset_id
          AND p.image_id = dataset_items.image_id
          AND p.reviewer_note IS NOT NULL
          AND p.reviewer_note != ''
      )
  `);
}

function ensureNotificationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      type TEXT NOT NULL,
      dataset_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      dismissed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);
    CREATE INDEX IF NOT EXISTS idx_notifications_dismissed ON notifications(recipient, dismissed);
  `);
}
