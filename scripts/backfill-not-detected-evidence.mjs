import Database from "better-sqlite3";

// One-time backfill: single-label aggregate (production-mirror) runs dropped the
// evidence for NOT_DETECTED predictions. The target label is absent from the
// model's `detections` list, so it has no reasoning of its own, and the old code
// only backfilled evidence from a designated `is_support` member — which no
// historical run ever configured. As a result 358 NOT_DETECTED rows stored a
// populated raw response but a null `evidence`.
//
// This recomputes `evidence` from each row's stored `raw_response`, mirroring the
// going-forward `deriveNegativeEvidence` fallback: surface every emitted
// detection's reasoning as the contrary evidence ("label: reasoning", one per
// line). Rows whose response listed no detections (or no reasoning) are left
// null — there is genuinely nothing to show.
//
// Scope (guarantees we never touch other flows):
//   - predicted_decision = 'NOT_DETECTED'
//   - evidence IS NULL OR evidence = ''        (don't overwrite existing evidence)
//   - detection_label IS NULL                  (single-label aggregate; multi-label
//                                               rows already store per-label evidence)
//   - parse_ok = 1                             (only well-formed responses)
//   - raw_response contains a "detections" array (the aggregate schema)
//
// Idempotent: only rows with empty evidence are selected, so re-running is a no-op
// for rows already backfilled. Default is a dry run; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const db = new Database("./data/vlm-eval.db");

/**
 * Mirror of deriveNegativeEvidence's general fallback (src/lib/inference/aggregate.ts).
 * No historical run used is_support, so the support-member branch is unreachable
 * here and intentionally omitted.
 */
function deriveNegativeEvidence(siblings) {
  const contrary = siblings
    .filter((s) => s.reasoning && s.reasoning.trim())
    .map((s) => `${s.label}: ${s.reasoning}`);
  return contrary.length ? contrary.join("\n") : null;
}

const candidates = db
  .prepare(
    `SELECT prediction_id, raw_response
     FROM predictions
     WHERE predicted_decision = 'NOT_DETECTED'
       AND (evidence IS NULL OR evidence = '')
       AND detection_label IS NULL
       AND parse_ok = 1
       AND raw_response LIKE '%"detections"%'`
  )
  .all();

const update = db.prepare(`UPDATE predictions SET evidence = ? WHERE prediction_id = ?`);

let backfilled = 0;
let noReasoning = 0;
let unparsable = 0;

const run = db.transaction(() => {
  for (const p of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(p.raw_response);
    } catch {
      unparsable++;
      continue;
    }
    const detections = Array.isArray(parsed?.detections) ? parsed.detections : [];
    // Target is absent on a NOT_DETECTED outcome, so every detection is a sibling.
    const siblings = detections.map((d) => ({
      label: String(d?.detection ?? ""),
      reasoning: String(d?.reasoning ?? ""),
    }));
    const evidence = deriveNegativeEvidence(siblings);
    if (!evidence) {
      noReasoning++;
      continue;
    }
    if (APPLY) update.run(evidence, p.prediction_id);
    backfilled++;
  }
});
run();

console.log(`Mode: ${APPLY ? "APPLY (database updated)" : "DRY RUN (no changes written)"}`);
console.log(`Inspected ${candidates.length} single-label aggregate NOT_DETECTED rows with empty evidence.`);
console.log(`  Backfilled evidence:        ${backfilled}`);
console.log(`  Left null (no reasoning):   ${noReasoning}`);
console.log(`  Left null (unparsable raw): ${unparsable}`);
if (!APPLY) console.log(`\nRe-run with --apply to write these ${backfilled} updates.`);

db.close();
