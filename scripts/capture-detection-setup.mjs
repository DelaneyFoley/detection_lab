import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots", "detection-setup");
const BASE_URL = "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

fs.mkdirSync(OUT_DIR, { recursive: true });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, tag, matcher) {
  const clicked = await page.evaluate(
    (tag, matcherStr) => {
      const re = new RegExp(matcherStr, "i");
      const els = [...document.querySelectorAll(tag)];
      // Prefer the smallest element that matches — avoid hitting large wrapping containers.
      const visible = els.filter((el) => el.offsetParent !== null && re.test(el.textContent || ""));
      // Sort by textContent length ascending so we pick the tightest match.
      visible.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
      const btn = visible[0];
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    tag,
    matcher,
  );
  return clicked;
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const shot = async (name) => {
    const filePath = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`  ✓ ${name}.png`);
  };

  console.log("→ Loading app...");
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(1500);

  // ─── 01. Landing (before any detection) ────────────────────────────
  console.log("01 landing");
  await shot("01_landing");

  // ─── 02. View mode with detection selected ─────────────────────────
  console.log("02 select a detection via header");
  // Find the "Active Detection" select and its target option value.
  const targetOption = await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")].filter((s) => s.offsetParent !== null);
    const detSel = selects.find((sel) =>
      [...sel.options].some((o) => /major|corrosion|toilet|water|sink|prompt test/i.test(o.textContent || "")),
    );
    if (!detSel) return null;
    // Prefer a water-heater or toilet detection (rich prompt versions)
    let opt = [...detSel.options].find((o) => /water heater/i.test(o.textContent || ""));
    if (!opt) opt = [...detSel.options].find((o) => /toilet/i.test(o.textContent || ""));
    if (!opt) opt = [...detSel.options].find((o) => o.value);
    if (!opt) return null;
    // Give select a stable data attr so puppeteer can target it
    detSel.setAttribute("data-e2e", "active-detection-select");
    return opt.value;
  });

  if (targetOption) {
    await page.select('select[data-e2e="active-detection-select"]', targetOption);
    await delay(3000); // give related data (prompts, runs) time to load
  } else {
    console.log("  (warn: could not find Active Detection select)");
  }
  await shot("02_view_mode_detection_selected");

  // ─── 03. Prompt version expanded ───────────────────────────────────
  console.log("03 expand a prompt group");
  // The group rows are clickable; find the first prompt group header row and click.
  const expanded = await page.evaluate(() => {
    // Look for chevron/caret buttons or clickable group rows in the Prompt Versions section
    const headings = [...document.querySelectorAll("h2, h3, h4")].filter((h) =>
      /prompt versions/i.test(h.textContent || ""),
    );
    if (!headings.length) return false;
    const section = headings[0].closest("div");
    if (!section) return false;
    // Find the first clickable row/button under the section
    const rows = [
      ...section.parentElement.querySelectorAll('[role="button"], button, [class*="cursor-pointer"]'),
    ].filter((el) => el.offsetParent !== null);
    // Heuristic: click the first row that contains version count-like text or is inside a grid
    for (const row of rows) {
      if (/\d+\s*(version|runs?)/i.test(row.textContent || "")) {
        row.click();
        return true;
      }
    }
    // Fallback: click first row with a chevron
    const chevron = section.parentElement.querySelector("svg.lucide-chevron-right, svg.lucide-chevron-down");
    if (chevron) {
      const parent = chevron.closest("button, [role='button'], div");
      if (parent) {
        parent.click();
        return true;
      }
    }
    return false;
  });
  await delay(1500);
  if (expanded) await shot("03_prompt_group_expanded");
  else console.log("  (skip: couldn't find prompt group to expand)");

  // ─── 04. Prompt form open (New version) ────────────────────────────
  console.log("04 open new-version prompt form");
  const openedForm = await clickByText(page, "button", "^\\s*New version\\s*$");
  await delay(1500);
  if (openedForm) await shot("04_prompt_form_new_version");
  else console.log("  (skip: couldn't find New version button)");

  // Close prompt form via Cancel
  await clickByText(page, "button", "^\\s*Cancel\\s*$");
  await delay(800);

  // ─── 05. Edit detection mode ───────────────────────────────────────
  console.log("05 edit detection");
  const openedEdit = await clickByText(page, "button", "Edit detection|Edit Detection");
  await delay(1500);
  if (openedEdit) await shot("05_edit_detection");
  else console.log("  (skip: couldn't find Edit detection button)");

  // Cancel back to view
  await clickByText(page, "button", "^\\s*Cancel\\s*$");
  await delay(800);

  // ─── 06. Create detection — blank template ─────────────────────────
  console.log("06 create detection (blank)");
  const openedCreate = await clickByText(page, "button", "Create detection|Create Detection|New detection");
  await delay(1500);
  if (openedCreate) await shot("06_create_blank");
  else console.log("  (skip: couldn't find Create button)");

  // ─── 07. Create detection — Prompt Assist ──────────────────────────
  console.log("07 create detection (prompt assist)");
  const openedAssist = await clickByText(page, "div, button", "Prompt Assist");
  await delay(1200);
  if (openedAssist) await shot("07_create_prompt_assist");

  // ─── 08. Create detection — Import from Prompt ─────────────────────
  console.log("08 create detection (import)");
  const openedImport = await clickByText(page, "div, button", "Import from Prompt");
  await delay(1200);
  if (openedImport) await shot("08_create_import");

  await browser.close();
  console.log("\n=== Done. Screenshots in screenshots/detection-setup/ ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
