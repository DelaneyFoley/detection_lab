import Database from "better-sqlite3";

// Resync prompt_structure.user_prompt_addendum to match what is actually baked
// into user_prompt_template. Inference reads the template; the edit UI reads the
// structured copy. AI iteration used to update only the template, leaving a stale
// structured addendum — so edit mode showed a different prompt than what runs,
// and re-saving from edit mode would overwrite the real prompt. This makes them
// match (structured copy = the running template's addendum).

const ADDENDUM_MARKER = "Detection-Specific Addendum:";

function splitAddendum(template) {
  const full = String(template || "");
  const idx = full.indexOf(ADDENDUM_MARKER);
  if (idx < 0) return "";
  return full.slice(idx + ADDENDUM_MARKER.length).trim();
}

const db = new Database("./data/vlm-eval.db");
const rows = db
  .prepare("SELECT prompt_version_id, version_label, user_prompt_template, prompt_structure FROM prompt_versions")
  .all();

const update = db.prepare("UPDATE prompt_versions SET prompt_structure = ? WHERE prompt_version_id = ?");
let fixed = 0;
let checked = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    checked++;
    let structure = {};
    try {
      structure = JSON.parse(r.prompt_structure || "{}");
    } catch {
      continue;
    }
    const templateAddendum = splitAddendum(r.user_prompt_template);
    const structAddendum = String(structure.user_prompt_addendum || "");
    if (structAddendum.trim() === templateAddendum.trim()) continue; // already in sync
    structure.user_prompt_addendum = templateAddendum;
    update.run(JSON.stringify(structure), r.prompt_version_id);
    fixed++;
    console.log(
      `Resynced ${r.version_label.padEnd(18)} (${r.prompt_version_id.slice(0, 8)}) — struct addendum ${structAddendum.length} -> ${templateAddendum.length} chars`
    );
  }
});
tx();

console.log(`\nChecked ${checked} versions; resynced ${fixed} that had a stale structured addendum.`);
db.close();
