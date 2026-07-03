import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import https from "https";
import http from "http";
import path from "path";

const runId = process.argv[2];
const db = new Database("./data/vlm-eval.db");

let targetRunId = runId;
if (!targetRunId) {
  const latest = db.prepare("SELECT run_id FROM runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1").get();
  if (!latest) {
    console.error("No completed runs found.");
    process.exit(1);
  }
  targetRunId = latest.run_id;
}

const run = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(targetRunId);
if (!run) {
  console.error(`Run not found: ${targetRunId}`);
  process.exit(1);
}

const predictions = db.prepare(
  `SELECT p.image_id, p.image_uri, p.predicted_decision, p.confidence, p.evidence,
          p.ground_truth_label, p.corrected_label, p.error_tag, p.reviewer_note,
          di.image_description, di.segment_tags
   FROM predictions p
   LEFT JOIN dataset_items di ON di.dataset_id = ? AND di.image_id = p.image_id
   WHERE p.run_id = ?
   ORDER BY p.image_id`
).all(run.dataset_id, targetRunId);

console.log(`Exporting ${predictions.length} predictions from run ${targetRunId}`);

function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "detection-lab-export" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImage(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function getImageExtension(uri) {
  const lower = uri.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".gif")) return "gif";
  if (lower.includes(".webp")) return "png";
  return "jpeg";
}

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Predictions");

const IMAGE_ROW_HEIGHT = 120;
const IMAGE_COL_WIDTH = 22;

sheet.columns = [
  { header: "Image", key: "image", width: IMAGE_COL_WIDTH },
  { header: "Image ID", key: "image_id", width: 16 },
  { header: "Predicted Label", key: "predicted_decision", width: 18 },
  { header: "Ground Truth", key: "ground_truth_label", width: 16 },
  { header: "Corrected Label", key: "corrected_label", width: 16 },
  { header: "Confidence", key: "confidence", width: 12 },
  { header: "Attributes", key: "attributes", width: 30 },
  { header: "Error Tag", key: "error_tag", width: 22 },
  { header: "Evidence", key: "evidence", width: 60 },
  { header: "Notes", key: "notes", width: 40 },
];

sheet.getRow(1).font = { bold: true };
sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

let imagesFailed = 0;

for (let i = 0; i < predictions.length; i++) {
  const pred = predictions[i];
  const rowIndex = i + 2;

  const tags = (() => { try { return JSON.parse(pred.segment_tags || "[]"); } catch { return []; } })();

  sheet.addRow({
    image: "",
    image_id: pred.image_id,
    predicted_decision: pred.predicted_decision || "N/A",
    ground_truth_label: pred.ground_truth_label || "",
    corrected_label: pred.corrected_label || "",
    confidence: pred.confidence != null ? Math.round(pred.confidence * 100) / 100 : "",
    attributes: tags.join(", "),
    error_tag: pred.error_tag || "",
    evidence: pred.evidence || "",
    notes: pred.image_description || pred.reviewer_note || "",
  });

  const row = sheet.getRow(rowIndex);
  row.height = IMAGE_ROW_HEIGHT;
  row.alignment = { vertical: "middle", wrapText: true };

  if (pred.image_uri) {
    try {
      let imageBuffer;
      let ext;

      if (pred.image_uri.startsWith("data:")) {
        const match = pred.image_uri.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          ext = match[1] === "jpeg" || match[1] === "jpg" ? "jpeg" : "png";
          imageBuffer = Buffer.from(match[2], "base64");
        }
      } else {
        ext = getImageExtension(pred.image_uri);
        imageBuffer = await fetchImage(pred.image_uri);
      }

      if (imageBuffer) {
        const imageId = workbook.addImage({
          buffer: imageBuffer,
          extension: ext,
        });

        sheet.addImage(imageId, {
          tl: { col: 0, row: rowIndex - 1 },
          ext: { width: 150, height: 150 },
        });
      }
    } catch (err) {
      imagesFailed++;
      if (imagesFailed <= 3) {
        console.warn(`  Failed to fetch image for ${pred.image_id}: ${err.message}`);
      }
    }
  }

  if ((i + 1) % 50 === 0) {
    console.log(`  Processed ${i + 1}/${predictions.length}`);
  }
}

if (imagesFailed > 3) {
  console.warn(`  ... and ${imagesFailed - 3} more image fetch failures`);
}

const outputName = `run_export_${targetRunId.substring(0, 8)}.xlsx`;
const outputPath = path.join(".", outputName);
await workbook.xlsx.writeFile(outputPath);

console.log(`\nExported to: ${outputPath}`);
console.log(`  Images embedded: ${predictions.length - imagesFailed}/${predictions.length}`);

db.close();
