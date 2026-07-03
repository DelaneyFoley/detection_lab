---
name: demo-mockup
description: Build or update a self-contained HTML demo file that mirrors a Detection Lab component/page 1:1. Use this whenever the user asks for a mockup, demo, walkthrough HTML, or asks to refresh an existing mockup after real-app changes.
---

# Detection Lab HTML Demo Mockup Protocol

You are producing a **single self-contained `.html` file** that a stakeholder can open with a double-click and use as if they were driving the real Detection Lab. The real app is the source of truth. The mockup must feel *identical* to using the real thing — same visuals, same interactions, same workflow shape — with tasteful demo tips and demo shortcuts layered on top to guide the viewer.

The output lives in `HTML Demo Files/` at the repo root.

Canonical reference: **`HTML Demo Files/flags-queue-mockup.html`**. When in doubt about boilerplate, chrome, demo-tip system, or CSS vars, copy from that file — do not invent.

---

## Step 0 — Confirm scope before doing anything else

If the user's request is ambiguous, ask **one round** of clarifying questions covering (only ask what isn't obvious):

1. Which component/page/tab? (must map to a real file under `src/`)
2. Create new file or update existing? (get the exact output path)
3. Any specific interactions to hero (e.g., "focus on the resolve flow" vs. "the full queue page")
4. Anything to explicitly omit or simplify?

Do not ask "should it match the real app?" — that is always yes.

---

## Step 1 — Discovery (mandatory reads before writing a single line)

Read these in parallel. This is non-negotiable — every past mismatch came from skipping this step.

1. **The target component itself.** `src/components/<Component>.tsx` and any subcomponents it composes from `src/components/shared/`.
2. **All shared components the target renders.** Especially `ImagePreviewModal.tsx`, `FlagsQueue.tsx`, `InfoTip.tsx`, `DecisionBadge.tsx`, `AppFeedbackProvider.tsx` — their exact chrome (class names, structure, aria attrs) must be reproduced in the mockup.
3. **`src/app/globals.css`** — grep for `--app-` and any custom class the target uses (`.app-btn`, `.app-card`, `.app-select`, `.app-input`, `.app-badge`, `.app-panel`, `.app-shell`). Copy the exact values into the mockup's `<style>` — never guess.
4. **`src/types/index.ts`** — the shape of the data the component consumes. Fixture rows must satisfy this shape (correct field names, correct nullability).
5. **`src/app/page.tsx`** — the tab list and how the target is mounted (so the mockup's sidebar/header matches).
6. **Real data samples** from `detection_lab.db`:
   ```sh
   sqlite3 detection_lab.db "SELECT * FROM <relevant_table> LIMIT 20;"
   ```
   Use real image IDs (e.g. `MCL_002`, `MC2_0004`, `MCT_AI_001`), real dataset names (e.g. `MC - Toilet V1`, `MC - Laundry V1`, `MC2 TEST`, `Major Oxidation V1`), and the real attribute taxonomy (Blurry_image, Occluded_view, Rusting, Oxidation, Mold, Grime, Staining, Sealant, Leak, Color_confuser, Excluded_hardware, Mineral_buildup, Minor_corrosion, Borderline, Severity_0..Severity_4, etc.). Never invent names like `MC_Toilet_V2` or `sample_001`.
7. **The canonical mockup** (`flags-queue-mockup.html`) if you haven't already — it is the template for `<head>`, CSS vars, `.demo-tip*` system, `.mock-thumb`, `.caret`, `.hidden-init`, and the boot pattern.

**Report to the user in one sentence** what you read and what you plan to mirror before writing.

---

## Step 2 — File skeleton (copy verbatim, adjust title)

Every mockup starts with the same shell. Do not deviate from this outline:

```
<!DOCTYPE html>
<html lang="en"> <head> …meta, title, Tailwind CDN, <style>… </head>
<body>
  [ Optional: page header strip matching the real app's tab bar / breadcrumb ]

  <div class="mx-auto max-w-7xl px-6 py-6 space-y-4">
    [ The real component, rebuilt in vanilla HTML/JS ]
  </div>

  [ Modal shells (fixed inset-0 z-50 …) — one per modal in the real component ]

  [ Toast bar (fixed bottom-6 right-6 …) if the real component surfaces feedback ]

  <script> …fixtures, state, render(), wiring, boot… </script>
</body> </html>
```

- **Tailwind CDN**: `<script src="https://cdn.tailwindcss.com"></script>` — no build step, no config.
- **`<style>` block**: paste the entire `<style>` block from `flags-queue-mockup.html` as a starting point. Trim CSS vars you do not use, but keep the full demo-tip system, `.app-btn*`, `.app-card`, `.app-select`, `.app-input`, `.caret`, `.hidden-init`, `.mock-thumb`, `.mock-viewport` blocks intact.
- **No external assets.** No `<img src="/some/path">`. Use `mock-thumb` divs for image placeholders — a short label pulled from the image ID reads fine at 40–64px.

---

## Step 3 — Fidelity rules (the parts we always get wrong if we're not careful)

### Data fidelity
- **IDs, dataset names, annotator names**: real. Include at least one row with `annotator: null` if the real component handles it, one with a very long `reason` string, and one with empty attributes.
- **Fixture volume**: enough rows to exercise pagination if the real component paginates (≥ pageSize + a few).
- **Timestamps**: recent, plausible ISO strings. Format via helpers, not by hand:
  ```js
  const localDate = (iso) => { const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; };
  const localDateTime = (iso) => { /* M/D/YYYY, H:MM AM/PM */ };
  ```
- **Taxonomy / enums**: pull from the real source file (e.g., attribute taxonomy from the DB or the component). Never invent categories.

### Visual fidelity
- **CSS variables**: use `var(--app-*)`. Do not hard-code hex values that the real app parameterizes.
- **Class names**: mirror the real component's Tailwind classes exactly. If the real component uses `app-card overflow-hidden`, the mockup uses `app-card overflow-hidden` — not `app-card` alone.
- **Modal chrome**: `ImagePreviewModal` uses `fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 md:p-6` outer and `max-w-7xl max-h-[calc(100vh-3rem)] bg-gray-900 border border-gray-700 rounded-lg p-4 my-auto` inner. Match verbatim.
- **Icons**: the real app uses `lucide-react`. In the mockup, inline the SVGs (they're small, ~4–6 well-known ones per file). Do not import lucide via CDN — icons feel more consistent when hand-inlined.
- **Initial collapse/expand state**: match the real component's `useState` defaults. If real `FlagsQueue` has `openCollapsed=false, resolvedCollapsed=true`, the mockup must too.
- **Empty states, loading states, error states**: reproduce them. Include a way to trigger each via a demo shortcut where useful.

### Interaction fidelity
- Every clickable thing in the real component must be clickable in the mockup and produce a plausible visible effect (open the modal, toggle the collapse, update the state, show a toast). No "cosmetic-only" buttons.
- Keyboard behaviors (Esc closes modal, arrow keys navigate) — reproduce them.
- Form validation, disabled states, derived fields (e.g. `deriveResolutionAction`) — reproduce them. Copy the derivation logic from the real component.

---

## Step 4 — HTML hygiene rules (violations break the mockup silently)

- **NEVER nest `<button>` inside `<button>`.** Browsers auto-close the outer button, mangle the DOM, and click handlers stop working. If a header has a toggle button and a demo tip, the tip is a **sibling** of the button, not a child. Wrap both in a `<div class="flex items-center gap-2 relative">`.
- **NEVER put `<div>` inside `<button>`.** Same reason. Use `<span>` with `display: inline-flex` if you need layout.
- Use `.hidden-init { display: none !important; }` for elements that render hidden on first paint (like modals). JS toggles the class.
- `document.addEventListener("keydown", …)` must check if a modal is open before consuming Escape/Arrow keys.
- `render()` is called once at boot at the very end of `<script>`. Every state change calls `render()` again. No partial rerenders — full rerender is simpler and fast enough for a mockup.
- Backdrop click closes the modal: `el(id).addEventListener("click", (e) => { if (e.target === el(id)) close(); });`
- All ids used by JS are unique across the file. Prefix with the modal name (`rm_note`, `vm_action`) to avoid collisions between multiple modals.

---

## Step 5 — Demo tips (the yellow "i" bubbles)

Demo tips are the *only* thing the mockup adds beyond the real app. They explain *why* something exists — for a stakeholder who has never seen this screen — without cluttering the real UI.

### Placement rules
- **Anchor to structural landmarks**, not individual controls: section headers, card titles, modal titles, subtab labels. Not every field needs a tip.
- **Aim for 4–8 tips per mockup.** More than that becomes noise; fewer means you're not explaining the design.
- Overlay style: `demo-tip demo-tip-overlay` positioned absolutely so the tip doesn't push the header layout around. Sits just outside the anchor element.
- If the tip anchors a header that is itself a toggle button, put the tip in a **sibling `<div>`**, never inside the button (see Step 4).

### Writing tone
- 2 short paragraphs max, plus an optional bulleted list of what the row/card/field surfaces.
- Explain the *product decision*, not the code. "Resolved rows stay collapsed by default so the queue reads as 'what needs my attention.'" — not "This uses `useState(true)`."
- Use `<strong>` for the noun the tip is anchored to (image ID, thumbnail, resolution action). Yellow highlight makes it scannable.
- Address the reader as someone who might disagree — surface the tradeoff, not just the mechanic.

### Structure
```html
<div class="demo-tip demo-tip-overlay" style="top: -8px; left: 100%; margin-left: 6px;">
  <button type="button" class="demo-tip-btn" data-demo-tip aria-expanded="false" aria-label="Open demo tip">i</button>
  <div class="demo-tip-popover hidden-init" role="dialog" style="width: 380px;">
    <button type="button" class="demo-tip-close" data-demo-tip-close aria-label="Close demo tip">&times;</button>
    <p>[Product-decision paragraph.]</p>
    <p>[Optional second paragraph with an inline <strong>callout</strong>.]</p>
    <ul>
      <li><strong>Field name</strong> — what it surfaces and why it's on the row.</li>
    </ul>
  </div>
</div>
```

The demo-tip click handler is already in the boilerplate — copy from `flags-queue-mockup.html`. Do not rewrite.

---

## Step 6 — Demo shortcuts (buttons that seed state for the viewer)

Optional. Use when the viewer would otherwise miss an important state. Examples:
- A toolbar with "Load empty state" / "Load 3 open flags" / "Load 50 open flags" so pagination visibly triggers.
- A "Simulate resolve" button in a walkthrough mode.
- A "Toggle theme (dark ↔ light)" toggle if both themes exist in the real app.

Rules:
- Group shortcuts in a **single subtle strip** at the top of the page (or bottom, if less prominent). Label the strip "Demo controls" so it's obviously not part of the product.
- Never add a shortcut that has no real-app analog. If the real app can't "reset all flags to open", the mockup shouldn't either — a viewer will assume the real app does it too.
- Every shortcut fires `render()` after mutating state.

If the mockup is short and linear, skip shortcuts entirely — a mockup with 8 demo tips and 0 shortcuts is often stronger than one with 3 tips and 5 shortcuts.

---

## Step 7 — Verification (do this before telling the user "done")

Run through this list explicitly. If any item fails, fix it before responding.

1. **Discovery diff**: for each shared component you mirrored, grep for its top-level `className=` string in both the real file and the mockup — the strings should be a near-match. Report any deviation.
2. **Data shape**: every fixture row satisfies the real `types/index.ts` interface. No made-up fields.
3. **No nested buttons / no divs inside buttons**: `grep -E "<button[^>]*>[^<]*<button|<button[^>]*>[^<]*<div" mockup.html` returns nothing.
4. **Initial render matches real defaults**: open the file, page loads with the same collapse/expand states, same active tab, same visible modals as a fresh visit to the real app.
5. **Every clickable thing does something visible**: click each row, each toggle, each modal button. No dead controls.
6. **Pager visible when expected**: if fixtures > pageSize, the pager appears; page count math is correct.
7. **Keyboard shortcuts**: Escape closes the topmost modal; arrow keys navigate items if the real app does.
8. **Demo tips**: 4–8 total, each anchored to a landmark, each explains a product decision (not code). No tip is inside a `<button>`.
9. **Standalone**: `file://` open works. No network requests beyond the Tailwind CDN. No broken image icons.
10. **Toast / feedback**: if the real app shows a toast on save/resolve/etc., the mockup shows one too.

At the end of your response, list *exactly which items above you verified* and how. If you skipped one, say so explicitly — do not claim done without proof.

---

## Update workflow (when the real app changed and an existing mockup needs to catch up)

If the user asks to update an existing mockup after a real-app change:

1. **Re-read the real component from scratch.** Do not trust your memory of what it looked like.
2. **Read the existing mockup end-to-end** to inventory what's there.
3. **Produce a diff plan first** — a short bulleted list of "the real app changed X, Y, Z; the mockup will change A, B, C" — then apply it. This gives the user a chance to redirect before you rewrite.
4. **Preserve demo tips and demo shortcuts** unless the underlying feature they describe was removed. Only rewrite a tip if the product decision behind it changed.
5. Run the full Step 7 verification again.

---

## Failure modes to avoid (learned the hard way)

- **Invented dataset names / IDs.** Always pull real names from `detection_lab.db` or the current fixture files.
- **Per-detection attribute taxonomies.** The real app has one flat taxonomy; the mockup must too.
- **Nested `<button>` inside `<button>` for demo tips on toggle headers.** Silently breaks click handling. See Step 4.
- **Copy of `ImagePreviewModal` chrome that drifts** (wrong outer classes, wrong max-w, missing "Image Preview" uppercase label). Re-read `ImagePreviewModal.tsx` every time.
- **Radio-driven "Reviewer Assessment"** when the real component derives it from edits. Always mirror derivation logic, don't ask the user to pick.
- **Missing pager / wrong initial collapse state.** Match the real `useState` defaults byte-for-byte.
- **Fake handlers** — buttons wired to `console.log`. Every click has a visible effect or it doesn't get a button.
- **Skipping verification and declaring done.** Every past round of back-and-forth traces to this.

---

## Response format

When you finish, respond with:

1. Path to the created/updated file.
2. One-line summary of what was mirrored.
3. Which of the Step 7 verification items you actually performed (be specific — "clicked each toggle" not "verified interactions").
4. Anything the real component does that you deliberately did not port, with a one-line reason each.

Do not use trailing prose beyond this.
