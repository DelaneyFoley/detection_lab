import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const OUT_ROOT = path.join(
  __dirname,
  "..",
  "screenshots",
  "detection-setup",
  "button-click-flows",
);
const VIEWPORT = { width: 1728, height: 1117 };

fs.mkdirSync(OUT_ROOT, { recursive: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stepName(step, action) {
  return `${String(step).padStart(2, "0")}_${action}.png`;
}

async function screenshot(page, flowDir, step, action) {
  const outPath = path.join(flowDir, stepName(step, action));
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`  [32m✓[0m ${path.relative(path.join(__dirname, ".."), outPath)}`);
}

async function clickByText(page, selector, matcher) {
  return page.evaluate(
    (sel, matcherText) => {
      const re = new RegExp(matcherText, "i");
      const all = [...document.querySelectorAll(sel)];
      const visible = all.filter((el) => el.offsetParent !== null && re.test((el.textContent || "").trim()));
      visible.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
      if (!visible.length) return false;
      visible[0].click();
      return true;
    },
    selector,
    matcher,
  );
}

async function clickButtonNearHeading(page, headingText, buttonText) {
  return page.evaluate(
    (headingMatcher, buttonMatcher) => {
      const headingRe = new RegExp(headingMatcher, "i");
      const buttonRe = new RegExp(buttonMatcher, "i");

      const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, div, p")].filter(
        (el) => el.offsetParent !== null && headingRe.test((el.textContent || "").trim()),
      );
      if (!headings.length) return false;

      const anchor = headings[0];
      const region = anchor.closest("div");
      if (!region) return false;

      const candidates = [...region.querySelectorAll("button")].filter(
        (btn) => btn.offsetParent !== null && buttonRe.test((btn.textContent || "").trim()),
      );
      if (!candidates.length) return false;

      candidates[0].click();
      return true;
    },
    headingText,
    buttonText,
  );
}

async function gotoDetectionSetup(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(1200);

  await clickByText(page, "button, a, [role='button']", "^\\s*Detection Setup\\s*");
  await delay(600);
}

async function loadWithDetectionSelected(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(1200);

  await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")].filter((el) => el.offsetParent !== null);
    const detectionSelect = selects.find((sel) =>
      [...sel.options].some((opt) => /major|corrosion|plumbing|water heater|toilet/i.test(opt.textContent || "")),
    );
    if (!detectionSelect) return;
    const candidate = [...detectionSelect.options].find(
      (opt) => opt.value && !/select detection/i.test(opt.textContent || ""),
    );
    if (!candidate) return;
    detectionSelect.value = candidate.value;
    detectionSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await delay(3200);
}

async function openCreateDetection(page) {
  const clicked = await clickByText(
    page,
    "button, a, [role='button']",
    "Create New Detection|Create Detection|Create detection|New detection",
  );
  if (!clicked) {
    throw new Error("Could not find a Create Detection button from Detection Setup.");
  }
  await delay(1400);
}

async function runFlow(page, flowName, worker) {
  const flowDir = path.join(OUT_ROOT, flowName);
  ensureDir(flowDir);
  console.log(`\n→ ${flowName}`);
  await worker(flowDir);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  try {
    await runFlow(page, "01_open-create-detection", async (flowDir) => {
      await gotoDetectionSetup(page);
      await screenshot(page, flowDir, 1, "open_detection_setup");
      await openCreateDetection(page);
      await screenshot(page, flowDir, 2, "click_create_detection");
    });

    await runFlow(page, "02_blank-template", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "create_page_default");
      await clickByText(page, "button, div", "^\\s*Blank Template\\s*$");
      await delay(700);
      await screenshot(page, flowDir, 2, "click_blank_template");
    });

    await runFlow(page, "03_prompt-assist-template", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "create_page_default");
      await clickByText(page, "button, div", "Prompt Assist");
      await delay(900);
      await screenshot(page, flowDir, 2, "click_prompt_assist");
    });

    await runFlow(page, "04_import-from-prompt-template", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "create_page_default");
      await clickByText(page, "button, div", "Import from Prompt");
      await delay(900);
      await screenshot(page, flowDir, 2, "click_import_from_prompt");
    });

    await runFlow(page, "05_cancel-create-detection", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "create_page_open");
      await clickByText(page, "button", "^\\s*Cancel\\s*$");
      await delay(1000);
      await screenshot(page, flowDir, 2, "click_cancel");
    });

    await runFlow(page, "06_save-detection-attempt", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "before_save_click");
      await clickByText(page, "button", "^\\s*Save Detection\\s*$");
      await delay(1100);
      await screenshot(page, flowDir, 2, "click_save_detection");
    });

    await runFlow(page, "07_decision-policy-remove", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "decision_policy_visible");
      const removed = await clickButtonNearHeading(page, "Decision Policy", "^\\s*Remove\\s*$");
      if (!removed) {
        await clickByText(page, "button", "^\\s*Remove\\s*$");
      }
      await delay(900);
      await screenshot(page, flowDir, 2, "click_remove_decision_policy");
    });

    await runFlow(page, "08_decision-rubric-add-criterion", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "decision_rubric_visible");
      await clickByText(page, "button", "\\+\\s*Add criterion");
      await delay(900);
      await screenshot(page, flowDir, 2, "click_add_criterion");
    });

    await runFlow(page, "09_image-attributes-actions", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "image_attributes_visible");
      await clickByText(page, "button", "What are image attributes\\?");
      await delay(1000);
      await screenshot(page, flowDir, 2, "click_image_attributes_help");
      await page.keyboard.press("Escape");
      await delay(300);
      await clickByText(page, "button", "\\+\\s*Add attribute");
      await delay(900);
      await screenshot(page, flowDir, 3, "click_add_attribute");
    });

    await runFlow(page, "10_compiled-prompt-preview-toggle", async (flowDir) => {
      await gotoDetectionSetup(page);
      await openCreateDetection(page);
      await screenshot(page, flowDir, 1, "compiled_prompt_preview_collapsed");
      await clickByText(page, "div, button", "Compiled Prompt Preview");
      await delay(900);
      await screenshot(page, flowDir, 2, "click_compiled_prompt_preview");
    });

    await runFlow(page, "11_detection-selected-state", async (flowDir) => {
      await loadWithDetectionSelected(page);
      await screenshot(page, flowDir, 1, "select_detection");
    });

    await runFlow(page, "12_edit-detection", async (flowDir) => {
      await loadWithDetectionSelected(page);
      await screenshot(page, flowDir, 1, "detection_view_mode");
      await clickByText(page, "button, [role='button']", "Edit detection|Edit Detection");
      await delay(1300);
      await screenshot(page, flowDir, 2, "click_edit_detection");
    });

    await runFlow(page, "13_new-version-prompt-form", async (flowDir) => {
      await loadWithDetectionSelected(page);
      await screenshot(page, flowDir, 1, "detection_view_mode");
      await clickByText(page, "button, [role='button']", "New version|New Version");
      await delay(1300);
      await screenshot(page, flowDir, 2, "click_new_version");
    });

    await runFlow(page, "14_prompt-group-expand-collapse", async (flowDir) => {
      await loadWithDetectionSelected(page);
      await screenshot(page, flowDir, 1, "prompt_groups_collapsed");
      await clickByText(page, "div, button, [role='button']", "runs|versions?");
      await delay(1000);
      await screenshot(page, flowDir, 2, "click_expand_prompt_group");
      await clickByText(page, "div, button, [role='button']", "runs|versions?");
      await delay(900);
      await screenshot(page, flowDir, 3, "click_collapse_prompt_group");
    });

    console.log("\nDone. All Detection Setup button flows captured.");
    console.log(`Output root: ${OUT_ROOT}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
