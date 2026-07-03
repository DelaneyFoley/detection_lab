import Database from "better-sqlite3";

const db = new Database("./data/vlm-eval.db");

const DS1 = "37e10cdc-a926-4b29-8837-818cd59e277b";
const DS2 = "99600b02-501b-4d54-b4b8-1b292999c3bd";
const RUN = "e54e563f-0b8f-4101-9b47-d20b8f886903";

const predLabels = db.prepare(`SELECT image_id, ground_truth_label FROM predictions WHERE run_id = ? AND ground_truth_label IS NOT NULL AND ground_truth_label != ''`).all(RUN);
console.log("Labels from predictions:", predLabels.length);

const tags = db.prepare(`SELECT image_id, segment_tags FROM dataset_items WHERE dataset_id = ?`).all(DS1);

const updateLabel = db.prepare(`UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?`);
const updateTags = db.prepare(`UPDATE dataset_items SET segment_tags = ? WHERE dataset_id = ? AND image_id = ?`);

const tx = db.transaction(() => {
  let labelsDS1 = 0, labelsDS2 = 0, tagsDS2 = 0;

  for (const p of predLabels) {
    labelsDS1 += updateLabel.run(p.ground_truth_label, DS1, p.image_id).changes;
    labelsDS2 += updateLabel.run(p.ground_truth_label, DS2, p.image_id).changes;
  }

  for (const t of tags) {
    if (t.segment_tags && t.segment_tags !== '["Baseline"]') {
      tagsDS2 += updateTags.run(t.segment_tags, DS2, t.image_id).changes;
    }
  }

  console.log("Labels updated in Major Corrosion:", labelsDS1);
  console.log("Labels updated in Major Corrosion 2:", labelsDS2);
  console.log("Segment tags copied to Major Corrosion 2:", tagsDS2);
});

tx();

const v1 = db.prepare(`SELECT COUNT(*) as labeled FROM dataset_items WHERE dataset_id = ? AND ground_truth_label IS NOT NULL AND ground_truth_label != ''`).get(DS1);
const v2 = db.prepare(`SELECT COUNT(*) as labeled FROM dataset_items WHERE dataset_id = ? AND ground_truth_label IS NOT NULL AND ground_truth_label != ''`).get(DS2);
const v2tags = db.prepare(`SELECT COUNT(*) as rich FROM dataset_items WHERE dataset_id = ? AND segment_tags != '["Baseline"]' AND segment_tags != '[]'`).get(DS2);

console.log("\nVerification:");
console.log("Major Corrosion labels:", v1.labeled);
console.log("Major Corrosion 2 labels:", v2.labeled);
console.log("Major Corrosion 2 rich tags:", v2tags.rich);

db.close();
