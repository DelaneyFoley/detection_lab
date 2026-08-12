// Seeds a self-contained parent + two annotator (child) datasets that exercise
// every branch of the new annotator-corrections logic end-to-end:
//   - QA label correction the annotator ADOPTED (previously invisible)
//   - QA attribute correction
//   - QA both-corrected on a later review round (attempt 2)
//   - Discrepancy label override where THIS annotator was overruled
//   - Discrepancy where THIS annotator WON (must NOT count)
//   - Discrepancy attribute correction (annotator missing a tag)
//   - Same image corrected by BOTH QA + Discrepancy
//   - Pure self-revision (no QA/discrepancy record -> must NOT count)
//   - Clean accepted rows
//
// Open the "Bug Repro — Annotator A" archived dataset on the Annotator tab to
// review the Outcome column. Idempotent: re-running wipes the prior seed.
//
//   node scripts/seed-outcome-repro.mjs

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs";

const db = new Database("./data/vlm-eval.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const DETECTION_ID = "700d9c78-858d-499e-b43b-49072b03adb0"; // Major Corrosion on Interior Plumbing
const TAXONOMY = ["dark_image", "blurry_image", "mineral_deposits", "surface_staining", "normal_patina", "out_of_scope_component", "major_rust", "rust", "major_oxidation", "oxidation"];
const NOW = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const ANNOTATOR_A = "Delaney";
const ANNOTATOR_B = "James K.";

// Real image URIs so previews render.
const uris = fs.readFileSync("/tmp/seed_uris.txt", "utf8").trim().split("\n").filter(Boolean);
const uriFor = (i) => uris[i % uris.length];

const PARENT_ID = "bugrepro-parent-0000-0000-000000000001";
const CHILD_A_ID = "bugrepro-childa-0000-0000-000000000001";
const CHILD_B_ID = "bugrepro-childb-0000-0000-000000000001";

// ── Idempotent cleanup ──────────────────────────────────────────────────────
const oldParents = db.prepare("SELECT dataset_id FROM datasets WHERE name LIKE 'Bug Repro —%'").all();
const oldIds = oldParents.map((r) => r.dataset_id);
for (const id of oldIds) {
  db.prepare("DELETE FROM qa_samples WHERE dataset_id = ?").run(id);
  db.prepare("DELETE FROM qa_logs WHERE dataset_id = ?").run(id);
  db.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(id);
  db.prepare("DELETE FROM datasets WHERE dataset_id = ?").run(id);
}
console.log(`✓ Cleaned ${oldIds.length} prior Bug Repro dataset(s)`);

for (const name of [ANNOTATOR_A, ANNOTATOR_B]) {
  db.prepare("INSERT OR IGNORE INTO annotators (name, created_at) VALUES (?, ?)").run(name, daysAgo(14));
}

// ── Scenario definition ─────────────────────────────────────────────────────
// finalA/finalB = each child's archived stored value; parent = finalized master.
// qa = QA sample recorded on child A (outcome + before/after).
// disc = n-way discrepancy resolution log recorded on the parent.
const T = (...t) => t; // tag helper
const scenario = [
  {
    image_id: "REPRO_01_qa_label_adopted",
    parent: { label: "NOT_DETECTED", tags: T() },
    finalA: { label: "NOT_DETECTED", tags: T() },
    finalB: { label: "NOT_DETECTED", tags: T() },
    qa: { attempt: 1, outcome: "label_corrected", ol: "DETECTED", cl: "NOT_DETECTED", ot: T(), ct: T() },
    // Expect A Outcome: DETECTED → NOT_DETECTED  [QA]
  },
  {
    image_id: "REPRO_02_qa_attr",
    parent: { label: "DETECTED", tags: T("rust", "oxidation") },
    finalA: { label: "DETECTED", tags: T("rust", "oxidation") },
    finalB: { label: "DETECTED", tags: T("rust", "oxidation") },
    qa: { attempt: 1, outcome: "attributes_corrected", ol: "DETECTED", cl: "DETECTED", ot: T("rust"), ct: T("rust", "oxidation") },
    // Expect A Outcome: +oxidation  [QA]
  },
  {
    image_id: "REPRO_03_qa_both_round2",
    parent: { label: "DETECTED", tags: T("rust", "major_rust") },
    finalA: { label: "DETECTED", tags: T("rust", "major_rust") },
    finalB: { label: "DETECTED", tags: T("rust", "major_rust") },
    qa: { attempt: 2, outcome: "both_corrected", ol: "NOT_DETECTED", cl: "DETECTED", ot: T("rust"), ct: T("rust", "major_rust") },
    // Expect A Outcome: NOT_DETECTED → DETECTED, +major_rust  [QA]
  },
  {
    image_id: "REPRO_04_disc_label_A_overruled",
    parent: { label: "NOT_DETECTED", tags: T() },
    finalA: { label: "DETECTED", tags: T() },
    finalB: { label: "NOT_DETECTED", tags: T() },
    disc: { resolved_label: "NOT_DETECTED", corrected_tags: null },
    // Expect A Outcome: DETECTED → NOT_DETECTED  [Discrepancy]
  },
  {
    image_id: "REPRO_05_disc_A_wins",
    parent: { label: "NOT_DETECTED", tags: T() },
    finalA: { label: "NOT_DETECTED", tags: T() },
    finalB: { label: "DETECTED", tags: T() },
    disc: { resolved_label: "NOT_DETECTED", corrected_tags: null },
    // Expect A Outcome: accepted (green check) — A won the discrepancy
  },
  {
    image_id: "REPRO_06_disc_attr_A_missing",
    parent: { label: "DETECTED", tags: T("rust", "oxidation") },
    finalA: { label: "DETECTED", tags: T("rust") },
    finalB: { label: "DETECTED", tags: T("rust", "oxidation") },
    disc: { resolved_label: "DETECTED", corrected_tags: T("rust", "oxidation") },
    // Expect A Outcome: +oxidation  [Discrepancy]
  },
  {
    image_id: "REPRO_07_qa_and_disc",
    parent: { label: "NOT_DETECTED", tags: T("rust", "mineral_deposits") },
    finalA: { label: "NOT_DETECTED", tags: T("rust") },
    finalB: { label: "NOT_DETECTED", tags: T("rust", "mineral_deposits") },
    qa: { attempt: 1, outcome: "label_corrected", ol: "DETECTED", cl: "NOT_DETECTED", ot: T("rust"), ct: T("rust") },
    disc: { resolved_label: "NOT_DETECTED", corrected_tags: T("rust", "mineral_deposits") },
    // Expect A Outcome: DETECTED → NOT_DETECTED, +mineral_deposits  [QA + Discrepancy]
  },
  {
    image_id: "REPRO_08_self_revision",
    parent: { label: "NOT_DETECTED", tags: T() },
    finalA: { label: "NOT_DETECTED", tags: T() },
    finalB: { label: "NOT_DETECTED", tags: T() },
    // No QA / no discrepancy — annotator fixed it themselves. Expect: accepted.
  },
  {
    image_id: "REPRO_09_accepted",
    parent: { label: "DETECTED", tags: T("rust") },
    finalA: { label: "DETECTED", tags: T("rust") },
    finalB: { label: "DETECTED", tags: T("rust") },
    // Expect: accepted.
  },
  {
    image_id: "REPRO_10_accepted_nd",
    parent: { label: "NOT_DETECTED", tags: T() },
    finalA: { label: "NOT_DETECTED", tags: T() },
    finalB: { label: "NOT_DETECTED", tags: T() },
    // Expect: accepted.
  },
];

// ── Datasets ────────────────────────────────────────────────────────────────
const insertDataset = db.prepare(`
  INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at,
    qa_status, assigned_to, linked_dataset_id, qa_notes, items_labeled, revision_note, segment_taxonomy, exclude_attributes)
  VALUES (?, ?, ?, 'CUSTOM', '', ?, ?, ?, ?, ?, ?, '', ?, NULL, ?, 0)
`);
const size = scenario.length;
insertDataset.run(PARENT_ID, "Bug Repro — Master (finalized)", DETECTION_ID, size, daysAgo(10), NOW, "finalized", null, null, size, JSON.stringify(TAXONOMY));
insertDataset.run(CHILD_A_ID, "Bug Repro — Annotator A", DETECTION_ID, size, daysAgo(10), NOW, "archived", ANNOTATOR_A, PARENT_ID, size, JSON.stringify(TAXONOMY));
insertDataset.run(CHILD_B_ID, "Bug Repro — Annotator B", DETECTION_ID, size, daysAgo(10), NOW, "archived", ANNOTATOR_B, PARENT_ID, size, JSON.stringify(TAXONOMY));
console.log("✓ Created parent + 2 child datasets");

// ── Items ───────────────────────────────────────────────────────────────────
const insertItem = db.prepare(`
  INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, image_description, ai_assigned_label, ai_confidence, ground_truth_label, segment_tags, item_status)
  VALUES (?, ?, ?, ?, '', NULL, NULL, ?, ?, 'labeled')
`);
const childAItemByImage = {};
scenario.forEach((s, i) => {
  const uri = uriFor(i);
  insertItem.run(randomUUID(), PARENT_ID, s.image_id, uri, s.parent.label, JSON.stringify(s.parent.tags));
  const aItemId = randomUUID();
  childAItemByImage[s.image_id] = aItemId;
  insertItem.run(aItemId, CHILD_A_ID, s.image_id, uri, s.finalA.label, JSON.stringify(s.finalA.tags));
  insertItem.run(randomUUID(), CHILD_B_ID, s.image_id, uri, s.finalB.label, JSON.stringify(s.finalB.tags));
});
console.log(`✓ Inserted ${scenario.length * 3} dataset items`);

// ── QA samples (recorded on child A) ────────────────────────────────────────
const insertSample = db.prepare(`
  INSERT INTO qa_samples (sample_id, dataset_id, item_id, sample_method, reviewer, status, outcome, note, created_at, reviewed_at,
    attempt_number, original_label, original_tags, corrected_label, corrected_tags)
  VALUES (?, ?, ?, 'random', 'QA Reviewer', 'reviewed', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
`);
let qaCount = 0;
for (const s of scenario) {
  if (!s.qa) continue;
  insertSample.run(
    randomUUID(), CHILD_A_ID, childAItemByImage[s.image_id], s.qa.outcome, daysAgo(5), daysAgo(5),
    s.qa.attempt, s.qa.ol, JSON.stringify(s.qa.ot), s.qa.cl, JSON.stringify(s.qa.ct)
  );
  qaCount++;
}
console.log(`✓ Inserted ${qaCount} QA sample corrections on Annotator A`);

// ── Discrepancy resolution logs (recorded on parent) ────────────────────────
const insertLog = db.prepare(`
  INSERT INTO qa_logs (log_id, dataset_id, action, actor, details, created_at) VALUES (?, ?, 'nway_discrepancy_resolved', 'QA Reviewer', ?, ?)
`);
let discCount = 0;
for (const s of scenario) {
  if (!s.disc) continue;
  insertLog.run(randomUUID(), PARENT_ID, JSON.stringify({
    image_id: s.image_id,
    resolution: "override",
    accepted_annotator: null,
    resolved_label: s.disc.resolved_label,
    corrected_tags: s.disc.corrected_tags,
  }), daysAgo(4));
  discCount++;
}
console.log(`✓ Inserted ${discCount} discrepancy resolution logs`);

console.log("\nDone. On the Annotator tab, open your work as '" + ANNOTATOR_A + "' and view the archived 'Bug Repro — Annotator A' dataset.");
