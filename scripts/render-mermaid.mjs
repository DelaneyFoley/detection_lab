// Renders each ```mermaid``` block in the epic to a PNG for Confluence (which
// has no mermaid plugin). Output: docs/screenshots/diagram-*.png
//
//   node scripts/render-mermaid.mjs

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EPIC = path.join(__dirname, "..", "docs", "EPIC-annotator-correction-review-parity.md");
const OUT_DIR = path.join(__dirname, "..", "docs", "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const NAMES = ["diagram-flow-end-to-end", "diagram-r1-logic", "diagram-r4-navigation"];

const md = fs.readFileSync(EPIC, "utf8");
const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());
console.log(`Found ${blocks.length} mermaid blocks`);

const htmlFor = (code) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body { margin:0; background:#ffffff; }
  #wrap { display:inline-block; padding:28px; }
  .mermaid { font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
</style></head><body>
<div id="wrap"><pre class="mermaid">${code.replace(/</g, "&lt;")}</pre></div>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "default", flowchart: { htmlLabels: true, useMaxWidth: false } });
  window.__ready = mermaid.run().then(() => { window.__done = true; });
</script></body></html>`;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });

  const tmp = path.join(os.tmpdir(), `mmd-${Date.now()}.html`);
  for (let i = 0; i < blocks.length; i++) {
    fs.writeFileSync(tmp, htmlFor(blocks[i]));
    await page.goto("file://" + tmp, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector(".mermaid svg") && window.__done === true, { timeout: 30000 });
    const el = await page.$("#wrap");
    const name = NAMES[i] || `diagram-${i + 1}`;
    await el.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    console.log("✓", `${name}.png`);
  }
  fs.rmSync(tmp, { force: true });
  await browser.close();
  console.log("\nDone → docs/screenshots/");
}

main().catch((e) => { console.error(e); process.exit(1); });
