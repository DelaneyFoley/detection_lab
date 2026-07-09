import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Export a fixed set of datasets into a committed seed file that ships with the
// repo, so they appear in the app when someone clones it. SANITIZED on purpose:
// only the dataset name, image_id, and image_uri are exported — no ground-truth
// labels, no attribute tags, no detection assignment, no split type. Those are
// applied by the loader (blank labels/tags, unassigned detection, CUSTOM split,
// fixed attribute taxonomy).

const DATASET_NAMES = [
  "MC - Toilet V1",
  "MC - Toilet V2",
  "MC - Sink V1",
  "MC - Sink V2",
  "MC - Laundry V1",
  "MC - Laundry V2",
  "MC - Water Heater V1",
  "MC - Water Heater V2",
  "MC - Water Heater V3",
];

const db = new Database("./data/vlm-eval.db");
const outPath = path.join("src", "lib", "seed-datasets.json");

const datasets = [];
for (const name of DATASET_NAMES) {
  const d = db.prepare("SELECT dataset_id FROM datasets WHERE name = ?").get(name);
  if (!d) {
    console.warn(`MISSING (skipped): ${name}`);
    continue;
  }
  const items = db
    .prepare("SELECT image_id, image_uri FROM dataset_items WHERE dataset_id = ? ORDER BY image_id")
    .all(d.dataset_id)
    .map((r) => ({ image_id: String(r.image_id), image_uri: String(r.image_uri) }));
  datasets.push({ name, items });
  console.log(`Exported ${name}: ${items.length} items`);
}

fs.writeFileSync(outPath, JSON.stringify({ datasets }, null, 2));
const bytes = fs.statSync(outPath).size;
console.log(`\nWrote ${datasets.length} dataset(s) → ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
db.close();
