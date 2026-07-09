import Database from "better-sqlite3";

// Backfill: earlier prompt-iteration runs tagged every parse failure as
// INFERENCE_CALL_FAILED, which hides genuine schema failures from the HIL
// "Parse Failures" filter and the Parse Fail Rate metric. Re-tag rows that are
// actually schema violations (not real API/inference errors) as SCHEMA_VIOLATION.

const db = new Database("./data/vlm-eval.db");

const candidates = db
  .prepare(
    `SELECT prediction_id, raw_response, parse_error_reason
     FROM predictions
     WHERE error_tag = 'INFERENCE_CALL_FAILED' AND parse_ok = 0`
  )
  .all();

const update = db.prepare(
  `UPDATE predictions SET error_tag = 'SCHEMA_VIOLATION' WHERE prediction_id = ?`
);

const isRealApiFailure = (raw, reason) =>
  String(raw || "").startsWith("ERROR:") ||
  String(reason || "").startsWith("Model/API error:");

let retagged = 0;
const tx = db.transaction(() => {
  for (const p of candidates) {
    if (!isRealApiFailure(p.raw_response, p.parse_error_reason)) {
      retagged += update.run(p.prediction_id).changes;
    }
  }
});
tx();

console.log(`Inspected ${candidates.length} INFERENCE_CALL_FAILED parse failures.`);
console.log(`Re-tagged ${retagged} genuine schema failures as SCHEMA_VIOLATION.`);

db.close();
