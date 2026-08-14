import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots", "discovery");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:3001";
const VIEWPORT = { width: 1440, height: 900 };
const FAMILY = "Discovery Type Example";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  async function shot(name) {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
    console.log(`\u2713 ${name}.png`);
  }

  // click first visible, enabled button whose text contains all substrings
  async function clickByText(...subs) {
    return page.evaluate((subs) => {
      const btns = [...document.querySelectorAll("button")];
      const btn = btns.find((b) => subs.every((s) => (b.textContent || "").includes(s)) && b.offsetParent !== null && !b.disabled);
      if (btn) { btn.click(); return true; }
      return false;
    }, subs);
  }

  async function setReactInput(selector, value) {
    return page.evaluate((selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }, selector, value);
  }

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(1500);

  // ═══════════════ DATASETS TAB ═══════════════
  await clickByText("Datasets", "Manage datasets");
  await delay(1200);
  await setReactInput('input[placeholder="Search datasets..."]', FAMILY);
  await delay(1200);

  // expand parent row
  await page.evaluate((family) => {
    const rows = [...document.querySelectorAll("table tr")];
    const parent = rows.find((r) => {
      const c = r.querySelector("td");
      return c && c.textContent.trim().startsWith(family) && !c.textContent.includes("\u21b3");
    });
    const btn = parent && parent.querySelector("button");
    if (btn) btn.click();
  }, FAMILY);
  await delay(700);
  await shot("01_datasets_list");

  // select parent row to open detail
  await page.evaluate((family) => {
    const rows = [...document.querySelectorAll("table tr")];
    const parent = rows.find((r) => {
      const c = r.querySelector("td");
      return c && c.textContent.trim().startsWith(family) && !c.textContent.includes("\u21b3");
    });
    if (parent) parent.click();
  }, FAMILY);

  // wait until the parent's items load (Assign Annotators enables when items > 0)
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll("*")].find((e) => /PREVIEW \(\d+ IMAGES\)/.test(e.textContent || "") && e.children.length === 0);
    if (!el) return false;
    const m = (el.textContent || "").match(/PREVIEW \((\d+) IMAGES\)/);
    return m && parseInt(m[1]) > 0;
  }, { timeout: 15000 }).catch(() => console.log("warn: parent items didn't load"));
  await delay(500);

  // ── ASSIGN ANNOTATORS MODAL (screen 3) ──
  await clickByText("Actions");
  await delay(500);
  await clickByText("Assign Annotators");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Assign Annotators" && h.closest(".fixed")),
    { timeout: 8000 }).catch(() => console.log("warn: assign modal not detected"));
  await delay(600);
  await shot("03_assign_modal");
  await clickByText("Cancel");
  await delay(500);

  // ── DATASET DETAIL / SPLIT TYPE + ATTRIBUTES (screen 2) ──
  await clickByText("Actions");
  await delay(500);
  await clickByText("Edit Details");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("select")].some((s) => [...s.options].some((o) => o.value === "DISCOVERY") && s.value === "DISCOVERY"),
    { timeout: 8000 }).catch(() => console.log("warn: edit split select not detected"));
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((e) => e.textContent.includes("Dataset Details"));
    if (h) h.scrollIntoView({ block: "start" });
  });
  await delay(500);
  await shot("02_dataset_detail_split");

  // ═══════════════ ANNOTATION TAB (screen 4) ═══════════════
  await clickByText("Annotation");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("select")].some((s) => [...s.options].some((o) => o.value === "Dan")),
    { timeout: 12000 });
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "Dan"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "Dan");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction((family) =>
    [...document.querySelectorAll("table tr")].some((r) => r.textContent.includes(family + " - Dan")),
    { timeout: 12000 }, FAMILY).catch(() => console.log("warn: Dan dataset row not found"));
  await delay(600);
  // real trusted click on the matched row via an element handle (scrolls + clicks center)
  const rowHandles = await page.$$("table tbody tr");
  let clicked = false;
  for (const h of rowHandles) {
    const txt = await h.evaluate((e) => e.textContent || "");
    if (txt.includes(FAMILY + " - Dan")) {
      const cell = await h.$("td:nth-child(2)");
      if (cell) { await cell.click(); clicked = true; }
      break;
    }
  }
  if (!clicked) console.log("warn: could not click Dan row");
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return /\d+\/\d+ tagged/.test(t) || t.includes("Flag for Secondary Review") || t.includes("Submit for Review");
  }, { timeout: 12000 }).catch(() => console.log("warn: annotate view not detected"));
  await delay(1500);
  await shot("04_annotation_attribute_only");

  // ═══════════════ QUALITY ASSURANCE TAB (screen 5) ═══════════════
  await clickByText("Quality Assurance", "QA");
  await delay(1000);
  await clickByText("QA Sampling");
  await delay(800);
  await page.evaluate((family) => {
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent.includes(family + " - Delaney")));
    if (!sel) return;
    const opt = [...sel.options].find((o) => o.textContent.includes(family + " - Delaney"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, FAMILY);
  await delay(1200);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((b) => /Generate Samples|Regenerate Samples/.test(b.textContent || "") && !b.disabled),
    { timeout: 8000 }).catch(() => console.log("warn: generate button not enabled"));
  await clickByText("Generate Samples");
  await clickByText("Regenerate Samples");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".app-card")].some((c) => (c.textContent || "").includes("Click to review")),
    { timeout: 10000 }).catch(() => console.log("warn: no pending sample card"));
  await delay(600);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".app-card")].find((c) => (c.textContent || "").includes("Click to review"));
    if (card) card.click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".fixed")].some((m) => /Attributes|Reviewed Sample|Image ID/.test(m.textContent || "")),
    { timeout: 8000 }).catch(() => console.log("warn: review modal not detected"));
  await delay(1000);
  await shot("05_qa_review_pane");

  await browser.close();
  console.log("\n=== Discovery screenshots captured -> screenshots/discovery/ ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
