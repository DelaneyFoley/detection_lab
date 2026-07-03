import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const db = new Database("./data/vlm-eval.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const DETECTION_ID = "5ca91bd2-be86-4933-9ae3-996db97b1765"; // Major Corrosion
const DETECTION_ID_2 = "700d9c78-858d-499e-b43b-49072b03adb0"; // Major Corrosion on Interior Plumbing

const NOW = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// Ensure annotators exist
const annotators = ["Delaney", "Annotator 2", "Sarah M.", "James K."];
for (const name of annotators) {
  db.prepare("INSERT OR IGNORE INTO annotators (name, created_at) VALUES (?, ?)").run(name, daysAgo(14));
}
console.log("✓ Annotators seeded:", annotators);

// ─── Assign existing datasets to annotators with varied qa_status ───────────

const assignments = [
  // Delaney's work
  { id: "37e10cdc-a926-4b29-8837-818cd59e277b", status: "submitted", assignee: "Delaney" },
  { id: "b2756b85-409f-4879-8cfd-faba6385a258", status: "in_annotation", assignee: "Delaney" },
  // Annotator 2's work
  { id: "99600b02-501b-4d54-b4b8-1b292999c3bd", status: "in_qa", assignee: "Annotator 2" },
  { id: "0df09420-fda5-4de8-8582-3467026aa658", status: "submitted", assignee: "Annotator 2" },
  // Sarah's work
  { id: "fd4b6491-6673-490a-b329-e4a9c89e6b4f", status: "approved", assignee: "Sarah M." },
  { id: "f44c2d6f-9bed-4d6d-9547-200e66b1b52e", status: "in_annotation", assignee: "Sarah M." },
  // James's work
  { id: "7aa41559-8f7f-4247-903b-541e9796b817", status: "finalized", assignee: "James K." },
  { id: "824b74c1-1be8-4a77-84d1-f8f070493984", status: "submitted", assignee: "James K." },
];

const updateStatus = db.prepare("UPDATE datasets SET qa_status = ?, assigned_to = ?, items_labeled = CASE WHEN ? IN ('submitted','in_qa','approved','finalized') THEN size ELSE CAST(size * 0.6 AS INTEGER) END WHERE dataset_id = ?");
for (const a of assignments) {
  updateStatus.run(a.status, a.assignee, a.status, a.id);
}
console.log("✓ Dataset assignments updated:", assignments.length);

// ─── Create new review flags for annotation workflows ───────────────────────

// Get items from assigned datasets to create flags against
const delaneyItems = db.prepare("SELECT item_id, image_id, image_uri FROM dataset_items WHERE dataset_id = ? LIMIT 20").all("37e10cdc-a926-4b29-8837-818cd59e277b");
const ann2Items = db.prepare("SELECT item_id, image_id, image_uri FROM dataset_items WHERE dataset_id = ? LIMIT 20").all("99600b02-501b-4d54-b4b8-1b292999c3bd");
const sarahItems = db.prepare("SELECT item_id, image_id, image_uri FROM dataset_items WHERE dataset_id = ? LIMIT 20").all("fd4b6491-6673-490a-b329-e4a9c89e6b4f");
const jamesItems = db.prepare("SELECT item_id, image_id, image_uri FROM dataset_items WHERE dataset_id = ? LIMIT 20").all("7aa41559-8f7f-4247-903b-541e9796b817");

const flagReasons = [
  "Image quality too low to determine corrosion severity",
  "Unclear if this is surface oxidation or structural corrosion",
  "Multiple conditions visible — label ambiguous",
  "Possible lighting artifact mimicking corrosion pattern",
  "Need clarification on spec — does this count as 'major'?",
  "Pipe partially obscured by insulation",
  "Cannot confirm if discoloration is corrosion or water staining",
  "Segment tag does not match visible pipe material",
];

const resolutionActions = ["label_confirmed", "label_corrected", "attributes_corrected", "both_corrected", "image_removed", "needs_discussion"];
const resolutionNotes = [
  "Confirmed with team lead — this meets the threshold for major corrosion",
  "Updated label to NOT_DETECTED per revised spec section 3.2",
  "Corrected segment tags: copper → galvanized steel",
  "Image removed — duplicate of MC_1204",
  "Escalated to detection owner for spec clarification",
  null,
  "Label was correct, added clarifying note to spec",
  null,
];

const insertFlag = db.prepare(`INSERT INTO review_flags (flag_id, prediction_id, dataset_item_id, detection_id, image_id, reason, status, resolution_action, resolution_note, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const flags = [];

// Delaney's open flags (3)
for (let i = 0; i < 3; i++) {
  const item = delaneyItems[i + 5];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID, imgId: item.image_id,
    reason: flagReasons[i], status: "open",
    action: null, note: null,
    created: daysAgo(3 - i), resolved: null,
  });
}

// Delaney's resolved flags (5)
for (let i = 0; i < 5; i++) {
  const item = delaneyItems[i + 10];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID, imgId: item.image_id,
    reason: flagReasons[i + 3], status: "resolved",
    action: resolutionActions[i], note: resolutionNotes[i],
    created: daysAgo(7 - i), resolved: daysAgo(4 - i),
  });
}

// Annotator 2's open flags (2)
for (let i = 0; i < 2; i++) {
  const item = ann2Items[i + 3];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID, imgId: item.image_id,
    reason: flagReasons[i + 1], status: "open",
    action: null, note: null,
    created: daysAgo(2 - i), resolved: null,
  });
}

// Annotator 2's resolved flags (4)
for (let i = 0; i < 4; i++) {
  const item = ann2Items[i + 8];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID, imgId: item.image_id,
    reason: flagReasons[(i + 2) % flagReasons.length], status: "resolved",
    action: resolutionActions[i + 1], note: resolutionNotes[i + 2],
    created: daysAgo(10 - i), resolved: daysAgo(6 - i),
  });
}

// Sarah's flags (1 open, 3 resolved)
for (let i = 0; i < 1; i++) {
  const item = sarahItems[i];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID_2, imgId: item.image_id,
    reason: flagReasons[5], status: "open",
    action: null, note: null,
    created: daysAgo(1), resolved: null,
  });
}
for (let i = 0; i < 3; i++) {
  const item = sarahItems[i + 5];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID_2, imgId: item.image_id,
    reason: flagReasons[(i + 4) % flagReasons.length], status: "resolved",
    action: resolutionActions[(i + 2) % resolutionActions.length], note: resolutionNotes[(i + 3) % resolutionNotes.length],
    created: daysAgo(8 - i), resolved: daysAgo(5 - i),
  });
}

// James's flags (0 open, 6 resolved — finalized dataset)
for (let i = 0; i < 6; i++) {
  const item = jamesItems[i + 2];
  flags.push({
    id: randomUUID(), predId: null, itemId: item.item_id,
    detId: DETECTION_ID_2, imgId: item.image_id,
    reason: flagReasons[i % flagReasons.length], status: "resolved",
    action: resolutionActions[i % resolutionActions.length], note: resolutionNotes[i % resolutionNotes.length],
    created: daysAgo(14 - i), resolved: daysAgo(10 - i),
  });
}

const insertFlags = db.transaction(() => {
  for (const f of flags) {
    insertFlag.run(f.id, f.predId, f.itemId, f.detId, f.imgId, f.reason, f.status, f.action, f.note, f.created, f.resolved);
  }
});
insertFlags();
console.log("✓ Review flags created:", flags.length);

// ─── Create QA samples for datasets in QA stages ────────────────────────────

const insertSample = db.prepare(`INSERT INTO qa_samples (sample_id, dataset_id, item_id, sample_method, reviewer, status, outcome, note, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function createSamplesForDataset(datasetId, count, reviewerName, reviewRate, outcomeDistribution) {
  const items = db.prepare("SELECT item_id FROM dataset_items WHERE dataset_id = ? ORDER BY RANDOM() LIMIT ?").all(datasetId, count);
  const samples = [];
  for (let i = 0; i < items.length; i++) {
    const reviewed = Math.random() < reviewRate;
    let outcome = null;
    let note = null;
    if (reviewed) {
      const roll = Math.random();
      if (roll < outcomeDistribution.accepted) {
        outcome = "accepted";
      } else if (roll < outcomeDistribution.accepted + outcomeDistribution.labelCorrected) {
        outcome = "label_corrected";
        note = "Label updated per spec revision";
      } else if (roll < outcomeDistribution.accepted + outcomeDistribution.labelCorrected + outcomeDistribution.attrCorrected) {
        outcome = "attributes_corrected";
        note = "Segment tags updated";
      } else {
        outcome = "both_corrected";
        note = "Both label and attributes needed correction";
      }
    }
    samples.push({
      id: randomUUID(),
      datasetId,
      itemId: items[i].item_id,
      method: i % 3 === 0 ? "stratified" : "random",
      reviewer: reviewed ? reviewerName : null,
      status: reviewed ? "reviewed" : "pending",
      outcome,
      note,
      created: daysAgo(5),
      reviewed: reviewed ? daysAgo(3) : null,
    });
  }
  return samples;
}

const allSamples = [
  // Major Corrosion (Delaney, submitted) — fully reviewed, high accuracy
  ...createSamplesForDataset("37e10cdc-a926-4b29-8837-818cd59e277b", 25, "QA Lead", 1.0, { accepted: 0.88, labelCorrected: 0.06, attrCorrected: 0.04, bothCorrected: 0.02 }),
  // Major Corrosion 2 (Annotator 2, in_qa) — partially reviewed
  ...createSamplesForDataset("99600b02-501b-4d54-b4b8-1b292999c3bd", 30, "QA Lead", 0.7, { accepted: 0.75, labelCorrected: 0.12, attrCorrected: 0.08, bothCorrected: 0.05 }),
  // Plumbing (Sarah, approved) — fully reviewed, good accuracy
  ...createSamplesForDataset("fd4b6491-6673-490a-b329-e4a9c89e6b4f", 20, "QA Lead", 1.0, { accepted: 0.92, labelCorrected: 0.04, attrCorrected: 0.03, bothCorrected: 0.01 }),
  // Water Heater (James, finalized) — fully reviewed, excellent
  ...createSamplesForDataset("7aa41559-8f7f-4247-903b-541e9796b817", 30, "QA Lead", 1.0, { accepted: 0.94, labelCorrected: 0.03, attrCorrected: 0.02, bothCorrected: 0.01 }),
  // Oxidation (Annotator 2, submitted) — fully reviewed
  ...createSamplesForDataset("0df09420-fda5-4de8-8582-3467026aa658", 20, "QA Lead", 1.0, { accepted: 0.80, labelCorrected: 0.10, attrCorrected: 0.06, bothCorrected: 0.04 }),
  // Water Heater Plumbing (James, submitted) — partially reviewed
  ...createSamplesForDataset("824b74c1-1be8-4a77-84d1-f8f070493984", 15, "QA Lead", 0.6, { accepted: 0.85, labelCorrected: 0.08, attrCorrected: 0.05, bothCorrected: 0.02 }),
];

const insertSamples = db.transaction(() => {
  for (const s of allSamples) {
    insertSample.run(s.id, s.datasetId, s.itemId, s.method, s.reviewer, s.status, s.outcome, s.note, s.created, s.reviewed);
  }
});
insertSamples();
console.log("✓ QA samples created:", allSamples.length);

// ─── Create QA logs for activity tracking ───────────────────────────────────

const insertLog = db.prepare(`INSERT INTO qa_logs (log_id, dataset_id, action, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`);

const logEntries = [
  { ds: "37e10cdc-a926-4b29-8837-818cd59e277b", action: "status_changed", actor: "Delaney", details: { from: "in_annotation", to: "submitted" }, date: daysAgo(5) },
  { ds: "37e10cdc-a926-4b29-8837-818cd59e277b", action: "sample_reviewed", actor: "QA Lead", details: { method: "random", count: 25 }, date: daysAgo(4) },
  { ds: "99600b02-501b-4d54-b4b8-1b292999c3bd", action: "status_changed", actor: "Annotator 2", details: { from: "in_annotation", to: "submitted" }, date: daysAgo(4) },
  { ds: "99600b02-501b-4d54-b4b8-1b292999c3bd", action: "status_changed", actor: "QA Lead", details: { from: "submitted", to: "in_qa" }, date: daysAgo(3) },
  { ds: "fd4b6491-6673-490a-b329-e4a9c89e6b4f", action: "status_changed", actor: "Sarah M.", details: { from: "in_annotation", to: "submitted" }, date: daysAgo(6) },
  { ds: "fd4b6491-6673-490a-b329-e4a9c89e6b4f", action: "status_changed", actor: "QA Lead", details: { from: "in_qa", to: "approved" }, date: daysAgo(2) },
  { ds: "7aa41559-8f7f-4247-903b-541e9796b817", action: "status_changed", actor: "QA Lead", details: { from: "approved", to: "finalized" }, date: daysAgo(1) },
  { ds: "7aa41559-8f7f-4247-903b-541e9796b817", action: "sample_reviewed", actor: "QA Lead", details: { method: "stratified", count: 30 }, date: daysAgo(3) },
  { ds: "0df09420-fda5-4de8-8582-3467026aa658", action: "status_changed", actor: "Annotator 2", details: { from: "in_annotation", to: "submitted" }, date: daysAgo(3) },
  { ds: "824b74c1-1be8-4a77-84d1-f8f070493984", action: "status_changed", actor: "James K.", details: { from: "in_annotation", to: "submitted" }, date: daysAgo(2) },
  { ds: "b2756b85-409f-4879-8cfd-faba6385a258", action: "assigned", actor: "QA Lead", details: { assigned_to: "Delaney" }, date: daysAgo(8) },
  { ds: "f44c2d6f-9bed-4d6d-9547-200e66b1b52e", action: "assigned", actor: "QA Lead", details: { assigned_to: "Sarah M." }, date: daysAgo(7) },
];

const insertLogs = db.transaction(() => {
  for (const l of logEntries) {
    insertLog.run(randomUUID(), l.ds, l.action, l.actor, JSON.stringify(l.details), l.date);
  }
});
insertLogs();
console.log("✓ QA logs created:", logEntries.length);

// ─── Update items_labeled counts for in-progress datasets ───────────────────

db.prepare("UPDATE datasets SET items_labeled = 312 WHERE dataset_id = ?").run("b2756b85-409f-4879-8cfd-faba6385a258"); // Delaney in_annotation (120 size but let's say 312 of 500 for major corr)
db.prepare("UPDATE datasets SET items_labeled = 340 WHERE dataset_id = ?").run("f44c2d6f-9bed-4d6d-9547-200e66b1b52e"); // Sarah in_annotation

// Mark some items as labeled for realism
const labelItems = db.prepare("UPDATE dataset_items SET ground_truth_label = CASE WHEN RANDOM() % 3 = 0 THEN 'DETECTED' ELSE 'NOT_DETECTED' END, item_status = 'labeled' WHERE dataset_id = ? AND item_id IN (SELECT item_id FROM dataset_items WHERE dataset_id = ? ORDER BY RANDOM() LIMIT ?)");
labelItems.run("b2756b85-409f-4879-8cfd-faba6385a258", "b2756b85-409f-4879-8cfd-faba6385a258", 72);
labelItems.run("f44c2d6f-9bed-4d6d-9547-200e66b1b52e", "f44c2d6f-9bed-4d6d-9547-200e66b1b52e", 340);

console.log("✓ Items labeled for in-progress datasets");

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n=== Seed Complete ===");
console.log("Annotators:", annotators.join(", "));
console.log("Datasets assigned:", assignments.length);
console.log("Flags created:", flags.length);
console.log("QA samples created:", allSamples.length);
console.log("QA logs created:", logEntries.length);
console.log("\nDataset status distribution:");
const statusCounts = db.prepare("SELECT qa_status, COUNT(*) as c FROM datasets GROUP BY qa_status").all();
for (const s of statusCounts) {
  console.log(`  ${s.qa_status}: ${s.c}`);
}
