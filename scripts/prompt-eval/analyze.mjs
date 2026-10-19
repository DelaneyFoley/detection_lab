// Dump b9 baseline FP/FN evidence per label on a split, and write per-label eval
// subsets (all positives + hard negatives (stored FPs) + random negatives).
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const db = new Database(path.join(REPO_ROOT, 'data', 'vlm-eval.db'), { readonly: true });

const prefix = process.argv[2] || 'aa6b9fb8';
const baselineRun = process.argv[3] || 'b9c98606';
const labels = ['inadequate hood coverage', 'hood missing filter', 'hood grease buildup', 'fryer missing baffle', 'hood bypass gap'];

const dsId = db.prepare('SELECT dataset_id FROM datasets WHERE dataset_id LIKE ?').get(prefix + '%').dataset_id;
const runId = db.prepare('SELECT run_id FROM runs WHERE run_id LIKE ?').get(baselineRun + '%').run_id;
const items = db.prepare('SELECT image_id, ground_truth_labels FROM dataset_items WHERE dataset_id=?').all(dsId);
const idset = new Set(items.map((i) => i.image_id));
const gt = {};
for (const it of items) { let a = []; try { a = JSON.parse(it.ground_truth_labels || '[]'); } catch {} gt[it.image_id] = new Set(a); }
const preds = db.prepare('SELECT image_id, detection_label, predicted_decision, evidence FROM predictions WHERE run_id=?').all(runId).filter((p) => idset.has(p.image_id));
const byImgLabel = {};
for (const p of preds) { (byImgLabel[p.image_id] ||= {})[p.detection_label] = p; }

const outDir = path.join(__dirname, 'subsets');
fs.mkdirSync(outDir, { recursive: true });

for (const L of labels) {
  const pos = [], fpIds = [], fnEv = [], fpEv = [];
  for (const it of items) {
    const truth = gt[it.image_id].has(L);
    const pr = byImgLabel[it.image_id]?.[L];
    const pred = pr?.predicted_decision === 'DETECTED';
    if (truth) pos.push(it.image_id);
    if (pred && !truth) { fpIds.push(it.image_id); fpEv.push([it.image_id.slice(-5), (pr.evidence || '').replace(/\s+/g, ' ').slice(0, 130)]); }
    if (!pred && truth) fnEv.push([it.image_id.slice(-5), (pr?.evidence || '').replace(/\s+/g, ' ').slice(0, 130)]);
  }
  // subset = positives + FP hard negatives + random negatives
  const negAll = items.map((i) => i.image_id).filter((id) => !gt[id].has(L) && !fpIds.includes(id));
  const rndNeg = negAll.sort(() => Math.random() - 0.5).slice(0, 50);
  const subset = [...new Set([...pos, ...fpIds, ...rndNeg])];
  const fname = L.replace(/\s+/g, '_') + '.txt';
  fs.writeFileSync(path.join(outDir, fname), subset.join('\n'));
  console.log(`\n######## ${L} :: pos=${pos.length} FP=${fpIds.length} rndNeg=${rndNeg.length} subset=${subset.length} -> subsets/${fname}`);
  console.log(`  -- FALSE POSITIVES (${fpEv.length}) --`);
  for (const [id, e] of fpEv.slice(0, 12)) console.log(`   ${id}: ${e}`);
  console.log(`  -- FALSE NEGATIVES (${fnEv.length}) --`);
  for (const [id, e] of fnEv.slice(0, 12)) console.log(`   ${id}: ${e}`);
}
