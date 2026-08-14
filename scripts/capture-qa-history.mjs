import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots", "qa-sampling");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:3001";
const VIEWPORT = { width: 1440, height: 1200 };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  async function clickByText(...subs) {
    return page.evaluate((subs) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        subs.every((s) => (x.textContent || "").includes(s)) && x.offsetParent !== null && !x.disabled);
      if (b) { b.click(); return true; }
      return false;
    }, subs);
  }

  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(1500);
  await clickByText("Quality Assurance", "QA");
  await delay(1000);
  await clickByText("QA Sampling");
  await delay(1000);

  // pick a dataset that has multiple attempts (history)
  const picked = await page.evaluate(() => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value && o.textContent.includes("items")));
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value && o.textContent.includes("items") && !/discovery/i.test(o.textContent));
    if (!opt) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.textContent;
  });
  console.log("picked:", picked);
  await delay(1800);

  // expand QA History
  const expanded = await clickByText("QA History");
  console.log("clicked QA History:", expanded);
  await delay(1200);

  // scroll the QA History header into view and capture the viewport
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("QA History"));
    if (btn) btn.scrollIntoView({ block: "start" });
  });
  await delay(700);
  await page.screenshot({ path: path.join(OUT_DIR, "prototype-qa-history.png") });
  console.log("✓ prototype-qa-history.png");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
