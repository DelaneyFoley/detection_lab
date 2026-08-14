import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots", "qa-sampling");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = "http://localhost:3001";
const VIEWPORT = { width: 1440, height: 900 };
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
  await delay(1200);
  await clickByText("QA Sampling");
  await delay(1200);
  await page.screenshot({ path: path.join(OUT_DIR, "prototype-qa-sampling-landing.png") });
  console.log("✓ prototype-qa-sampling-landing.png");

  // pick the first non-discovery dataset in the selector to show full controls
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
  console.log("picked dataset:", picked);
  await delay(1500);
  await page.screenshot({ path: path.join(OUT_DIR, "prototype-qa-sampling-selected.png") });
  console.log("✓ prototype-qa-sampling-selected.png");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
