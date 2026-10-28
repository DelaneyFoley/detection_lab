# Prototype intent questions

These are product decisions, not implementation authorization. Answers should
be recorded by the product owner (default routing from the requirements
register); no approval authority beyond that default is assumed. The
recommendations are starting points, not accepted decisions.

## Batch A — highest-impact workflow decisions

### PQ-001 — What does HIL finalization mean?

- **Owner routing:** product owner (default).
- **Related findings:** PD-010, PD-014.
- **Related workflows:** WF-012, WF-013.
- **Current evidence:** finalization requires a completed run and records a
  run-linked metric snapshot/version note; iteration requires this evidence
  ([finalize](../src/app/api/hil/finalize/route.ts#L46),
  [snapshot](../src/app/api/hil/finalize/route.ts#L68),
  [iteration guard](../src/app/api/hil/prompt-iteration/route.ts#L113)).
- **Decision:** Which contract should “Finalize HIL” represent?
  - A. A review-complete checkpoint/snapshot for this run, without changing
    canonical dataset ground truth.
  - B. A reviewed and accepted correction to canonical ground truth.
  - C. Both, but as two separately named actions and records.
- **Recommendation:** C, preserving a run-specific immutable review snapshot
  separately from canonical GT edits.
- **[Answer]:**
- **Status:** Unanswered

### PQ-002 — Should historical run metrics follow later ground-truth edits?

- **Owner routing:** product owner (default).
- **Related findings:** PD-010, PD-018.
- **Related workflows:** WF-011, WF-012, WF-015, WF-018.
- **Current evidence:** HIL may optionally propagate correction to GT; metrics
  can be recomputed and finalization stores a snapshot
  ([HIL schema](../src/lib/schemas.ts#L64),
  [recompute route](../src/app/api/runs/recompute-all/route.ts#L10),
  [finalization](../src/app/api/hil/finalize/route.ts#L68)).
- **Decision:** When GT changes after a run, what is the historical truth?
  - A. Keep original metrics and never recompute.
  - B. Recompute in place against current GT.
  - C. Keep original immutable metrics and allow a separately labeled,
    versioned recomputation.
- **Recommendation:** C, with the truth revision and denominator visible.
- **[Answer]:**
- **Status:** Unanswered

### PQ-003 — What makes two prompt runs meaningfully comparable?

- **Owner routing:** product owner (default).
- **Related findings:** PD-015, PD-012.
- **Related workflows:** WF-011, WF-014.
- **Current evidence:** compare synthesis selects the latest completed run per
  prompt/dataset; runs store snapshots and dataset hashes
  ([selection](../src/lib/promptCompare/synthesize.ts#L34),
  [run snapshot](../src/app/api/runs/route.ts#L166)).
- **Decision:** Which differences should block, warn, or be allowed in a
  comparison?
  - A. Require the same dataset revision/hash and effective execution
    configuration; prompt version is the intended independent variable.
  - B. Allow differing dataset/configuration but prominently disclose every
    difference.
  - C. Allow both modes: strict comparable mode and explicitly exploratory mode.
- **Recommendation:** C, defaulting to strict comparability for evaluation and
  clearly labeling exploratory synthesis.
- **[Answer]:**
- **Status:** Unanswered

### PQ-004 — How should partial detection/initial-prompt creation recover?

- **Owner routing:** product owner (default).
- **Related findings:** PD-002.
- **Related workflows:** WF-002, WF-003.
- **Current evidence:** detection and initial prompt are separate requests
  ([create flow](../src/components/DetectionSetup.tsx#L383)).
- **Decision:** If detection creation succeeds and the prompt request fails:
  - A. Roll back/delete the detection as an atomic operation.
  - B. Keep a recoverable draft with a clear pending-prompt state and safe retry.
  - C. Keep the detection and require manual prompt creation with no automatic
    retry.
- **Recommendation:** B, to avoid losing author work while making partial
  completion explicit and retryable.
- **[Answer]:**
- **Status:** Unanswered

### PQ-005 — What should deletion and approval retention mean?

- **Owner routing:** product owner (default).
- **Related findings:** PD-003, PD-016, PD-017.
- **Related workflows:** WF-003, WF-011–WF-016.
- **Current evidence:** version deletion exists; detection deletion confirms
  cascading prompts/runs/datasets; held-out approval is a manual Setup action
  ([version delete](../src/components/DetectionSetup.tsx#L102),
  [detection delete](../src/app/api/detections/route.ts#L194),
  [approval](../src/app/api/detections/route.ts#L103)).
- **Decision:** What retention should apply to versions/detections referenced by
  runs, HIL, notes, comparisons, or approval history?
  - A. Hard-delete and cascade all dependents after explicit confirmation.
  - B. Archive/soft-delete referenced records; preserve run and approval
    history, with explicit replacement/unapproval.
  - C. Prevent deletion while dependents exist; require an explicit cleanup
    workflow for dependencies.
- **Recommendation:** B by default; approval should remain a dated decision
  linked to the exact version/evaluation, not a deployment claim.
- **[Answer]:**
- **Status:** Unanswered

## Batch B — identity, data lifecycle, and execution authority

### PQ-006 — What identity and selection context must survive a handoff?

- **Owner routing:** product owner (default).
- **Related findings:** PD-001, PD-006.
- **Related workflows:** WF-001, WF-006, WF-011, WF-014.
- **Current evidence:** `DatasetManager.tsx` contains a CSV sanitizer but is
  dormant/unmounted; the active Datasets surface is `SavedDatasets`. The
  run-result join uses dataset/image ID
  ([active surface](../src/components/SavedDatasets.tsx#L20),
  [run join](../src/lib/repositories/runRepository.ts#L8)). Active ingest
  identity behavior has not been established.
- **Decision:** First confirm active ingest behavior. Then decide how duplicate
  item keys and later item revisions should be represented:
  - A. Preserve source ID and reject duplicates.
  - B. Preserve source ID and allow duplicate display IDs using a distinct
    immutable item key.
  - C. Normalize and merge/overwrite colliding items.
- **Workspace-context follow-up:** Which detection, prompt, run, dataset, and
  filter choices should survive a tab switch, detection switch, and page reload?
  Which should clear when a selected record is deleted or becomes ineligible?
  Identity policy and selection retention are separate answers; specify both.
- **Recommendation:** Verify current active behavior before choosing; if
  collisions are possible, prefer preserving source IDs and using an immutable
  internal item identity for historical run references.
- **[Answer]:**
- **Status:** Unanswered

### PQ-007 — Which dataset split/finalization path establishes reviewed truth?

- **Owner routing:** product owner (default).
- **Related findings:** PD-007, PD-009.
- **Related workflows:** WF-006, WF-007, WF-009–WF-011, WF-015.
- **Current evidence:** automatic split records are finalized separately from
  QA parent finalization, and the UI/API split ratio should be reconciled
  ([split persistence](../src/app/api/datasets/route.ts#L374),
  [parent finalization](../src/app/api/datasets/route.ts#L942),
  [split builder](../src/components/SavedDatasets.tsx#L3341)).
- **Decision:** Should generated splits be immediately run-eligible/finalized,
  or must human QA/finalization establish evaluation truth? Also, should split
  ratios be fixed defaults or owner-configurable?
  - A. Generated splits are immutable/run-eligible; QA is a separate optional
    quality workflow.
  - B. Generated splits remain provisional until review; QA-finalized parents
    supply accepted truth.
  - C. Different rules by split role (for example held-out versus iteration).
- **Recommendation:** C, with the ratio and eligibility rule visible before
  generation and persisted with split provenance.
- **[Answer]:**
- **Status:** Unanswered

### PQ-008 — Which production-mirror configuration is authoritative?

- **Owner routing:** product owner (default).
- **Related findings:** PD-004.
- **Related workflows:** WF-003, WF-004, WF-011.
- **Current evidence:** frozen context snapshots and editable composition
  settings both exist ([snapshot](../src/app/api/admin/contexts/snapshot/route.ts#L49),
  [aggregate controls](../src/components/DetectionSetup.tsx#L3850)).
- **Decision:** At execution, should authority be the frozen source snapshot,
  edited composition, saved prompt-version config, or explicit run override?
  - A. Frozen snapshot is authoritative; edits require a new snapshot.
  - B. Saved composition/prompt version is authoritative, with frozen source
    retained as provenance.
  - C. Explicit run-time choice, stored in the immutable run snapshot.
- **Recommendation:** B, and make the source revision, edits, and resulting
  effective execution config separately visible.
- **[Answer]:**
- **Status:** Unanswered

### PQ-009 — What setting determines the effective model and decoding values?

- **Owner routing:** product owner (default).
- **Related findings:** PD-004, PD-012.
- **Related workflows:** WF-001, WF-003, WF-011.
- **Current evidence:** shared model selector, prompt-level config, and run
  snapshot are all present ([selector](../src/app/page.tsx#L210),
  [prompt editor](../src/components/DetectionSetup.tsx#L2363),
  [run route](../src/app/api/runs/route.ts#L166)).
- **Decision:** Is model/config global by workspace, saved per prompt version,
  or overridable at run time?
  - A. Global selector is authoritative.
  - B. Saved prompt-version config is authoritative.
  - C. Prompt defaults with explicit run override, always recorded in run
    provenance.
- **Recommendation:** C, showing effective values before run and persisting
  them immutably.
- **[Answer]:**
- **Status:** Unanswered

## Batch C — workflow controls and supportability

### PQ-010 — What should annotation save and conflict behavior be?

- **Owner routing:** product owner (default).
- **Related findings:** PD-008.
- **Related workflows:** WF-008.
- **Current evidence:** label/attribute changes are optimistic and description
  notes save on navigation/unmount
  ([item save](../src/components/MyWork.tsx#L1000),
  [note save](../src/components/MyWork.tsx#L844)).
- **Decision:** Should every edit save immediately, be explicitly submitted as
  a batch, or support both? How should concurrent or rejected updates appear?
  - A. Immediate save with visible pending/error/retry state and per-item
    conflict handling.
  - B. Explicit draft/save/submit with unsaved-change protection.
  - C. Immediate autosave during work, explicit review/submit before QA.
- **Recommendation:** C, with writes serialized/versioned per item and a
  visible saved state.
- **[Answer]:**
- **Status:** Unanswered

### PQ-011 — What QA sample threshold and override policy should govern approval?

- **Owner routing:** product owner (default).
- **Related findings:** PD-009.
- **Related workflows:** WF-009, WF-010.
- **Current evidence:** approval checks the latest fully reviewed sample and a
  90% threshold; below-threshold approval requires an override reason
  ([approval rule](../src/app/api/qa/route.ts#L440)).
- **Decision:** Keep the observed threshold, make it configurable, or replace it
  with another rule? Who may provide an override and what sample size is
  meaningful?
  - A. Keep a fixed 90% threshold and require a reason for exception.
  - B. Configure threshold/minimum sample size by dataset/task.
  - C. Treat sample results as advisory; a reviewer decides with recorded
    rationale.
- **Recommendation:** B with a documented minimum sample size and attributable
  override.
- **[Answer]:**
- **Status:** Unanswered

### PQ-012 — Who owns flags and what do notifications communicate?

- **Owner routing:** product owner (default).
- **Related findings:** PD-011.
- **Related workflows:** WF-008, WF-009, WF-012, WF-018.
- **Current evidence:** flags appear across dataset, prediction, Annotation,
  and QA contexts; notifications are recipient-specific and dismissible
  ([flags queue](../src/components/shared/FlagsQueue.tsx),
  [notification API](../src/app/api/notifications/route.ts)).
- **Decision:** Are notifications task assignments, reminders, or status
  updates? Is flag resolution owned by a reviewer, annotator, or the actor who
  created the flag?
  - A. Reviewer owns resolution; notifications signal assigned work.
  - B. Creator/assignee owns resolution; notifications are reminders.
  - C. Ownership depends on flag type and is explicitly shown.
- **Recommendation:** C, recording actor, assignee, resolution, and dismissal
  separately.
- **[Answer]:**
- **Status:** Unanswered

### PQ-013 — What should happen to asynchronous jobs after interruption or cancel?

- **Owner routing:** product owner (default).
- **Related findings:** PD-013.
- **Related workflows:** WF-011, WF-013, WF-014.
- **Current evidence:** iteration worker starts in the local process while job
  state is persisted; run and compare flows have polling/cancel paths
  ([iteration enqueue](../src/app/api/hil/prompt-iteration/route.ts#L145),
  [run polling](../src/components/BuildDataset.tsx#L268),
  [compare execution](../src/lib/promptCompare/synthesize.ts#L293)).
- **Decision:** On application restart, should jobs resume, become failed and
  retryable, or be cancelled? Should cancel discard partial results?
  - A. Resume from a persisted checkpoint.
  - B. Mark interrupted jobs failed/retryable; retain partial results.
  - C. Cancel and clean partial work.
- **Recommendation:** B unless work can be safely checkpointed, with idempotent
  cancellation and an explicit retry path.
- **[Answer]:**
- **Status:** Unanswered

### PQ-014 — How should discarded prompt-iteration rounds be retained?

- **Owner routing:** product owner (default).
- **Related findings:** PD-014.
- **Related workflows:** WF-013.
- **Current evidence:** discard removes candidate prompt, runs, and notes before
  selecting a remaining candidate ([discard path](../src/app/api/hil/prompt-iteration/route.ts#L181)).
- **Decision:** Should discard be irreversible deletion or reversible
  de-selection/archive with audit history?
  - A. Hard-delete discarded candidates and dependencies.
  - B. Archive/de-select, preserving provenance and restore capability.
  - C. Keep candidates but hide them from recommended results.
- **Recommendation:** B, unless a separate data-retention rule requires deletion.
- **[Answer]:**
- **Status:** Unanswered

### PQ-015 — What denominators and time windows define performance metrics?

- **Owner routing:** product owner (default).
- **Related findings:** PD-018.
- **Related workflows:** WF-011, WF-012, WF-015, WF-018.
- **Current evidence:** run metrics, recomputation, annotator metrics, and
  historical snapshots are separate surfaces
  ([metrics tests](../tests/metrics.test.ts#L29),
  [recompute](../src/app/api/runs/recompute-all/route.ts#L10),
  [QA metrics](../src/app/api/qa/metrics/route.ts)).
- **Decision:** Which failures, null labels, revisions, and correction types
  belong in each denominator, and should metrics be current or period snapshots?
  - A. Use only labeled, successful cases and preserve dated snapshots.
  - B. Include failures as a distinct outcome and publish separate denominators.
  - C. Define denominator per metric family with labels and visible filters.
- **Recommendation:** C, with immutable snapshots and explicit, inspectable
  denominator rules.
- **[Answer]:**
- **Status:** Unanswered

### PQ-016 — What user-facing evidence should distinguish preview and failure states?

- **Owner routing:** product owner (default).
- **Related findings:** PD-005, PD-019.
- **Related workflows:** WF-003, WF-004, WF-005, WF-011, WF-017.
- **Current evidence:** quick test, prompt assist, model discovery, and template
  loading have separate request/fallback paths
  ([quick test](../src/components/DetectionSetup.tsx#L4465),
  [assist](../src/components/DetectionSetup.tsx#L454),
  [model discovery](../src/app/page.tsx#L72)).
- **Decision:** Should fallback content or quick-test results be retained, and
  what should the UI say when an operation is partial, stale, or unavailable?
  - A. Preserve input and label fallback/preview as non-persistent.
  - B. Preserve input and block use until the user acknowledges fallback.
  - C. Continue with fallback but show provenance and a retry/action.
- **Recommendation:** C for non-destructive fallback; never present preview as
  saved evaluation evidence.
- **[Answer]:**
- **Status:** Unanswered

### PQ-017 — How should lifecycle state labels guide users across tabs?

- **Owner routing:** product owner (default).
- **Related findings:** PD-020.
- **Related workflows:** WF-008–WF-012, WF-015.
- **Current evidence:** dataset review states and run terminal states are
  distinct ([QA transitions](../src/lib/schemas.ts#L160),
  [run types](../src/types/index.ts#L220)).
- **Decision:** Keep current terms, add object-qualified labels, or consolidate
  similar terms where possible?
  - A. Keep current domain terms.
  - B. Qualify each state by object and show the next action.
  - C. Consolidate only where lifecycle semantics are genuinely identical.
- **Recommendation:** B; do not merge distinct data, review, and run states.
- **[Answer]:**
- **Status:** Unanswered
