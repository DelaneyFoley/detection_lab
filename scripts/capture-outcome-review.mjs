// Captures the prototype screenshots referenced in
// docs/EPIC-annotator-correction-review-parity.md, driving the running dev
// server against the seeded "OUTCOMES_TEST 1 - Delaney" archived dataset.
//
//   node scripts/capture-outcome-review.mjs
//
// Requires the dev server on http://localhost:3000 and the OUTCOMES_TEST seed.

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "docs", "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:3000";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 2 });

  const shotFull = async (name) => {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip: { x: 245, y: 0, width: 1195, height: 1000 } });
    console.log("✓", name, "(main)");
  };
  const shotCard = async (name, matchText) => {
    const handle = await page.evaluateHandle((txt) => {
      return [...document.querySelectorAll(".app-card")].find((c) => (c.textContent || "").includes(txt)) || null;
    }, matchText);
    const el = handle.asElement();
    if (el) {
      await el.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      console.log("✓", name, "(card)");
    } else {
      await shotFull(name);
    }
  };

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(2000);

  // Annotation tab
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Annotation/.test(x.textContent || ""));
    if (b) b.click();
  });
  await delay(2500);

  // Choose annotator "Delaney"
  await page.waitForFunction(
    () => [...document.querySelectorAll("select")].some((s) => s.offsetParent !== null && [...s.options].some((o) => o.value === "Delaney")),
    { timeout: 15000 }
  );
  for (const s of await page.$$("select")) {
    const has = await s.evaluate((el) => el.offsetParent !== null && [...el.options].some((o) => o.value === "Delaney"));
    if (has) { await s.select("Delaney"); break; }
  }
  await delay(3000);

  // "Done" filter tab holds archived datasets
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Done");
    if (b) b.click();
  });
  await delay(1500);

  // Open the archived dataset
  const opened = await page.evaluate(() => {
    const r = [...document.querySelectorAll("tr")].find((x) => (x.textContent || "").includes("OUTCOMES_TEST 1 - Delaney"));
    if (r) { r.click(); return true; }
    return false;
  });
  console.log("dataset opened:", opened);
  await delay(2500);

  await shotFull("table-outcome-simplified");

  const openImage = async (imageId) => {
    const box = await page.evaluate((id) => {
      const rows = [...document.querySelectorAll("tr")].filter((x) => (x.textContent || "").includes(id));
      const r = rows.find((x) => x.getBoundingClientRect().height > 4) || rows[0];
      if (!r) return null;
      r.scrollIntoView({ block: "center" });
      const b = r.getBoundingClientRect();
      return { x: b.x + 240, y: b.y + b.height / 2, w: Math.round(b.width), h: Math.round(b.height), n: rows.length };
    }, imageId);
    if (!box) { console.log("  row not found:", imageId); return false; }
    const navigated = async () => page.evaluate(() =>
      [...document.querySelectorAll(".app-card")].some((c) => (c.textContent || "").includes("Annotator submitted"))
      || [...document.querySelectorAll("*")].some((e) => (e.textContent || "").trim() === "Secondary Review"));
    await page.mouse.click(box.x, box.y);
    await delay(700);
    if (!(await navigated())) {
      // Fallback: dispatch a bubbling click straight on the row.
      await page.evaluate((id) => {
        const r = [...document.querySelectorAll("table tbody tr")].find((x) => (x.textContent || "").includes(id));
        if (r) r.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }, imageId);
      await delay(700);
    }
    const ok = await navigated();
    if (ok) await delay(1000);
    return ok;
  };
  const goBack = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /(^|\s)Back\b/.test((x.textContent || "").trim()));
      if (b) b.click();
    });
    await delay(1800);
  };

  // OT_4: QA label flip + discrepancy attribute swap (rich example)
  console.log("OT_4 opened:", await openImage("OT_4"));
  await delay(2500);
  await shotFull("image-review-readonly");
  await shotCard("timeline-full", "Annotator submitted");

  await goBack();

  // OT_5: QA adds rust, discrepancy removes rust (the regression case)
  console.log("OT_5 opened:", await openImage("OT_5"));
  await delay(2500);
  await shotCard("timeline-rust-roundtrip", "Annotator submitted");

  await browser.close();
  console.log("\nDone → docs/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });
