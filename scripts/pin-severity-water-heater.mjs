import Database from "better-sqlite3";

// Move the reusable "Severity scale + general spec" out of the editable addendum
// and into prompt_structure.fixed_guidance so AI prompt iteration can never strip
// it. Targets the human-authored Water Heater prompt versions that still contain
// the original severity scale and have not already been pinned.

const db = new Database("./data/vlm-eval.db");

const DETECTION_ID = "69bd95cb-f286-4693-9903-56c1bffca4ca"; // MAJOR_CORROSION_WATER_HEATER
const MARKER = "\nSeverity\n"; // the bare "Severity" section header line

const rows = db
  .prepare(
    `SELECT prompt_version_id, version_label, user_prompt_template, prompt_structure
     FROM prompt_versions
     WHERE detection_id = ?
       AND user_prompt_template LIKE '%Severity 3 (DETECTED)%'`
  )
  .all(DETECTION_ID);

const update = db.prepare(
  "UPDATE prompt_versions SET user_prompt_template = ?, prompt_structure = ? WHERE prompt_version_id = ?"
);

let pinned = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    let structure = {};
    try {
      structure = JSON.parse(r.prompt_structure || "{}");
    } catch {
      structure = {};
    }
    if (structure.fixed_guidance && String(structure.fixed_guidance).trim()) {
      continue; // already pinned
    }
    const template = String(r.user_prompt_template || "");
    const mi = template.indexOf(MARKER);
    if (mi < 0) continue;

    const head = template.slice(0, mi).replace(/\s+$/, "");
    const fixed = template.slice(mi + 1).trim(); // starts at "Severity\n..."

    structure.fixed_guidance = fixed;
    pinned += update.run(head, JSON.stringify(structure), r.prompt_version_id).changes;
    console.log(`Pinned ${r.version_label} (${r.prompt_version_id.slice(0, 8)}) — fixed_guidance ${fixed.length} chars, addendum trimmed to ${head.length}.`);
  }
});
tx();

console.log(`\nInspected ${rows.length} version(s); pinned severity scale on ${pinned}.`);
db.close();
