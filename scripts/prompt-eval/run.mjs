// Offline prompt-evaluation harness for the multi-label cooking-line detections.
//
// Runs a candidate prompt (5 per-label descriptions) against a dataset split via
// the same @google/genai call the production aggregate path uses (temperature 0,
// responseSchema, thinkingConfig) and scores per-label Precision/Recall/F1
// against dataset_items.ground_truth_labels. Read-only on the DB; writes nothing
// to the runs table.
//
// Usage:
//   node scripts/prompt-eval/run.mjs --prompt=prompts/baseline.json [options]
//
// Options:
//   --prompt=FILE        Base prompt: JSON array of { label, description }. (required)
//   --override=FILE      Optional single { label, description } that replaces that
//                        label in the base prompt (for per-label optimization).
//   --dataset=PREFIX     dataset_id prefix. Default aa6b9fb8 (TRAIN).
//   --images=FILE        Optional newline-delimited image_id list to restrict to.
//   --limit=N            Optional cap on number of images.
//   --thinking=LEVEL     minimal|low|medium|high. Default medium.
//   --model=NAME         Default gemini-3.5-flash.
//   --concurrency=N      Default 10.
//   --out=FILE           Write raw per-image predictions JSON. Default ./_preds.json
//   --baselineRun=PREFIX Optional run_id prefix; prints stored baseline P/R/F1 on
//                        the SAME images for side-by-side comparison (free).
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.split('=');
  return [k.replace(/^--/, ''), v.join('=')];
}));

function resolveInput(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.resolve(__dirname, p);
}

const DB_PATH = path.join(REPO_ROOT, 'data', 'vlm-eval.db');
const promptFile = resolveInput(args.prompt || 'prompts/baseline.json');
const overrideFile = args.override ? resolveInput(args.override) : null;
const datasetPrefix = args.dataset || 'aa6b9fb8';
const limit = args.limit ? parseInt(args.limit, 10) : 0;
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 10;
const thinkingArg = (args.thinking || 'medium').toUpperCase();
const model = args.model || 'gemini-3.5-flash';
const outFile = resolveInput(args.out || './_preds.json');
const imagesFile = args.images ? resolveInput(args.images) : null;
const baselineRun = args.baselineRun || null;

// ---- api key ----
const envText = fs.readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8');
const keyMatch = envText.match(/^GEMINI_API_KEY=(.+)$/m);
const API_KEY = (keyMatch ? keyMatch[1].trim() : process.env.GEMINI_API_KEY) || '';
if (!API_KEY) {
  console.error('No GEMINI_API_KEY found in .env.local or environment.');
  process.exit(1);
}

// ---- build prompt ----
let members = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
if (overrideFile) {
  const ov = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));
  const list = Array.isArray(ov) ? ov : [ov];
  for (const o of list) {
    const i = members.findIndex((m) => m.label === o.label);
    if (i < 0) { console.error(`Override label not in base prompt: ${o.label}`); process.exit(1); }
    members[i] = { label: o.label, description: o.description };
  }
}
const labels = members.map((m) => m.label);
const basePrompt = members
  .map((m, i) => `${i + 1}. When you see this description:\n${m.description}\n\napply this label: ${m.label}`)
  .join('\n\n');
const prompt = `${basePrompt}\n\nFor EACH detection listed above, return one entry containing its exact label, a boolean "present" indicating whether it is present in the image, and concise "reasoning" explaining your decision. Always include reasoning, even when "present" is false.`;

const responseSchema = {
  type: Type.OBJECT,
  required: ['detections'],
  properties: {
    detections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['detection', 'present', 'reasoning'],
        propertyOrdering: ['detection', 'present', 'reasoning'],
        properties: {
          detection: { type: Type.STRING, enum: labels },
          present: { type: Type.BOOLEAN },
          reasoning: { type: Type.STRING },
        },
      },
    },
  },
};

// ---- load items ----
const db = new Database(DB_PATH, { readonly: true });
const dsRow = db.prepare('SELECT dataset_id FROM datasets WHERE dataset_id LIKE ?').get(datasetPrefix + '%');
if (!dsRow) { console.error(`No dataset matching prefix ${datasetPrefix}`); process.exit(1); }
const dsId = dsRow.dataset_id;
let items = db.prepare('SELECT image_id, image_uri, ground_truth_labels FROM dataset_items WHERE dataset_id=?').all(dsId);
if (imagesFile) {
  const set = new Set(fs.readFileSync(imagesFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
  items = items.filter((it) => set.has(it.image_id));
}
if (limit) items = items.slice(0, limit);
console.error(`Dataset ${dsId.slice(0, 8)}: ${items.length} images | model=${model} | thinking=${thinkingArg} | concurrency=${concurrency}`);
if (overrideFile) console.error(`Override: ${path.basename(overrideFile)} on label(s) ${(Array.isArray(JSON.parse(fs.readFileSync(overrideFile,'utf8')))?JSON.parse(fs.readFileSync(overrideFile,'utf8')):[JSON.parse(fs.readFileSync(overrideFile,'utf8'))]).map(o=>o.label).join(', ')}`);

const ai = new GoogleGenAI({ apiKey: API_KEY });
const TIMEOUT = 90_000;

async function fetchImage(uri) {
  if (uri.startsWith('/')) {
    const p = path.join(REPO_ROOT, 'public', uri);
    const data = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { mimeType: mime, data: data.toString('base64') };
  }
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'image/jpeg';
  return { mimeType: ct.split(';')[0], data: buf.toString('base64') };
}

async function infer(item) {
  let img;
  try { img = await fetchImage(item.image_uri); }
  catch (e) { return { image_id: item.image_id, error: 'img:' + e.message, verdicts: {} }; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ text: prompt }, { inlineData: { mimeType: img.mimeType, data: img.data } }],
        config: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema,
          abortSignal: controller.signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingArg] ?? ThinkingLevel.MEDIUM },
        },
      });
      clearTimeout(timer);
      const parsed = JSON.parse(response.text ?? '');
      const verdicts = {};
      const reasoning = {};
      for (const d of parsed.detections || []) {
        if (d && typeof d.detection === 'string') { verdicts[d.detection] = d.present === true; reasoning[d.detection] = d.reasoning; }
      }
      return { image_id: item.image_id, verdicts, reasoning };
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 3) return { image_id: item.image_id, error: e.message, verdicts: {} };
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
}

const results = [];
let idx = 0, done = 0, errs = 0;
async function worker() {
  while (idx < items.length) {
    const i = idx++;
    const r = await infer(items[i]);
    if (r.error) errs++;
    results.push(r);
    done++;
    if (done % 25 === 0) console.error(`  ${done}/${items.length} (errs=${errs})`);
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
console.error(`Done ${done} in ${((Date.now() - t0) / 1000).toFixed(0)}s, errs=${errs}`);

// ---- score ----
const gtById = {};
for (const it of items) {
  let arr = []; try { arr = JSON.parse(it.ground_truth_labels || '[]'); } catch {}
  gtById[it.image_id] = new Set(arr);
}
function score(predByImage, label) {
  const s = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const it of items) {
    const pred = predByImage(it.image_id, label);
    if (pred === null) continue;
    const truth = gtById[it.image_id].has(label);
    if (pred && truth) s.tp++; else if (pred && !truth) s.fp++; else if (!pred && truth) s.fn++; else s.tn++;
  }
  const p = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 0;
  const r = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 0;
  const f1 = p + r ? (2 * p * r) / (p + r) : 0;
  return { ...s, p, r, f1 };
}
const resultById = Object.fromEntries(results.map((r) => [r.image_id, r]));
const candPred = (id, label) => {
  const r = resultById[id];
  if (!r || r.error) return null;
  return r.verdicts[label] === true;
};

// optional stored baseline on the SAME images
let basePred = null;
if (baselineRun) {
  const runId = db.prepare('SELECT run_id FROM runs WHERE run_id LIKE ?').get(baselineRun + '%')?.run_id;
  if (runId) {
    const rows = db.prepare('SELECT image_id, detection_label, predicted_decision FROM predictions WHERE run_id=?').all(runId);
    const map = {};
    for (const row of rows) { (map[row.image_id] ||= {})[row.detection_label] = row.predicted_decision === 'DETECTED'; }
    basePred = (id, label) => (map[id] && label in map[id] ? map[id][label] : null);
  }
}

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\n==== ${path.basename(promptFile)}${overrideFile ? ' + ' + path.basename(overrideFile) : ''} on ${datasetPrefix} (${results.length} imgs, ${errs} errs) ====`);
const pad = (x) => String(x).padEnd(26);
let macro = 0;
for (const l of labels) {
  const c = score(candPred, l);
  macro += c.f1;
  let line = `${c.f1 >= 0.8 ? 'OK ' : '   '}${pad(l)} P=${c.p.toFixed(2)} R=${c.r.toFixed(2)} F1=${c.f1.toFixed(2)}  (TP=${c.tp} FP=${c.fp} FN=${c.fn} TN=${c.tn})`;
  if (basePred) {
    const b = score(basePred, l);
    const d = c.f1 - b.f1;
    line += `   | base F1=${b.f1.toFixed(2)}  Δ=${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  }
  console.log(line);
}
console.log(`macro-F1 = ${(macro / labels.length).toFixed(3)}`);
