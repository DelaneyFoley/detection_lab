// Reusable importer: appends local images into an existing dataset via the app's
// append_files endpoint so file storage + dataset stats stay consistent.
//
// Usage:
//   node scripts/import-images-to-dataset.mjs \
//     --dir "/path/to/images" --dataset <DATASET_ID> --prefix HOOD_NON_ --start 2000 \
//     [--endpoint http://localhost:3000/api/datasets]
//
// Images are sorted alphabetically by filename and assigned sequential IDs
// (<prefix><start>, <prefix><start+1>, ...). Ground truth, description, and
// segment tags are left empty for later labeling.
import fs from "fs/promises";
import path from "path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[name] = true;
    } else {
      out[name] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SRC_DIR = args.dir;
const DATASET_ID = args.dataset;
const ID_PREFIX = args.prefix;
const START_ID = Number(args.start);
const ENDPOINT = args.endpoint || "http://localhost:3000/api/datasets";

const missing = [];
if (!SRC_DIR) missing.push("--dir");
if (!DATASET_ID) missing.push("--dataset");
if (!ID_PREFIX) missing.push("--prefix");
if (!Number.isInteger(START_ID)) missing.push("--start (integer)");
if (missing.length > 0) {
  console.error(`Missing/invalid required args: ${missing.join(", ")}`);
  console.error('Example: node scripts/import-images-to-dataset.mjs --dir "/path/to/images" --dataset <ID> --prefix HOOD_NON_ --start 2000');
  process.exit(1);
}

const IMAGE_RE = /\.(png|jpe?g)$/i;

const entries = (await fs.readdir(SRC_DIR))
  .filter((name) => IMAGE_RE.test(name))
  .sort((a, b) => a.localeCompare(b, "en"));

if (entries.length === 0) {
  console.error("No image files found in", SRC_DIR);
  process.exit(1);
}

const form = new FormData();
form.set("action", "append_files");
form.set("dataset_id", DATASET_ID);

const items = [];
for (let i = 0; i < entries.length; i++) {
  const fileName = entries[i];
  const imageId = `${ID_PREFIX}${START_ID + i}`;
  const buf = await fs.readFile(path.join(SRC_DIR, fileName));
  const ext = path.extname(fileName).toLowerCase();
  const type = ext === ".png" ? "image/png" : "image/jpeg";
  form.append("files", new Blob([buf], { type }), fileName);
  items.push({ image_id: imageId, image_description: "", segment_tags: [], ground_truth_label: null });
}
form.set("items", JSON.stringify(items));

console.log(`Uploading ${items.length} images as ${items[0].image_id}..${items[items.length - 1].image_id}`);

const res = await fetch(ENDPOINT, { method: "PUT", body: form });
const text = await res.text();
console.log("Status:", res.status);
console.log("Response:", text);
if (!res.ok) process.exit(1);
