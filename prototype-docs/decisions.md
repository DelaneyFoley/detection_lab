# Prototype decisions and change history

## Workflow decisions

These are decisions explicitly requested in this conversation, not inferred
approval of reverse-engineered application behavior.

| ID | Date | Decision | Source / owner | Status |
| --- | --- | --- | --- | --- |
| PDEC-001 | 2026-10-27 | Maintain a living whole-prototype inventory and requirements register | Owner request in setup conversation | CONFIRMED |
| PDEC-002 | 2026-10-27 | Diagnose ambiguity, unclear steps and coherence before net-new development | Owner request in setup conversation | CONFIRMED |
| PDEC-003 | 2026-10-27 | Use a separate prototype agent; keep production planning distinct | Owner request + preceding discussion | CONFIRMED |
| PDEC-004 | 2026-10-27 | PQ-001: consolidate HIL finalization into one "Start AI Prompt Iteration" action; remove the standalone Finalize HIL step | Owner clarification (this conversation) | CONFIRMED |
| PDEC-005 | 2026-10-27 | The iteration checkpoint is an immutable baseline the iterator must use; subsequent intentional starts create new checkpoints while earlier ones are preserved | Owner clarification (this conversation) | CONFIRMED |
| PDEC-006 | 2026-10-27 | Explicit ground-truth and image-attribute edits save to the official dataset when saved; no separate "promote to ground truth" step for explicit edits | Owner clarification (this conversation) | CONFIRMED |
| PDEC-007 | 2026-10-27 | PQ-002: preserve checkpoints and audit history; "Recompute All vs Current GT" is comparison-only (no dataset commit, no inference), distinct from the iteration checkpoint | Owner clarification (this conversation) | CONFIRMED |
| PDEC-008 | 2026-10-27 | OPEN-001: Start AI Prompt Iteration is gated on review coverage — every image has a ground-truth label, and every false positive / false negative has a reviewer note | Owner clarification (this conversation) | CONFIRMED |
| PDEC-009 | 2026-10-27 | OPEN-002: preserve per-run ground-truth correction history and surface per-run value vs current state and cross-run flip-flopping | Owner clarification (this conversation) | CONFIRMED |
| PDEC-010 | 2026-10-27 | PQ-003: comparisons hold ground truth constant (same GT required); independent variable is either prompt version or, in a new mode, model/thinking level | Owner clarification (this conversation) | CONFIRMED |
| PDEC-011 | 2026-10-27 | PQ-004: on partial creation (detection saved, baseline prompt failed), keep a recoverable draft with an explicit pending state and a safe idempotent retry (not atomic rollback) | Owner clarification (this conversation) | CONFIRMED |
| PDEC-012 | 2026-10-27 | PQ-005: hard-delete + cascade for detections/versions/runs after explicit confirmation; datasets and current GT/attribute labels are unaffected | Owner clarification (this conversation) | CONFIRMED |
| PDEC-013 | 2026-10-27 | PQ-005: approval becomes a dated, retained decision record (version + evaluation + override reason + timestamp + actor), not a single mutable pointer | Owner clarification (this conversation) | CONFIRMED |
| PDEC-014 | 2026-10-29 | PC-001: Single Detection runs as `preamble + exactly one detection block` via the aggregate inference path; preamble comes from the selected production context; no sibling members | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-015 | 2026-10-29 | PC-001: Production Label is mandatory for a Single Detection (the block label and the label whose presence means DETECTED); context is selectable even when the detection is not yet a member | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-016 | 2026-10-29 | PC-001: apply the new shape to the creation form, Development-mode run panel, and prompt-version editor | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-017 | 2026-10-29 | PC-001: drop the `detection_category` selector from the Single Detection flow entirely | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-018 | 2026-10-29 | PC-001: forward-only change; existing detections/versions retain stored system_prompt/label_policy/decision_rubric/user_prompt_addendum (no migration/backfill/deletion) | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-019 | 2026-10-29 | PC-001: collapse Blank + Prompt Assist into one "Single Detection" mode (blank by default with an optional Prompt Assist button); creation modes become Single Detection and Production Replication | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-020 | 2026-10-29 | PC-001: remove the four Admin category prompt editors and retire their setting keys/API fields + STRICT_JSON_CONTRACT placement; Single Detection runs exactly like Production Replication (aggregate schema, label enum, no system prompt) | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-021 | 2026-10-29 | PC-001 (OI-1): a Single Detection version freezes a production context snapshot for reproducible parity; preamble is extracted from the frozen snapshot | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-022 | 2026-10-29 | PC-001 (OI-3): fully rework Prompt Compare and Prompt Iteration to operate on the single Detection Prompt field and the aggregate single-member inference path (presence semantics); drop system_prompt/label_policy/decision_rubric | Owner clarification (PC-001 conversation) | CONFIRMED |
| PDEC-023 | 2026-10-29 | PC-002: Prompt Feedback for a composition-backed source edits only the single Detection Prompt (`section: "detection_prompt"`) and saves a composition-backed Single Detection version | Owner approval (PC-002 conversation) | CONFIRMED |
| PDEC-024 | 2026-10-29 | PC-002: forward-only — legacy non-composition versions keep the existing decision-policy/rubric/addendum feedback behavior | Owner approval (PC-002 conversation) | CONFIRMED |
| PDEC-025 | 2026-10-29 | PC-002: preserve the GOLDEN-set regression check (runs via the composition-aware run path) | Owner approval (PC-002 conversation) | CONFIRMED |

## Product-intent decisions

The decisions below are **confirmed prototype intent** stated by the product
owner (Delaney Foley) on 2026-10-27. They distinguish four things explicitly:
**confirmed intent**, **verified code behavior**, **implementation gaps**
(intent not yet met in code), and **remaining open questions**. Documentation of
intent does **not** mean the implementation conforms; required application
changes are tracked as follow-up work in [followups.md](followups.md) and must
each pass through a separately approved `PC-###` contract before implementation.

Existing production decisions (Super Admin roles, centralized Gemini, a clean
rebuild) remain scoped to the production package and are not copied here.

### PDEC-004 — Consolidate finalization into "Start AI Prompt Iteration" (PQ-001)

- **Confirmed intent:** There is no standalone review sign-off independent of AI
  iteration. The separate **Finalize HIL** action is removed from the intended
  workflow. Clicking **Start AI Prompt Iteration** is one user action that:
  (1) validates the run is complete and any explicitly agreed review
  prerequisites are satisfied; (2) captures and saves a checkpoint of the current
  reviewed evidence and metrics, linked to the run, prompt version, evaluation
  configuration, and ground-truth basis; (3) records that checkpoint in the
  version history; (4) starts automated iteration from the saved checkpoint. No
  separate finalize click or confirmation is required solely to create the
  checkpoint. Button may stay labeled "Start AI Prompt Iteration" with helper
  text: "Saves a checkpoint of the current review and metrics, then starts
  automated prompt improvement." Manual prompt-version creation in Detection
  Setup remains independent of HIL review and these checkpoints.
- **Verified code behavior:** Today finalization is a **separate** POST
  (`/api/hil/finalize`) that must run before iteration; the iteration route
  rejects with "Finalize the HIL review before running prompt iteration" unless a
  prior `hil_finalized` version-note entry exists
  ([prompt-iteration/route.ts](../src/app/api/hil/prompt-iteration/route.ts#L112)).
  The finalize gate is used **only** for automated iteration; manual Detection
  Setup versioning has no such gate (verified: `hasHilEntryForRun` appears only
  in finalize and prompt-iteration). Duplicate in-flight iteration jobs are
  already guarded (queued/running returns the existing job).
- **Implementation gap:** two clicks today vs. one intended; the standalone
  Finalize action/button must be absorbed. Tracked as `fup-consolidate`.
- **Supersedes:** the earlier register recommendation to **retain a separate
  Finalize HIL button** (PQ-001 option C as originally framed; PD-010/PD-014
  "define finalization separately" wording). Marked SUPERSEDED.

### PDEC-005 — Checkpoint is the immutable iteration baseline (PQ-001 continued)

- **Confirmed intent:** The checkpoint preserves the evidence accepted as the
  starting point for automated iteration; it is **not** a commit-to-dataset
  action. Required behavior: checkpoint creation must succeed before iteration
  starts; the iterator must use the **saved** evidence, not silently switch to
  later edits in mutable run/dataset records; duplicate submissions/retries must
  not create duplicate jobs or checkpoint entries; if startup fails after the
  checkpoint is saved, preserve it for retry; subsequent intentional iteration
  starts must remain possible, where changed evidence produces a **new**
  checkpoint while earlier checkpoints remain preserved.
- **Verified code behavior:** The orchestrator reads **live** predictions
  (`runRepository.getRunPredictions`) and computes its baseline from them
  ([orchestrator.ts](../src/lib/promptIteration/orchestrator.ts#L196)); it does
  **not** consume the stored finalize `metrics_snapshot`. Finalize currently
  enforces **one finalize per run** (second attempt → 409,
  [finalize/route.ts](../src/app/api/hil/finalize/route.ts#L63)).
- **Implementation gaps:** (a) iterator uses live, mutable rows rather than a
  frozen checkpoint (`fup-iterator-uses-checkpoint`); (b) checkpoint must capture
  and link immutable reviewed evidence + metrics + run + prompt version + eval
  config + GT basis, and survive startup failure for retry
  (`fup-checkpoint-capture`); (c) the one-finalize-per-run restriction conflicts
  with "subsequent intentional starts create new checkpoints" and must be
  reassessed (`fup-one-finalize-restriction`).
- **Open question:** what review prerequisites (if any) must hold before Start.
  No requirement to review every image has been established, and **no per-image
  review-coverage gate exists today**. Clicking Start must **not** be taken to
  prove every image was reviewed. Tracked open as `open-review-coverage`.

### PDEC-006 — Explicit GT and image-attribute edits save independently

- **Confirmed intent:** Explicit ground-truth and image-attribute edits save to
  the official dataset when the edit is saved; they do not wait for AI Prompt
  Iteration or Recompute All. A separate "promote to ground truth" step is not
  part of this workflow for those explicit edits. Explicit GT editing stays
  **distinct** from the separate `corrected_label` operation; the current
  split-dependent behavior of `corrected_label` is documented without assuming
  every reviewer correction is an equivalent canonical dataset edit.
- **Verified code behavior:**
  - Explicit **GT label** edits in HIL always update the per-run prediction GT
    and commit to canonical `dataset_items` when `update_ground_truth` is set;
    the HIL UI defaults that flag to `true` for GT-label edits, and the dedicated
    GT editor sends it explicitly true
    ([HilReview.tsx](../src/components/HilReview.tsx#L322),
    [HilReview.tsx](../src/components/HilReview.tsx#L2404),
    [hil/route.ts](../src/app/api/hil/route.ts#L48)). GT-label transitions are
    journaled in `groundtruth_corrections`
    ([reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L127)).
  - `corrected_label` commits to canonical GT **only** when
    `update_ground_truth` is set **and** the run's split is `ITERATION`
    ([hil/route.ts](../src/app/api/hil/route.ts#L92)) — it is not equivalent to
    an explicit GT edit.
  - **Structured image attributes** (`segment_tags`) save immediately to
    `dataset_items` via `PUT /api/datasets { item_id, segment_tags }`
    ([HilReview.tsx](../src/components/HilReview.tsx#L566),
    [datasets/route.ts](../src/app/api/datasets/route.ts#L850)). The free-text
    `reviewer_note` is always synced to `dataset_items.image_description`
    ([hil/route.ts](../src/app/api/hil/route.ts#L32)).
- **Implementation gaps:** structured attribute (`segment_tags`) edits are **not
  journaled** in any audit trail, unlike GT-label corrections
  (`fup-attr-audit`). The precise effect of attribute edits on overall metrics,
  attribute breakdowns, and filtering — and whether recompute refreshes those —
  is not yet verified (`inv-attr-metrics`).
- **Supersedes:** the earlier recommendation (PD-003/PQ-005 framing, PD-010
  "expose a separate labeled promotion") that explicit reviewer edits need a
  separate promote-to-ground-truth step. Marked SUPERSEDED for explicit edits.

### PDEC-007 — Preserve checkpoints; recompute is comparison-only (PQ-002)

- **Confirmed intent:** "Recompute All vs Current GT" evaluates existing
  predictions against the dataset's already-saved current ground truth; it does
  not commit edits to the dataset and does not rerun model inference. Preserve
  the distinction between (a) a checkpoint captured when AI iteration starts
  (the reviewed evidence/metrics baseline for that iteration) and (b) an
  evaluation against current GT (updated scores for comparison). Recomputation
  may refresh current-comparison results but must preserve earlier checkpoints,
  original model predictions, and an auditable history of reviewer corrections.
  Comparisons must identify their ground-truth basis and evaluation scope;
  matching ground truth alone does not make different image cohorts, label
  scopes, or metric definitions equivalent.
- **Verified code behavior:** `recompute-all` re-syncs each run's prediction GT
  from canonical dataset labels and recomputes metrics, scoring with
  `corrected_label` nulled **in memory only** (not deleted from the DB)
  ([recompute-all/route.ts](../src/app/api/runs/recompute-all/route.ts#L10)). It
  does not rerun inference and does not write dataset edits. However,
  `syncRunGroundTruthFromDataset` **overwrites** `predictions.ground_truth_label`
  in the DB to current canonical GT
  ([reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L170)), so
  the per-run GT snapshot at run time is mutated. Original `predicted_decision`
  values are preserved; GT-label transition history is preserved in
  `groundtruth_corrections`.
- **Clarified for the owner's question:** recompute clearing `corrected_label`
  removes only the **active scoring override** for that pass; it does **not**
  destroy review history (the column remains in the DB and GT transitions remain
  journaled). The real exposure is the overwritten per-run `ground_truth_label`
  snapshot, which undermines an immutable checkpoint unless the checkpoint stores
  its own frozen truth.
- **Implementation gaps:** per-run GT snapshot is mutated by recompute
  (`fup-preserve-run-gt-snapshot`); comparisons/metrics do not yet surface their
  GT basis and evaluation scope/cohort/label scope
  (`fup-comparison-basis-labeling`).
- **Supersedes:** nothing; refines PD-010/PD-018 toward an explicit,
  checkpoint-preserving model.

### PDEC-008 — Start AI Prompt Iteration review-coverage gate (resolves OPEN-001)

- **Confirmed intent:** Before **Start AI Prompt Iteration** proceeds, the
  reviewed run must satisfy a coverage prerequisite:
  1. **Every image has a ground-truth label.**
  2. **Every false positive and every false negative has a populated reviewer
     note.**
  The purpose is to force the reviewer to call out what the model **missed**
  (FN) or **overcalled** (FP), so the iteration loop can tighten the prompt using
  the image, the reviewer note, the predicted vs ground-truth labels, and the
  AI's prediction evidence. True positives / true negatives do **not** require a
  note. This replaces "no every-image rule established"; there is now a
  definite coverage rule (GT on every image; notes on every FP/FN).
- **Verified code behavior:** today the iteration route gates only on run
  `completed` + an existing finalized note
  ([prompt-iteration/route.ts](../src/app/api/hil/prompt-iteration/route.ts#L112));
  **no coverage validation exists**. The reviewer note and label fields needed to
  evaluate the rule are present on predictions, and the iterator already consumes
  corrected truth + reviewer notes when packaging reviewed rows (PR-082),
  supporting the intent.
- **Implementation gap:** add the coverage validation as a precondition of Start
  (block with a clear, actionable message listing what is missing). Tracked as
  `FUP-008`.
- **Open sub-questions (not assumed):**
  - Images where inference failed (not FP/FN/TP/TN): must they still have a GT
    label (intent implies yes) and are they exempt from the note requirement?
  - Multi-label runs: is the FP/FN note required **per label** or per image?
  These are recorded as OPEN-003 in [followups.md](followups.md) rather than
  silently resolved.

### PDEC-009 — Per-run GT correction history and flip-flop visibility (resolves OPEN-002)

- **Confirmed intent:** Even after ground-truth labels are updated and earlier
  runs are rescored, the reviewer must be able to see, per run, **which ground
  truths were corrected and to what value in that specific run**, and compare
  that to the **current** ground-truth value — including detecting a label that
  is flipped back and forth **across runs**. The per-run corrected value must
  remain visible and comparable to current state over time.
- **Verified code behavior:** `groundtruth_corrections` already journals each
  per-run GT transition (old/new label, run, image, predicted decision,
  ai-matches-new-GT, reason, actor, timestamp), is append-only, and is **not**
  touched by recompute, so the history survives rescoring
  ([recordGroundtruthCorrection](../src/lib/repositories/reviewRepository.ts#L127),
  [corrections route](../src/app/api/hil/gt-corrections/route.ts), "GT Updated"
  filter in [HilReview.tsx](../src/components/HilReview.tsx#L758)). Much of this
  intent is therefore **already satisfied for GT edits**, which reinforces
  FUP-006 (do not lose the per-run truth snapshot).
- **Implementation gaps:** the corrections query is scoped to a **single run**
  and does not join the **current** GT, so (a) per-run-value-vs-current
  comparison and (b) cross-run per-image flip-flop detection are not surfaced
  (`FUP-009`).
- **Clarifies OPEN-002's framing:** the owner's need is **ground-truth**
  correction history (the `ground_truth_label` edit path), which is journaled.
  Whether the distinct non-GT `corrected_label` operation also needs its own
  separate journal remains a narrower open item (OPEN-002 retained, narrowed).

### PDEC-010 — Prompt comparison comparability model (PQ-003)

- **Confirmed intent:** A valid comparison holds **ground truth constant** — the
  two compared runs must share the same ground-truth basis (same dataset
  revision / GT). Differing ground truth must not be presented as a valid
  comparison. The **independent variable** is chosen explicitly:
  1. **Prompt-version mode** (existing): vary the prompt; hold dataset/GT and
     (ideally) model/thinking level constant.
  2. **Model / thinking-level mode** (new, to implement): hold the prompt and the
     dataset/GT constant and vary the **model and/or thinking level**. The owner
     explicitly wants this mode — it is a valuable comparison today impossible in
     the app.
- **Verified code behavior:** comparison selection keys on **prompt versions +
  one dataset** ([PromptCompare.tsx](../src/components/PromptCompare.tsx#L397));
  `pickLatestCompletedRun` returns only the single **latest** completed run per
  (prompt, dataset) ([synthesize.ts](../src/lib/promptCompare/synthesize.ts#L34),
  [L367](../src/lib/promptCompare/synthesize.ts#L367)), so **model/thinking level
  is not a selectable axis**. There is **no GT-equivalence check**; only a
  Development-vs-Production cross-mode warning exists. Runs do persist the needed
  provenance — `dataset_hash`, `model_used`, and decoding/`thinking_level`
  ([runs/route.ts](../src/app/api/runs/route.ts#L185)) — so both requirements are
  implementable.
- **Implementation gaps:** `FUP-010` — enforce GT equivalence as a blocking rule
  and identify the GT basis/evaluation scope in results (extends FUP-007);
  `FUP-011` — add the model/thinking-level comparison mode, which requires
  run-level selection (by model + thinking level) rather than "latest per
  prompt."
- **Open sub-question (resolved 2026-10-27) → OPEN-004:** the model/thinking-level
  mode uses **only pre-existing completed runs** and does **not** trigger new
  runs; if a new model/level run is needed, the owner creates it first through
  the normal run flow. So the compare flow stays selection + synthesis over
  existing runs, with no inference execution for the compared targets.
- **Supersedes:** nothing; this resolves PD-015 toward option C with GT as the
  mandatory controlled constant.

### PDEC-011 — Recoverable draft for partial detection creation (PQ-004)

- **Confirmed intent (option B):** When detection creation succeeds but the
  baseline-prompt request fails, keep the detection as a **recoverable draft**
  with an **explicit "detection saved; baseline prompt pending" state** and a
  **safe, idempotent retry** to create the baseline prompt. Do not roll back the
  author's detection-definition work (not atomic), and do not leave a
  non-functional detection behind only a transient toast.
- **Verified code behavior:** creation is two sequential requests; on prompt
  failure the UI shows a transient error toast but **keeps the detection,
  selects it, and navigates to view mode** with no rollback, no persistent
  pending state, and no retry
  ([handleCreateDetection](../src/components/DetectionSetup.tsx#L383),
  [prompt failure branch](../src/components/DetectionSetup.tsx#L434)). This is
  close to option C but with weak signaling — a promptless detection is left in
  place and is effectively non-functional for inference.
- **Implementation gaps:** add a persistent pending/draft state on the detection;
  add an idempotent retry that creates the baseline prompt without duplicating
  the detection; replace the transient-only signal with a visible pending
  indicator and guided retry (`FUP-012`).
- **Open sub-question (resolved 2026-10-27) → OPEN-005:** a promptless detection
  is allowed to persist; it **blocks Run Inference** until a baseline prompt
  exists, and if the idempotent retry fails the user manually adds a prompt
  version via the normal "new version" path before running inference. The
  inference block is **already enforced** — the Run Inference action requires a
  selected prompt version, which a zero-version detection cannot provide
  ([canRun guard](../src/components/BuildDataset.tsx#L168)). FUP-012 should fold
  in a clear "add a baseline prompt first" message alongside the pending
  indicator.

### PDEC-012 — Hard-delete + cascade for detections/versions/runs (PQ-005)

- **Confirmed intent (option A):** Deleting a detection, prompt version, or run
  **hard-deletes and cascades** its dependents after explicit confirmation.
  There is no need to retain data for things the owner chooses to delete.
  Clarifications:
  - Deletion does **not** touch datasets — datasets are deleted separately on the
    Datasets tab.
  - Deletion does **not** change the dataset's current ground-truth or attribute
    labels; it only removes the **record of when they were corrected** (the
    `groundtruth_corrections` audit for that run), which is acceptable.
- **Verified code behavior:** `deleteDetectionCascade` hard-deletes
  review_flags → groundtruth_corrections → predictions → runs →
  version_note_entries → prompt_versions → the detection
  ([detectionRepository.ts](../src/lib/repositories/detectionRepository.ts#L112));
  `deletePromptCascade` does the same per version and nulls the approval pointer
  if it referenced that version
  ([promptRepository.ts](../src/lib/repositories/promptRepository.ts#L133)).
  Confirmed: the cascade does **not** delete datasets/`dataset_items`.
- **Reconciliation (important):** this does **not** contradict PDEC-005/007/009.
  Those decisions preserve checkpoints and GT-correction history across
  **recompute / rescoring / iteration restart** (do not lose history merely
  because you rescore). PDEC-012 governs **intentional deletion**, where losing
  those records is acceptable. The two cover different events.
- **Implementation note / minor gap:** the delete-confirmation UI text says it
  cascades "prompts/runs/**datasets**," which is inaccurate — datasets are not
  deleted. Correct the wording (`FUP-014`). No preservation changes required.

### PDEC-013 — Approval as a dated, retained decision record (PQ-005, sub-question 1)

- **Confirmed intent:** Prompt approval becomes a **dated, retained decision
  record** capturing the approved version, the evaluation it was based on (the
  completed held-out eval run), any override reason, and a timestamp + actor —
  not merely today's single overwritable pointer. Approval remains distinct from
  deployment/publication (PD-016). Under PDEC-012, these approval records are
  still cascaded when the owning detection is hard-deleted.
- **Verified code behavior:** approval is a single column
  `detections.approved_prompt_version`
  ([detectionRepository.ts](../src/lib/repositories/detectionRepository.ts#L91)),
  overwritten/nulled with no timestamp, actor, linked evaluation, or history
  ([approval gate](../src/app/api/detections/route.ts#L103)).
- **Implementation gap:** add an append-only approval decision log (version +
  eval run + override reason + timestamp + actor); keep a "current approved"
  pointer but back it with retained history (`FUP-013`).

## Change history

| Date | Change | Application impact | Verification / approval |
| --- | --- | --- | --- |
| 2026-10-27 | Initialize prototype agent, source baseline, register and initial diagnostic | None authorized; documentation/customization only | Baseline intent and diagnostic dispositions pending owner review |
| 2026-10-27 | Record Batch A intent (PDEC-004–007) for PQ-001/PQ-002; update PD-010, PD-014, WF-012, WF-013 and related requirements; open follow-up work register | None implemented; documentation only. Required app changes tracked in [followups.md](followups.md) | Confirmed intent recorded by product owner; implementation requires separate approved PC per item |

Record future decisions as PDEC-008 onward with question/requirement IDs, chosen
option, rationale, owner, date, and impact. Preserve rejected/superseded decisions.

No `PC-###` implementation contract has been approved. Future change records live
in `changes/PC-###.md`; create the folder only when the first change is planned.
