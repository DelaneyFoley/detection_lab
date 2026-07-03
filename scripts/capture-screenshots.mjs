import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, "..", "screenshots");

const BASE_URL = "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  async function screenshot(name) {
    const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(`✓ ${name}.png`);
  }

  // Navigate to app
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(2000);

  // ─── Navigate to Annotation tab ──────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Annotation") && b.textContent.includes("assigned"));
    if (btn) btn.click();
  });
  await delay(3000);

  // Wait for the "I am" select to have options loaded
  await page.waitForFunction(() => {
    const selects = [...document.querySelectorAll("select")];
    return selects.some((sel) => sel.offsetParent !== null && [...sel.options].some((o) => o.value === "Delaney"));
  }, { timeout: 10000 });

  // The visible Delaney select is at index 8 (confirmed via debug)
  // Use page.$$ and select on the specific element
  const allSelects = await page.$$("select");
  await allSelects[8].select("Delaney");
  await delay(3000);

  // ─── 2. My Datasets view ───────────────────────────────────────────
  await screenshot("02_annotation_my_datasets");

  // ─── 3. Click Flags sub-tab ────────────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Flags") && !b.textContent.includes("Queue"));
    if (btn) btn.click();
  });
  await delay(2500);
  await screenshot("03_annotation_flags_open");

  // Click Resolved filter
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Resolved"));
    if (btn) btn.click();
  });
  await delay(1500);
  await screenshot("04_annotation_flags_resolved");

  // ─── 5. Click Performance sub-tab ─────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Performance"));
    if (btn) btn.click();
  });
  await delay(2500);
  await screenshot("05_annotation_performance");

  // ─── 6. QA Pipeline ────────────────────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Quality Assurance") && b.textContent.includes("QA"));
    if (btn) btn.click();
  });
  await delay(2000);
  await screenshot("06_qa_pipeline");

  // ─── 7. QA Flags Queue ─────────────────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Flags Queue"));
    if (btn) btn.click();
  });
  await delay(2000);
  await screenshot("07_qa_flags_queue");

  // ─── 8. QA Metrics ─────────────────────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Metrics") && b.textContent.includes("Logs"));
    if (btn) btn.click();
  });
  await delay(2000);
  await screenshot("08_qa_metrics_logs");

  // ─── 9. Saved Datasets ─────────────────────────────────────────────
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const btn = buttons.find((b) => b.textContent.includes("Datasets") && b.textContent.includes("Manage datasets"));
    if (btn) btn.click();
  });
  await delay(2000);
  await screenshot("09_saved_datasets");

  await browser.close();
  console.log("\n=== All screenshots captured ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
