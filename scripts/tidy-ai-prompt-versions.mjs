/**
 * Tidy up AI prompt-iteration versions.
 *
 * Earlier iteration runs (before batch-numbered labels) created versions with
 * COLLIDING labels like `V1-ai-r1 … V1-ai-r4` on every re-run, so the Prompt
 * Versions list shows indistinguishable duplicates. This script reconstructs
 * each iteration RUN and relabels them with distinct batch tags
 * (`V1-ai-r1`, `V1-ai-b2-r1`, `V1-ai-b3-r1`, …) so the list is tidy — WITHOUT
 * deleting anything.
 *
 * Usage:
 *   node scripts/tidy-ai-prompt-versions.mjs            # dry run (prints plan)
 *   node scripts/tidy-ai-prompt-versions.mjs --apply    # relabel duplicates
 *   node scripts/tidy-ai-prompt-versions.mjs --apply --prune-orphans
 *        # also delete AI-iteration versions that have NO runs, are not the
 *        # detection's approved prompt, and are not a source for another
 *        # version (safe, genuinely-unused rows only).
 */
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const PRUNE = process.argv.includes("--prune-orphans");

const db = new Database("./data/vlm-eval.db");

// Matches AI-iteration labels: <root>-ai[-b<batch>][-r<round>]
const AI_LABEL_RE = /^(.*?)-ai(?:-b(\d+))?(?:-r(\d+))?$/i;

function parseAiLabel(label) {
  const m = AI_LABEL_RE.exec(String(label || "").trim());
  if (!m) return null;
  return {
    root: m[1] || "prompt",
    batch: m[2] ? Number(m[2]) : 1,
    round: m[3] ? Number(m[3]) : null,
  };
}

function buildLabel(root, batch, round) {
  const batchTag = batch && batch > 1 ? `-b${batch}` : "";
  const roundTag = round && round > 0 ? `-r${round}` : "";
  return `${root}-ai${batchTag}${roundTag}`;
}

const rows = db
  .prepare(
    `SELECT prompt_version_id, detection_id, version_label, source_prompt_version_id, created_at
     FROM prompt_versions
     ORDER BY detection_id, created_at ASC, rowid ASC`
  )
  .all();

// Group AI-iteration versions by (detection, root label). Within a family,
// each new iteration run restarts at a lower/equal round number, which lets us
// assign an incrementing batch per run.
const families = new Map();
for (const r of rows) {
  const parsed = parseAiLabel(r.version_label);
  if (!parsed) continue;
  const key = `${r.detection_id}::${parsed.root}`;
  if (!families.has(key)) families.set(key, []);
  families.get(key).push({ ...r, parsed });
}

const changes = [];
for (const [, versions] of families) {
  let batch = 0;
  let prevRound = null;
  const usedInFamily = new Set();
  for (const v of versions) {
    const round = v.parsed.round ?? 0;
    if (prevRound === null || round <= prevRound) batch += 1; // new run started
    prevRound = round;

    let next = buildLabel(v.parsed.root, batch, v.parsed.round);
    // Guard against any residual collision within the family.
    let bump = batch;
    while (usedInFamily.has(next)) {
      bump += 1;
      next = buildLabel(v.parsed.root, bump, v.parsed.round);
    }
    usedInFamily.add(next);

    if (next !== v.version_label) {
      changes.push({ id: v.prompt_version_id, from: v.version_label, to: next });
    }
  }
}

console.log(`Scanned ${rows.length} prompt versions; found ${families.size} AI-iteration family group(s).`);
if (changes.length === 0) {
  console.log("No duplicate AI-iteration labels to relabel — already tidy. ✅");
} else {
  console.log(`\nRelabel plan (${changes.length}):`);
  for (const c of changes) console.log(`  ${c.from.padEnd(18)} →  ${c.to}   [${c.id.slice(0, 8)}]`);
}

// Optional: identify genuinely-unused AI versions safe to delete.
const approvedIds = new Set(
  db.prepare(`SELECT approved_prompt_version FROM detections WHERE approved_prompt_version IS NOT NULL`).all().map((r) => r.approved_prompt_version)
);
const sourceIds = new Set(
  db.prepare(`SELECT DISTINCT source_prompt_version_id FROM prompt_versions WHERE source_prompt_version_id IS NOT NULL`).all().map((r) => r.source_prompt_version_id)
);
const runCount = db.prepare(`SELECT COUNT(*) as c FROM runs WHERE prompt_version_id = ?`);
const orphans = [];
for (const r of rows) {
  if (!parseAiLabel(r.version_label)) continue;
  if (approvedIds.has(r.prompt_version_id)) continue;
  if (sourceIds.has(r.prompt_version_id)) continue;
  if (runCount.get(r.prompt_version_id).c > 0) continue;
  orphans.push(r);
}
if (orphans.length > 0) {
  console.log(`\nGenuinely-unused AI versions (no runs, not approved, not a source) — ${orphans.length}:`);
  for (const o of orphans) console.log(`  ${o.version_label.padEnd(18)} [${o.prompt_version_id.slice(0, 8)}]`);
  if (!PRUNE) console.log("  (pass --prune-orphans to delete these)");
}

if (!APPLY) {
  console.log("\nDry run — no changes written. Re-run with --apply to relabel.");
  db.close();
  process.exit(0);
}

const relabel = db.prepare(`UPDATE prompt_versions SET version_label = ? WHERE prompt_version_id = ?`);
const delNotes = db.prepare(`DELETE FROM version_note_entries WHERE prompt_version_id = ?`);
const delVersion = db.prepare(`DELETE FROM prompt_versions WHERE prompt_version_id = ?`);

const tx = db.transaction(() => {
  for (const c of changes) relabel.run(c.to, c.id);
  if (PRUNE) {
    for (const o of orphans) {
      delNotes.run(o.prompt_version_id);
      delVersion.run(o.prompt_version_id);
    }
  }
});
tx();

console.log(`\nApplied: relabelled ${changes.length} version(s)${PRUNE ? `, pruned ${orphans.length} unused version(s)` : ""}. ✅`);
db.close();
