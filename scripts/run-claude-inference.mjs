import Database from "better-sqlite3";
import crypto from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY env var required");
  process.exit(1);
}

const DB_PATH = "./data/vlm-eval.db";
const PROMPT_VERSION_ID = "ceeae772-c512-448d-b9e7-1e465a311c8c";
const DATASET_ID = "37e10cdc-a926-4b29-8837-818cd59e277b";
const DETECTION_ID = "5ca91bd2-be86-4933-9ae3-996db97b1765";
const DETECTION_CODE = "CORROSION_MAJOR";
const MODEL = "claude-opus-4-6";
const MAX_CONCURRENCY = 4;

const db = new Database(DB_PATH);

const prompt = db.prepare("SELECT * FROM prompt_versions WHERE prompt_version_id = ?").get(PROMPT_VERSION_ID);
if (!prompt) { console.error("Prompt not found"); process.exit(1); }

const items = db.prepare("SELECT image_id, image_uri, ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ?").all(DATASET_ID);
console.log(`Dataset has ${items.length} images. Starting inference with ${MODEL}...`);

const runId = crypto.randomUUID();
const now = new Date().toISOString();

const promptSnapshot = JSON.stringify({
  system_prompt: prompt.system_prompt,
  user_prompt_template: prompt.user_prompt_template,
  prompt_structure: prompt.prompt_structure,
});
const decodingParams = JSON.stringify({
  model: MODEL,
  temperature: prompt.temperature,
  top_p: prompt.top_p,
  max_output_tokens: prompt.max_output_tokens,
});
const datasetHash = crypto.createHash("md5").update(items.map(i => i.image_id).join(",")).digest("hex");

db.prepare(`INSERT INTO runs (run_id, detection_id, prompt_version_id, prompt_snapshot, decoding_params, dataset_id, dataset_hash, split_type, model_used, status, total_images, processed_images, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, 'CUSTOM', ?, 'running', ?, 0, ?)`).run(
  runId, DETECTION_ID, PROMPT_VERSION_ID, promptSnapshot, decodingParams, DATASET_ID, datasetHash, MODEL, items.length, now
);
console.log(`Created run: ${runId}`);

const insertPrediction = db.prepare(`INSERT INTO predictions (prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence, evidence, parse_ok, parse_error_reason, parse_fix_suggestion, inference_runtime_ms, parse_retry_count, error_tag)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const updateProcessed = db.prepare("UPDATE runs SET processed_images = ? WHERE run_id = ?");

const userPromptCompiled = prompt.user_prompt_template.replace(/\{\{DETECTION_CODE\}\}/g, DETECTION_CODE);

async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

async function callClaude(systemPrompt, imageB64, userText) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: prompt.max_output_tokens,
      temperature: prompt.temperature,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } },
          { type: "text", text: userText },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    const err = new Error(`API ${resp.status}: ${body.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  return await resp.json();
}

async function runInference(item) {
  const start = Date.now();
  let retryCount = 0;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const imageB64 = await fetchImageAsBase64(item.image_uri);
      const response = await callClaude(prompt.system_prompt, imageB64, userPromptCompiled);
      const runtimeMs = Date.now() - start;

      const rawText = response.content?.[0]?.text || "";
      let parsed = null;
      let parseOk = false;
      let parseError = null;

      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          if (parsed.decision === "DETECTED" || parsed.decision === "NOT_DETECTED") {
            parseOk = true;
          } else {
            parseError = "Missing or invalid decision field";
          }
        } else {
          parseError = "No JSON object found in response";
        }
      } catch (e) {
        parseError = `JSON parse error: ${e.message}`;
      }

      if (!parseOk && attempt < maxRetries) {
        retryCount++;
        continue;
      }

      return {
        imageId: item.image_id,
        imageUri: item.image_uri,
        groundTruthLabel: item.ground_truth_label,
        decision: parsed?.decision || null,
        confidence: parsed?.confidence ?? 0,
        evidence: parsed?.evidence || rawText.slice(0, 200),
        parseOk: parseOk ? 1 : 0,
        parseError,
        runtimeMs,
        retryCount,
      };
    } catch (err) {
      const runtimeMs = Date.now() - start;
      if (attempt < maxRetries && (err.status === 429 || err.status >= 500)) {
        retryCount++;
        const wait = err.status === 429 ? 15000 : 5000;
        await new Promise((r) => setTimeout(r, wait * (attempt + 1)));
        continue;
      }
      return {
        imageId: item.image_id,
        imageUri: item.image_uri,
        groundTruthLabel: item.ground_truth_label,
        decision: null,
        confidence: 0,
        evidence: null,
        parseOk: 0,
        parseError: `API error: ${err.message}`,
        runtimeMs,
        retryCount,
      };
    }
  }
}

async function processWithConcurrency(items, concurrency) {
  let processed = 0;
  let idx = 0;
  const globalStart = Date.now();

  async function worker() {
    while (idx < items.length) {
      const currentIdx = idx++;
      const item = items[currentIdx];
      const result = await runInference(item);

      insertPrediction.run(
        crypto.randomUUID(),
        runId,
        result.imageId,
        result.imageUri,
        result.groundTruthLabel || null,
        result.decision,
        result.confidence,
        result.evidence,
        result.parseOk,
        result.parseError,
        null,
        result.runtimeMs,
        result.retryCount,
        null
      );

      processed++;
      if (processed % 10 === 0 || processed === items.length) {
        updateProcessed.run(processed, runId);
        const elapsed = ((Date.now() - globalStart) / 1000).toFixed(0);
        const rate = (processed / (elapsed || 1)).toFixed(2);
        console.log(`  [${elapsed}s] ${processed}/${items.length} (${rate} img/s) | Last: ${result.imageId} → ${result.decision || "PARSE_FAIL"}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  updateProcessed.run(processed, runId);
}

console.log(`Running inference on ${items.length} images with concurrency=${MAX_CONCURRENCY}...`);
await processWithConcurrency(items, MAX_CONCURRENCY);

// Compute metrics
const predictions = db.prepare(`
  SELECT p.predicted_decision, di.ground_truth_label, di.segment_tags
  FROM predictions p
  JOIN dataset_items di ON di.image_id = p.image_id AND di.dataset_id = ?
  WHERE p.run_id = ?
`).all(DATASET_ID, runId);

let tp = 0, fp = 0, fn = 0, tn = 0, parseFailures = 0;
for (const p of predictions) {
  if (!p.predicted_decision) { parseFailures++; continue; }
  const gt = p.ground_truth_label;
  if (!gt) continue;
  if (gt === "DETECTED" && p.predicted_decision === "DETECTED") tp++;
  else if (gt === "NOT_DETECTED" && p.predicted_decision === "DETECTED") fp++;
  else if (gt === "DETECTED" && p.predicted_decision === "NOT_DETECTED") fn++;
  else if (gt === "NOT_DETECTED" && p.predicted_decision === "NOT_DETECTED") tn++;
}

const total = tp + fp + fn + tn;
const accuracy = total > 0 ? (tp + tn) / total : 0;
const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
const prevalence = total > 0 ? (tp + fn) / total : 0;
const parseFailureRate = items.length > 0 ? parseFailures / items.length : 0;

const metrics = {
  accuracy: +accuracy.toFixed(4),
  precision: +precision.toFixed(4),
  recall: +recall.toFixed(4),
  f1: +f1.toFixed(4),
  prevalence: +prevalence.toFixed(4),
  parse_failure_rate: +parseFailureRate.toFixed(4),
  tp, fp, fn, tn,
  total_with_gt: total,
  total_images: items.length,
  parse_failures: parseFailures,
};

db.prepare("UPDATE runs SET status = 'completed', metrics_summary = ? WHERE run_id = ?").run(
  JSON.stringify(metrics), runId
);

console.log("\n=== RUN COMPLETE ===");
console.log(`Run ID: ${runId}`);
console.log(`Model: ${MODEL}`);
console.log(`Images: ${items.length}`);
console.log(`Metrics (on labeled images only):`);
console.log(`  Accuracy:  ${(metrics.accuracy * 100).toFixed(1)}%`);
console.log(`  Precision: ${(metrics.precision * 100).toFixed(1)}%`);
console.log(`  Recall:    ${(metrics.recall * 100).toFixed(1)}%`);
console.log(`  F1:        ${(metrics.f1 * 100).toFixed(1)}%`);
console.log(`  TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
console.log(`  Parse failures: ${parseFailures}`);

db.close();
