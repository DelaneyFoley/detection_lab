// One-time migration: remove the redundant inline JSON schema block and any
// "Return raw JSON only…" closing lines from stored prompt data. The strict JSON
// contract (STRICT_JSON_CONTRACT) is auto-appended at inference time, so these
// duplicated the contract. Makes STRICT_JSON_CONTRACT the single source of truth.
//
// Safe to re-run (idempotent). Backs up the DB before writing.
//
//   node scripts/strip-redundant-json-contract.mjs [--dry]

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DRY = process.argv.includes("--dry");
const dbPath = path.join(process.cwd(), "data", "vlm-eval.db");

// Remove "Return ONLY this JSON:{ … }". Handles both the multi-line form (block
// ends on a line that is just "}") and the single-line minified form.
function stripJsonBlock(s) {
  return s
    .replace(/\n*Return ONLY this JSON:\s*\{[\s\S]*?\n\}[ \t]*/gi, "")
    .replace(/\n*Return ONLY this JSON:\s*\{[^\n]*\}[ \t]*/gi, "");
}

// Remove any "Return raw JSON only …" sentence(s), which all end with "schema exactly."
function stripRawJsonOnly(s) {
  return s.replace(/\n*Return raw JSON only[\s\S]*?schema exactly\.?/gi, "");
}

function normalize(s) {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clean(s) {
  if (typeof s !== "string") return s;
  return normalize(stripRawJsonOnly(stripJsonBlock(s)));
}

if (!fs.existsSync(dbPath)) {
  console.error(`DB not found at ${dbPath}`);
  process.exit(1);
}

if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${dbPath}.bak-${stamp}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`Backup written: ${backup}`);
}

const db = new Database(dbPath);

let versionsChanged = 0;
const updateStmt = db.prepare(
  "UPDATE prompt_versions SET user_prompt_template = ?, prompt_structure = ? WHERE prompt_version_id = ?"
);

const applyVersions = db.transaction((rows) => {
  for (const r of rows) {
    const newTemplate = clean(r.user_prompt_template || "");

    let structure;
    try {
      structure = JSON.parse(r.prompt_structure || "{}");
    } catch {
      structure = null;
    }
    let structureChanged = false;
    if (structure && typeof structure === "object") {
      if (typeof structure.user_prompt_addendum === "string") {
        const cleaned = clean(structure.user_prompt_addendum);
        if (cleaned !== structure.user_prompt_addendum) {
          structure.user_prompt_addendum = cleaned;
          structureChanged = true;
        }
      }
    }

    const templateChanged = newTemplate !== (r.user_prompt_template || "");
    if (!templateChanged && !structureChanged) continue;

    versionsChanged += 1;
    if (!DRY) {
      updateStmt.run(
        newTemplate,
        structure ? JSON.stringify(structure) : r.prompt_structure,
        r.prompt_version_id
      );
    }
  }
});

const versions = db
  .prepare("SELECT prompt_version_id, user_prompt_template, prompt_structure FROM prompt_versions")
  .all();
applyVersions(versions);

// Category template overrides stored in app_settings.
let settingsChanged = 0;
const settingKeys = ["hazard_identification_user_prompt", "incorrect_capture_user_prompt"];
const getSetting = db.prepare("SELECT value FROM app_settings WHERE key = ?");
const setSetting = db.prepare("UPDATE app_settings SET value = ? WHERE key = ?");
for (const key of settingKeys) {
  const row = getSetting.get(key);
  if (!row || typeof row.value !== "string") continue;
  const cleaned = clean(row.value);
  if (cleaned !== row.value) {
    settingsChanged += 1;
    if (!DRY) setSetting.run(cleaned, key);
  }
}

console.log(`${DRY ? "[dry-run] would update" : "updated"} ${versionsChanged}/${versions.length} prompt versions`);
console.log(`${DRY ? "[dry-run] would update" : "updated"} ${settingsChanged}/${settingKeys.length} app_settings templates`);
db.close();
