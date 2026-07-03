import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const db = new Database("./data/vlm-eval.db");
db.pragma("journal_mode = WAL");

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
`);

const annotators = ["Delaney", "Annotator 2", "Sarah M.", "James K."];

const profiles = {
  "Delaney": { baseAccuracy: 0.85, growth: 0.006, baseDatasetsPerWeek: 2, baseItemsPerWeek: 45 },
  "Annotator 2": { baseAccuracy: 0.75, growth: 0.005, baseDatasetsPerWeek: 1.5, baseItemsPerWeek: 35 },
  "Sarah M.": { baseAccuracy: 0.90, growth: 0.003, baseDatasetsPerWeek: 2.5, baseItemsPerWeek: 55 },
  "James K.": { baseAccuracy: 0.92, growth: 0.003, baseDatasetsPerWeek: 2, baseItemsPerWeek: 50 },
};

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function noise(amplitude) { return (Math.random() - 0.5) * 2 * amplitude; }
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d;
}

const WEEKS = 12;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const thisMonday = getMondayOfWeek(today);

const insert = db.prepare(`
  INSERT OR REPLACE INTO metrics_snapshots
  (snapshot_id, annotator, period_start, period_end, period_type, datasets_assigned, datasets_completed, items_labeled, flag_rate, attribute_error, label_error, accuracy, correction, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction(() => {
  db.prepare("DELETE FROM metrics_snapshots").run();

  for (const annotator of annotators) {
    const p = profiles[annotator];

    for (let week = 0; week < WEEKS; week++) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(thisMonday.getDate() - (WEEKS - 1 - week) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const datasetsAssigned = Math.max(1, Math.round(p.baseDatasetsPerWeek + noise(0.8)));
      const datasetsCompleted = Math.min(datasetsAssigned, Math.max(0, Math.round(datasetsAssigned * (0.6 + week * 0.02) + noise(0.5))));
      const itemsLabeled = Math.max(10, Math.round(p.baseItemsPerWeek + noise(8)));

      const weekAccuracy = clamp(p.baseAccuracy + p.growth * week + noise(0.03), 0.5, 0.99);
      const labelError = clamp(weekAccuracy + noise(0.02), 0.5, 0.99);
      const attributeError = clamp(weekAccuracy - 0.03 + noise(0.025), 0.4, 0.99);
      const accuracy = (labelError + attributeError) / 2;
      const correction = 1 - accuracy;
      const flagRate = clamp(0.08 - week * 0.003 + noise(0.02), 0.01, 0.25);

      insert.run(
        randomUUID(),
        annotator,
        formatDate(weekStart),
        formatDate(weekEnd),
        "week",
        datasetsAssigned,
        datasetsCompleted,
        itemsLabeled,
        flagRate,
        attributeError,
        labelError,
        accuracy,
        correction,
        now.toISOString()
      );
    }
  }
});

insertMany();

// ─── Seed dataset_metrics ───────────────────────────────────────────────────

db.exec(`
  DROP TABLE IF EXISTS dataset_metrics;
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

const datasetNames = {
  "Delaney": [
    { name: "Major Corrosion", items: 500, status: "submitted" },
    { name: "Major Corrosion_C1_Small - [Delaney]", items: 120, status: "in_qa" },
    { name: "Roof Damage - Batch 3", items: 340, status: "finalized" },
    { name: "HVAC Ductwork Inspection", items: 275, status: "approved" },
    { name: "Plumbing Leak Evidence", items: 180, status: "finalized" },
    { name: "Foundation Cracks - Set A", items: 420, status: "approved" },
    { name: "Exterior Paint Peeling", items: 95, status: "in_annotation" },
    { name: "Window Seal Failures", items: 210, status: "finalized" },
  ],
  "Annotator 2": [
    { name: "Rust and Oxidization", items: 500, status: "submitted" },
    { name: "Major Corrosion 2", items: 500, status: "in_qa" },
    { name: "Major Corrosion_C1_Small - [Annotator2]", items: 120, status: "in_qa" },
    { name: "Corrosion Test - A", items: 11, status: "finalized" },
    { name: "Gutter Deterioration", items: 310, status: "approved" },
    { name: "Siding Damage - North", items: 245, status: "finalized" },
    { name: "Deck Wood Rot", items: 180, status: "in_annotation" },
  ],
  "Sarah M.": [
    { name: "Plumbing_Sink_Kitchen", items: 600, status: "approved" },
    { name: "Major Oxidation", items: 340, status: "in_annotation" },
    { name: "Electrical Panel Issues", items: 450, status: "finalized" },
    { name: "Water Damage - Ceiling", items: 280, status: "finalized" },
    { name: "Mold Detection - Basement", items: 520, status: "approved" },
    { name: "Insulation Gaps", items: 190, status: "finalized" },
    { name: "Chimney Deterioration", items: 150, status: "submitted" },
    { name: "Flooring Damage Assessment", items: 380, status: "approved" },
  ],
  "James K.": [
    { name: "ICC_Water_Heater", items: 580, status: "approved" },
    { name: "ICC_Water_Heater_Plumbing", items: 556, status: "submitted" },
    { name: "Structural Beam Corrosion", items: 420, status: "finalized" },
    { name: "Fire Damage - Interior", items: 350, status: "finalized" },
    { name: "Garage Door Mechanism", items: 125, status: "approved" },
    { name: "Stucco Cracking Exterior", items: 290, status: "finalized" },
    { name: "Pipe Corrosion - Copper", items: 480, status: "approved" },
  ],
};

const insertDs = db.prepare(`
  INSERT OR REPLACE INTO dataset_metrics
  (id, dataset_id, dataset_name, annotator, items_labeled, flag_rate, attribute_error, label_error, accuracy, correction, status, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const seedDatasets = db.transaction(() => {
  db.prepare("DELETE FROM dataset_metrics").run();

  for (const annotator of annotators) {
    const p = profiles[annotator];
    const datasets = datasetNames[annotator];

    for (let i = 0; i < datasets.length; i++) {
      const ds = datasets[i];
      const baseAcc = p.baseAccuracy + p.growth * 8 + noise(0.04);
      const dsAccuracy = clamp(baseAcc, 0.55, 0.99);
      const dsLabelError = clamp(dsAccuracy + noise(0.03), 0.5, 0.99);
      const dsAttrError = clamp(dsAccuracy - 0.02 + noise(0.03), 0.45, 0.99);
      const dsOverall = (dsLabelError + dsAttrError) / 2;
      const dsCorrection = 1 - dsOverall;
      const dsFlagRate = clamp(0.04 + noise(0.03), 0.01, 0.15);

      const daysAgo = Math.floor(Math.random() * 60);
      const updatedAt = new Date(now);
      updatedAt.setDate(updatedAt.getDate() - daysAgo);

      insertDs.run(
        randomUUID(),
        randomUUID(),
        ds.name,
        annotator,
        ds.items,
        dsFlagRate,
        dsAttrError,
        dsLabelError,
        dsOverall,
        dsCorrection,
        ds.status,
        updatedAt.toISOString()
      );
    }
  }
});

seedDatasets();

// ─── Seed parent-child linked datasets demo ─────────────────────────────────

const parentId = "seed-parent-major-corrosion-c1-small";
const child1Id = "seed-child-delaney-mc-c1";
const child2Id = "seed-child-kevin-mc-c1";

const existingParent = db.prepare("SELECT dataset_id FROM datasets WHERE dataset_id = ?").get(parentId);
if (!existingParent) {
  const detectionRow = db.prepare("SELECT detection_id FROM detections WHERE display_name LIKE '%Major Corrosion%' LIMIT 1").get();
  const detectionId = detectionRow ? detectionRow.detection_id : null;
  const seedNow = new Date().toISOString();

  db.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, assigned_to, linked_dataset_id, created_at, updated_at)
    VALUES (?, ?, ?, 'CUSTOM', '', 120, 'draft', NULL, NULL, ?, ?)
  `).run(parentId, "Major Corrosion_C1_Small", detectionId, seedNow, seedNow);

  db.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, assigned_to, linked_dataset_id, created_at, updated_at)
    VALUES (?, ?, ?, 'CUSTOM', '', 120, 'submitted', 'Delaney', ?, ?, ?)
  `).run(child1Id, "Major Corrosion_C1_Small - Delaney F.", detectionId, parentId, seedNow, seedNow);

  db.prepare(`
    INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, assigned_to, linked_dataset_id, created_at, updated_at)
    VALUES (?, ?, ?, 'CUSTOM', '', 120, 'in_annotation', 'Kevin S.', ?, ?, ?)
  `).run(child2Id, "Major Corrosion_C1_Small - Kevin S.", detectionId, parentId, seedNow, seedNow);

  // Add annotators if not present
  const addAnnotator = db.prepare("INSERT OR IGNORE INTO annotators (name, created_at) VALUES (?, ?)");
  addAnnotator.run("Kevin S.", seedNow);
  addAnnotator.run("Delaney", seedNow);

  console.log("✓ Seeded parent-child linked datasets demo (1 parent + 2 children)");
} else {
  console.log("✓ Parent-child demo already seeded, skipping");
}

const count = db.prepare("SELECT COUNT(*) as count FROM metrics_snapshots").get();
const dsCount = db.prepare("SELECT COUNT(*) as count FROM dataset_metrics").get();
const periods = db.prepare("SELECT DISTINCT period_start FROM metrics_snapshots ORDER BY period_start").all();
console.log(`✓ Seeded ${count.count} metrics snapshots (${WEEKS} weeks × ${annotators.length} annotators)`);
console.log(`  Periods: ${periods.map(p => p.period_start).join(", ")}`);
console.log(`✓ Seeded ${dsCount.count} dataset metrics`);
db.close();
