import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "screenshots", "metrics");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Provenance / span model with a canonical Correction History (target) that both
// the archived view and Performance Metrics consume. All longer notes span the
// full participant width so text never overspills a box.
const DEF = `sequenceDiagram
    autonumber
    actor AN as Annotator
    participant CH as Child (working copy)
    participant QA as QA Review
    participant DR as Discrepancy Review
    participant FN as Final (MASTER)
    participant HX as Correction History (canonical, target)

    Note over AN,HX: Charged correction = a QA/Discrepancy change that SURVIVES to the END of its span and differs from that span's annotator baseline
    Note over AN,HX: An annotator-authored change never counts and starts a NEW span (baseline) for that field

    rect rgb(235,240,255)
    Note over AN,HX: Span 1 — annotator baseline A
    AN->>CH: Submit A
    QA->>CH: Correct A to B (write back to child)
    QA-->>HX: record QA change A to B (stage=QA)
    QA-->>AN: Below threshold — needs revision
    end

    rect rgb(233,247,233)
    Note over AN,HX: Span 2 — annotator baseline C (annotator edit started it)
    AN->>CH: Revise to C
    AN-->>HX: record annotator change B to C (new baseline, not a correction)
    DR->>FN: Resolve C to B (final)
    DR-->>HX: record DR change C to B (stage=Discrepancy)
    end

    Note over AN,HX: Charge a span only if its END value differs from that span's baseline (end value = handoff at revision, or final for the last span)
    Note over AN,HX: span 1 end B != A -> 1 ... span 2 end B != C -> 1 ... total = 2 charged corrections
    Note over AN,HX: net-revert A->QA B->DR A (no annotator edit) = 0 ... adopt A->QA B->Ann B = 1 ... each returned QA round is its own span
    HX->>HX: derive charged corrections (one canonical derivation)
    Note over AN,HX: Accuracy = per-field BINARY (wrong iff >=1 charged span) ... correction COUNT = sum of charged spans
    Note over AN,HX: Same records feed: Archived Corrections View = Performance Metrics = corrections table`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:24px;background:#ffffff;}#c{display:inline-block;}</style>
</head><body><div id="c">rendering...</div>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad:false, theme:"default", sequence:{ useMaxWidth:false, wrap:true, width:200 } });
const def = ${JSON.stringify(DEF)};
const { svg } = await mermaid.render("graph", def);
document.getElementById("c").innerHTML = svg;
window.__done = true;
</script></body></html>`;

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 2000, height: 1300, deviceScaleFactor: 2 });
  await page.setContent(HTML, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__done === true && document.querySelector("#c svg"), { timeout: 30000 });
  const el = await page.$("#c");
  const out = path.join(OUT_DIR, "corrections-provenance-light.png");
  await el.screenshot({ path: out });
  console.log("\u2713", out);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
