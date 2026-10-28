# Prototype coherence diagnostic

**Status:** COMPLETE — awaiting owner review  
**Mode:** baseline/diagnostic only  
**Evidence:** static source inventory and existing test definitions recorded in
[baseline](baseline.md) and [requirements](requirements.md). This is a
source-based diagnostic, not exercised UI or API validation. A scope correction
from the UI inventory identifies `DatasetManager.tsx` as dormant/unmounted; the
active Datasets tab uses `SavedDatasets` and nested `MergeDatasets`. References
to the legacy CSV parser below are therefore not evidence of active behavior.

The inventory was compiled and eight existing test suites / 129 unit tests
passed before this diagnostic. Tests were not rerun by the diagnostic agent.
No runtime, browser, API, data, provider,
integration, or script validation was performed for this report. All PR intent
remains **UNCONFIRMED**. Findings are questions, verification gaps, or options
unless stated otherwise; no static-only finding is asserted as a reproduced
defect. No implementation is authorized.

Priority is a product/workflow priority, not a security rating: P1 = coherence
or data-integrity decision; P2 = workflow clarity; P3 = polish. Confidence
separates confidence in the static observation from confidence in its impact.
All findings are **OPEN** and link to an unanswered question where intent is
needed.

## Prioritized findings

Finding IDs are stable references, not severity order. Start with the five
decisions in [Batch A](questions.md#batch-a--highest-impact-workflow-decisions):
HIL finalization/history (PD-010/018), comparable runs (PD-015), partial creation
(PD-002), and version/deletion/approval retention (PD-003/016/017).
Then review split/QA guarantees (PD-007/009), save/recovery validation
(PD-008/013), and execution configuration authority (PD-004/012).

### PD-001 — Shared selections and hidden views can leave stale context

- **Classification / priority:** `IMPROVEMENT_OPTION` / P2
- **Evidence:** shared state retains per-detection prompt/run selections and
  pending dataset navigation. Eligible tab panels remain mounted while hidden,
  subject to top-level workflow/detection gates
  ([entry gates](../src/app/page.tsx#L296),
  [panel rendering](../src/app/page.tsx#L327),
  [store](../src/lib/store.ts#L3)). Cross-tab refresh is explicit rather than universal
  ([store refresh](../src/lib/store.ts#L29)).
- **Affected:** PR-002–PR-009; WF-001, WF-006, WF-011, WF-012, WF-014.
- **Consequence:** after a context switch or a data mutation, a visible result
  may be stale or may need a clearer indication of which detection, run, or
  dataset it represents. This is a coherence risk, not a verified stale-data
  defect.
- **Confidence:** static observation high; actual user impact medium.
- **Recommendation:** make the active detection/run/dataset explicit at
  handoffs; define which selections reset and which persist, and refresh or
  invalidate dependent views on relevant mutations.
- **Proposed verification:** switch detections and tabs, mutate a selected
  dataset/run, and verify labels, data, selection, and refresh behavior remain
  aligned.
- **Question:** PQ-006.
- **Status:** OPEN.

### PD-002 — Detection creation and initial prompt creation can partially succeed

- **Classification / priority:** `VALIDATION_GAP` / P1
- **Evidence:** detection and initial prompt creation use separate requests
  ([create handler](../src/components/DetectionSetup.tsx#L383)); initial prompt
  creation is part of the blank setup path
  ([creation handler](../src/components/DetectionSetup.tsx#L359)).
- **Affected:** PR-014–PR-016; WF-002, WF-003.
- **Consequence:** if the second request fails, a detection may exist without
  the expected initial prompt. Static evidence does not establish whether the
  UI communicates this state or supports retry.
- **Confidence:** separate-request observation high; occurrence and impact
  medium.
- **Recommendation:** choose and communicate a recovery contract. Prefer a
  recoverable draft with an explicit “detection saved; initial prompt pending”
  state and idempotent retry, unless atomic creation is required.
- **Proposed verification:** fail the prompt request after detection creation;
  inspect persisted state, success/error feedback, retry behavior, and duplicate
  prevention.
- **Question:** PQ-004.
- **Status:** OPEN.

### PD-003 — Prompt version, approval, and deletion lifecycles need an owner rule

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** editing a version saves a new version
  ([version edit](../src/components/DetectionSetup.tsx#L1852)); version
  deletion uses a shared helper
  ([delete helper](../src/components/DetectionSetup.tsx#L102)); held-out
  approval updates a detection pointer through a separate gate
  ([approval gate](../src/app/api/detections/route.ts#L103)).
- **Affected:** PR-018–PR-023, PR-089–PR-091, PR-094; WF-003, WF-015, WF-016.
- **Consequence:** users need to know whether approval is a current pointer or
  retained decision history, and what deleting an approved or referenced
  version does to runs, notes, and auditability. The inventory does not establish
  the desired retention policy or every dependent-record effect.
- **Confidence:** lifecycle surfaces high; unresolved policy and effect medium.
- **Recommendation:** define approval as a traceable decision tied to an exact
  version and evaluation; prefer archive/soft-delete for versions referenced by
  runs or approval history, with explicit replacement/unapproval behavior.
- **Proposed verification:** approve a version, create dependent run/note
  records, then test edit, replacement, archive/delete, and history display.
- **Question:** PQ-005.
- **Status:** OPEN.

### PD-004 — Production-mirror configuration has several plausible authorities

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** frozen context snapshots and editable compositions coexist
  ([context snapshot](../src/app/api/admin/contexts/snapshot/route.ts#L49),
  [aggregate panel](../src/components/DetectionSetup.tsx#L3850)); saved
  versions record composition/snapshot provenance and replication mode
  ([production mirror tests](../tests/productionMirror.test.ts#L32)); runs
  store prompt snapshots and decoding parameters
  ([run creation](../src/app/api/runs/route.ts#L166)).
- **Affected:** PR-025–PR-030, PR-066; WF-003, WF-004, WF-011.
- **Consequence:** without an agreed source of truth, an author may not know
  whether current catalog, frozen snapshot, edited aggregate, saved prompt
  version, or run snapshot determines execution and reproducibility.
- **Confidence:** multiple configuration layers high; user confusion medium.
- **Recommendation:** define and show an explicit chain: frozen source revision
  -> editable composition -> saved prompt version -> immutable run snapshot.
  Identify which step is authoritative for each execution.
- **Proposed verification:** change catalog, composition, target/siblings, and
  decoding configuration independently; compare preview, saved version, run
  snapshot, and executed request.
- **Question:** PQ-008.
- **Status:** OPEN.

### PD-005 — Setup quick test should remain visibly distinct from evaluation

- **Classification / priority:** `IMPROVEMENT_OPTION` / P3
- **Evidence:** setup quick test uses uploaded images and a separate diagnostic
  route rather than the saved evaluation-run path
  ([quick-test UI](../src/components/DetectionSetup.tsx#L4465),
  [quick-test route](../src/app/api/runs/quick-test/route.ts)).
- **Affected:** PR-031; WF-005, WF-003, WF-015.
- **Consequence:** if results look like durable run evidence, users could overread
  a quick preview as reproducible evaluation or approval evidence. Available
  evidence does not establish whether the current UI makes this distinction
  clear.
- **Confidence:** separate-path observation high; user impact low-to-medium.
- **Recommendation:** label results as diagnostic/ephemeral and link users to
  saved dataset evaluation for comparable or approval evidence.
- **Proposed verification:** inspect quick-test success, failure, refresh, and
  export states for persistence and evidence labeling.
- **Question:** PQ-016.
- **Status:** OPEN.

### PD-006 — Active dataset identity behavior remains to be established

- **Classification / priority:** `VALIDATION_GAP` / P2
- **Evidence:** the CSV sanitizer
  ([legacy parser](../src/components/DatasetManager.tsx#L916)) belongs to dormant,
  unmounted `DatasetManager.tsx`; it is not evidence that the active Datasets
  tab sanitizes IDs or accepts normalized collisions. The active surface is
  `SavedDatasets` with nested `MergeDatasets`
  ([active dataset surface](../src/components/SavedDatasets.tsx#L20),
  [merge surface](../src/components/MergeDatasets.tsx#L53)). Result enrichment
  joins using run dataset and image ID
  ([prediction join](../src/lib/repositories/runRepository.ts#L8)); runs also
  retain a dataset hash and prompt snapshot
  ([run creation](../src/app/api/runs/route.ts#L166)).
- **Affected:** PR-036 (dormant/unconfirmed), PR-038, PR-066, PR-069; WF-006,
  WF-011, WF-014.
- **Consequence:** identity/revision consistency matters across active ingest,
  runs, and exports, but this inventory correction means no active normalization
  or collision behavior is established. Do not treat the legacy parser as an
  active bug or prescribe a change based on it.
- **Confidence:** legacy parser being dormant high (scope correction); active
  identity behavior unknown; potential impact medium.
- **Recommendation:** establish the active ingest identity contract before
  proposing a behavior change; verify whether original IDs are preserved and
  how duplicate item keys and run-to-item references are handled.
- **Proposed verification:** trace only the active `SavedDatasets` ingest and
  append paths, using synthetic duplicate/edited items; compare persisted
  identity, run join, and exports. Do not test the dormant parser as the active
  journey.
- **Question:** PQ-006.
- **Status:** OPEN.

### PD-007 — Generated splits and QA-finalized data may represent different guarantees

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** split creation has UI-requested counts and API-generated 50/20/30
  ratios; generated split records are independently hashed and finalized
  ([split API](../src/app/api/datasets/route.ts#L332),
  [split persistence](../src/app/api/datasets/route.ts#L374),
  [UI split builder](../src/components/SavedDatasets.tsx#L3341)). A separate
  parent-finalization path requires approved children and normally resolved
  conflicts ([parent finalization](../src/app/api/datasets/route.ts#L942)).
- **Affected:** PR-039–PR-043, PR-059–PR-063; WF-006, WF-007, WF-009, WF-010,
  WF-011.
- **Consequence:** “finalized” may denote a generated immutable split or a
  reviewed/reconciled ground-truth set. Eligibility for annotation, QA,
  inference, and held-out evaluation may differ. The UI/API split relationship
  is also a proposed check, not a confirmed ratio mismatch.
- **Confidence:** distinct paths high; semantic confusion medium-to-high.
- **Recommendation:** distinguish machine-generated split status from
  human-reviewed/finalized ground truth; define split ratios and which
  transitions/consumers each type permits.
- **Proposed verification:** compare requested and persisted counts; trace one
  generated split and one QA-finalized parent through annotation, run selection,
  held-out evaluation, export, and revision.
- **Question:** PQ-007.
- **Status:** OPEN.

### PD-008 — Annotation autosave and optimistic rollback need journey validation

- **Classification / priority:** `VALIDATION_GAP` / P1
- **Evidence:** label/attribute edits use optimistic updates with attempted
  rollback ([save item](../src/components/MyWork.tsx#L1000)); dirty descriptions
  save on navigation/unmount through keepalive updates
  ([note cleanup](../src/components/MyWork.tsx#L844),
  [note save](../src/components/MyWork.tsx#L916)); submission requires allowed
  status and labeled items ([submission gate](../src/app/api/qa/route.ts#L380)).
- **Affected:** PR-047–PR-052; WF-008.
- **Consequence:** delayed, reordered, rejected, or interrupted writes could
  leave the displayed value, stored value, and submitted work out of sync. The
  existing helper tests do not establish this browser/API sequence.
- **Confidence:** save mechanisms high; failure impact medium.
- **Recommendation:** make unsaved/pending/failed state visible and prevent
  submission while writes remain unresolved; serialize or version writes per
  item if needed.
- **Proposed verification:** delay/reorder/reject writes, rapidly navigate,
  reload before/after keepalive completion, then submit and compare displayed
  versus persisted values.
- **Question:** PQ-010.
- **Status:** OPEN.

### PD-009 — QA sampling thresholds, attempt history, and status transitions need one acceptance rule

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** QA supports random/stratified samples and attempt history
  ([sample schema](../src/lib/schemas.ts#L200),
  [sample history](../src/components/QualityAssurance.tsx#L2669)); approval
  uses the latest fully reviewed attempt and a 90% threshold, with an override
  reason below it ([approval rule](../src/app/api/qa/route.ts#L440)); status
  transitions are separately checked ([transition check](../src/app/api/qa/route.ts#L414)).
- **Affected:** PR-053–PR-062; WF-009, WF-010, WF-018.
- **Consequence:** sample size, incomplete attempts, override authority, and
  status movement jointly determine whether work is accepted. Threshold and
  override policy are observed implementation, not confirmed product intent.
- **Confidence:** static rule high; policy impact high.
- **Recommendation:** document the denominator and eligible attempt, define
  threshold/override ownership, and surface the exact blocking reason in the
  pipeline.
- **Proposed verification:** test no/partial/complete samples, repeated
  attempts, boundary results, override/no-override, and each allowed transition;
  reconcile UI counts with API outcome.
- **Question:** PQ-011.
- **Status:** OPEN.

### PD-010 — HIL correction, canonical ground truth, and historical metrics are separate concepts

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** HIL can update prediction correction and optionally propagate
  ground truth ([HIL schema](../src/lib/schemas.ts#L64),
  [HIL route](../src/app/api/hil/route.ts#L10)); ground-truth corrections have
  a separate history route ([correction history](../src/app/api/hil/gt-corrections/route.ts));
  finalization records a metric snapshot and run link
  ([finalize route](../src/app/api/hil/finalize/route.ts#L68)); iteration
  requires finalized HIL evidence ([iteration guard](../src/app/api/hil/prompt-iteration/route.ts#L113)).
- **Affected:** PR-071, PR-074, PR-076–PR-082; WF-011, WF-012, WF-013, WF-018.
- **Consequence:** current dataset truth, a per-run reviewer correction, and the
  truth/metrics used for an earlier run may diverge. Users need to understand
  what finalization freezes and whether historical metrics change after GT
  edits.
- **Confidence:** distinct mechanisms high; interpretation impact high.
- **Recommendation:** retain immutable original run metrics and truth/config
  provenance; if recomputation is supported, expose it as a new, labeled
  revision. Define finalization separately from canonical GT mutation.
- **Proposed verification:** make prediction-only and GT-propagating corrections,
  finalize, edit GT later, recompute, and compare run history, current dataset
  truth, snapshots, feedback, and iteration inputs.
- **Questions:** PQ-001, PQ-002.
- **Status:** OPEN.

### PD-011 — Flags and notifications span surfaces without a confirmed shared resolution contract

- **Classification / priority:** `VALIDATION_GAP` / P2
- **Evidence:** flags can attach to prediction or dataset item and appear in
  multiple views ([flag schema](../src/lib/schemas.ts#L128),
  [flags queue](../src/components/shared/FlagsQueue.tsx)); notifications load
  for a chosen annotator with separate dismissal behavior
  ([notification API](../src/app/api/notifications/route.ts)).
- **Affected:** PR-051, PR-075, PR-098, PR-101; WF-008, WF-009, WF-012, WF-018.
- **Consequence:** it is not established whether a flag resolved in one view is
  consistently reflected in others, who owns the resolution, or whether
  notifications are task assignments, reminders, or status signals.
- **Confidence:** multi-surface coverage high; inconsistency impact medium.
- **Recommendation:** define one flag lifecycle/actor record and make
  notification purpose, recipient, and dismissal semantics explicit.
- **Proposed verification:** create and resolve each flag type in each entry
  surface; compare queue, counts, history, notifications, and refresh after
  failure/reload.
- **Question:** PQ-012.
- **Status:** OPEN.

### PD-012 — Effective model/configuration may be ambiguous across global and saved settings

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** the app exposes a shared model selector
  ([header controls](../src/app/page.tsx#L210)); prompt versions include model
  and decoding configuration ([prompt editor](../src/components/DetectionSetup.tsx#L2363));
  run creation stores mode-dependent parameters
  ([run route](../src/app/api/runs/route.ts#L166)); provider dispatch maps model
  names ([model mapping](../src/lib/models.ts#L1)).
- **Affected:** PR-006, PR-020, PR-066, PR-070; WF-001, WF-003, WF-011.
- **Consequence:** if global selection and saved prompt settings differ, the
  chosen effective model, decoding values, and provider may not be obvious from
  the authoring preview or historical run record. Static evidence does not
  establish which setting wins in every path.
- **Confidence:** configuration surfaces high; user impact medium-to-high.
- **Recommendation:** show effective values at run start and persist them as
  run provenance; define whether model choice is global, prompt-versioned, or
  explicitly overridden.
- **Proposed verification:** vary global and prompt-level model/config values
  independently and compare preview, dispatched request, run record, and logs,
  including unsupported model IDs.
- **Question:** PQ-009.
- **Status:** OPEN.

### PD-013 — Persisted async jobs need a defined restart and cancellation outcome

- **Classification / priority:** `VALIDATION_GAP` / P1
- **Evidence:** iteration job state is persisted while its worker starts
  asynchronously in the local process
  ([iteration enqueue](../src/app/api/hil/prompt-iteration/route.ts#L145),
  [queue interface](../src/lib/services/interfaces.ts#L21)); runs poll, cancel,
  and hand off to HIL ([run polling/cancel](../src/components/BuildDataset.tsx#L268));
  compare synthesis has progress and terminal handling
  ([compare execution](../src/lib/promptCompare/synthesize.ts#L293)).
- **Affected:** PR-067, PR-068, PR-084, PR-087; WF-011, WF-013, WF-014.
- **Consequence:** process interruption, a late completion, or cancellation
  racing with terminal success could leave persisted status unclear or work
  stranded. Static evidence is not restart/cancellation reproduction.
- **Confidence:** local worker architecture high; frequency/impact medium.
- **Recommendation:** define recoverable terminal states and startup
  reconciliation, and ensure cancellation is terminal/idempotent before
  reporting it as complete.
- **Proposed verification:** in an isolated synthetic environment, interrupt
  each job phase, restart, cancel near completion, and verify persisted state,
  retry/cleanup, and UI feedback agree.
- **Question:** PQ-013.
- **Status:** OPEN.

### PD-014 — Prompt feedback and iteration need clear source, eligibility, and discard semantics

- **Classification / priority:** `INTENT_QUESTION` / P2
- **Evidence:** feedback is based on the selected run
  ([feedback component](../src/components/PostHilMetrics.tsx#L13)); iteration
  requires completed/finalized evidence and separates eligibility from score
  ([iteration guard](../src/app/api/hil/prompt-iteration/route.ts#L113),
  [eligibility](../src/lib/promptIteration/metrics.ts#L53)); discarding a
  completed round deletes candidate prompt/runs/notes and reselects a remaining
  best candidate ([discard path](../src/app/api/hil/prompt-iteration/route.ts#L181)).
- **Affected:** PR-079–PR-084; WF-012, WF-013.
- **Consequence:** a user may not know which finalized run/truth and objective
  generated a suggestion, what makes a candidate eligible versus best, or
  whether discard removes useful history.
- **Confidence:** workflow mechanisms high; decision impact medium.
- **Recommendation:** show source run and eligibility rationale in every
  candidate; prefer reversible archive of discarded rounds unless deletion is
  explicitly intended.
- **Proposed verification:** change selected run, accept/reject suggestions,
  create candidates with mixed eligibility, and discard the current/last round;
  verify provenance and retained history.
- **Question:** PQ-014.
- **Status:** OPEN.

### PD-015 — Prompt comparison selects latest runs but meaningful comparability is unresolved

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** synthesis selects the latest completed run per prompt/dataset
  ([run selection](../src/lib/promptCompare/synthesize.ts#L34)); the comparison
  UI selects prompts, dataset, and label ([comparison controls](../src/components/PromptCompare.tsx#L397)).
- **Affected:** PR-085–PR-087; WF-014.
- **Consequence:** latest runs could differ in dataset revision/hash, model,
  decoding configuration, or evaluation conditions. “Latest” alone does not
  establish a fair comparison or reproducible synthesis.
- **Confidence:** selection rule high; comparability impact high.
- **Recommendation:** show exact run IDs and provenance; default to compatible
  dataset identity/revision and effective execution settings, with explicit
  opt-in and labeling for exploratory cross-config comparisons.
- **Proposed verification:** select runs with equal and unequal dataset hashes,
  model/configuration, and completion times; verify chosen runs, warnings/gates,
  and synthesis reproducibility.
- **Question:** PQ-003.
- **Status:** OPEN.

### PD-016 — Held-out evaluation, approval, and deployment must stay distinct

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** held-out evaluation is an explicit run with history/export
  ([evaluation start](../src/components/HeldOutEval.tsx#L73)); approval is a
  manual Setup action tied to completed evaluation and thresholds
  ([approval rule](../src/app/api/detections/route.ts#L103),
  [UI guidance](../src/components/HeldOutEval.tsx#L428)).
- **Affected:** PR-088–PR-091; WF-003, WF-015.
- **Consequence:** users may interpret evaluation completion, an approved
  pointer, or “production” mode as publication/deployment, despite the inventory
  describing them as separate concepts.
- **Confidence:** separation in current design high; likely confusion medium.
- **Recommendation:** label evaluation evidence, prompt approval, and actual
  deployment/publication as distinct states; preserve override rationale with
  the exact evaluation.
- **Proposed verification:** complete passing, failing, and overridden
  evaluations; inspect Setup, logs, selection, exports, and any production-facing
  language for implied deployment.
- **Question:** PQ-005.
- **Status:** OPEN.

### PD-017 — Detection deletion has broad cross-entity consequences

- **Classification / priority:** `INTENT_QUESTION` / P1
- **Evidence:** dashboard deletion confirms cascading prompts/runs/datasets
  ([delete UI](../src/components/DetectionDashboard.tsx#L113),
  [delete route](../src/app/api/detections/route.ts#L194)).
- **Affected:** PR-022, PR-023, PR-092–PR-094; WF-003, WF-011, WF-012,
  WF-013, WF-015, WF-016.
- **Consequence:** deletion may remove or disconnect evidence used for HIL,
  iteration, approval, comparison, and audit/history. Whether the cascade is
  intended and how recoverable it is are unresolved.
- **Confidence:** cascade intent surfaced by UI high; exact retention effect
  medium.
- **Recommendation:** prefer archive/disable for detections with dependent
  evidence; if hard deletion remains, enumerate affected records and require
  explicit impact confirmation and an approved retention policy.
- **Proposed verification:** in isolated fixtures, cancel and confirm deletion
  for detections with each dependent record type; verify pointers, exports,
  histories, and recovery.
- **Question:** PQ-005.
- **Status:** OPEN.

### PD-018 — Metric snapshots and live performance surfaces need a shared meaning

- **Classification / priority:** `VALIDATION_GAP` / P1
- **Evidence:** metric helpers include corrected labels and exclude inference
  failures ([metric tests](../tests/metrics.test.ts#L29)); recomputation can
  revise stored results ([recompute route](../src/app/api/runs/recompute-all/route.ts#L10));
  QA performance has current and historical surfaces
  ([metrics route](../src/app/api/qa/metrics/route.ts),
  [history route](../src/app/api/qa/metrics/history/route.ts)).
- **Affected:** PR-071, PR-072, PR-078, PR-099, PR-100; WF-011, WF-012,
  WF-015, WF-018.
- **Consequence:** dashboard, HIL, run history, and QA metrics may use different
  truth versions, denominators, periods, or correction rules. The existing
  helper tests support algorithms, not consistency of these product views.
- **Confidence:** distinct metric surfaces high; user impact medium-to-high.
- **Recommendation:** label each metric with its source truth/revision,
  denominator, time window, and whether it is a snapshot or recomputation.
- **Proposed verification:** use synthetic cases with null truth, failed calls,
  corrected labels, repeated annotator revisions, and recomputation; reconcile
  every surface and export.
- **Question:** PQ-015.
- **Status:** OPEN.

### PD-019 — Error feedback should distinguish validation, provider, and partial completion

- **Classification / priority:** `VALIDATION_GAP` / P2
- **Evidence:** authoring assist populates editable fields and has a failure path
  ([assist handler](../src/components/DetectionSetup.tsx#L454)); templates may
  fall back to built-ins on load failure
  ([template loading](../src/components/DetectionSetup.tsx#L214)); provider
  and model discovery are separate flows ([model discovery](../src/app/page.tsx#L72),
  [provider assist route](../src/app/api/gemini/detection-assist/route.ts)).
- **Affected:** PR-015, PR-017, PR-029, PR-070, PR-102, PR-104; WF-003, WF-004,
  WF-011, WF-017.
- **Consequence:** users need to tell whether displayed content is saved,
  generated, fallback, stale, partially complete, or blocked by a provider/API
  issue. Static evidence does not prove the messaging is misleading.
- **Confidence:** multiple error/fallback paths high; confusion impact medium.
- **Recommendation:** make fallback and partial-success states explicit, retain
  user input on failure, and provide a safe retry/action at the point of failure.
- **Proposed verification:** inject request failure, timeout, invalid response,
  missing context, and recovery across assist, model discovery, template load,
  and run creation; inspect retained input and visible state.
- **Question:** PQ-016.
- **Status:** OPEN.

### PD-020 — User-facing lifecycle words could make distinct states easier to follow

- **Classification / priority:** `IMPROVEMENT_OPTION` / P3
- **Evidence:** workflows use separate submitted, approved, finalized, archived,
  completed, cancelled, and failed statuses
  ([status definitions](baseline.md#L130), [QA transitions](../src/lib/schemas.ts#L160),
  [run types](../src/types/index.ts#L220)).
- **Affected:** PR-047, PR-052–PR-062, PR-068, PR-077–PR-078, PR-088–PR-091;
  WF-008–WF-012, WF-015.
- **Consequence:** when these terms appear in different tabs, users may conflate
  a dataset review state with a run state or an approval decision. This is a
  usability option, not evidence that current labels are defective.
- **Confidence:** distinct states high; terminology impact low-to-medium.
- **Recommendation:** keep domain-specific states but pair them with the object
  they describe and a concise next action, especially at cross-tab handoffs.
- **Proposed verification:** review each user-visible state and transition
  message in context with representative annotator, reviewer, and author tasks.
- **Question:** PQ-017.
- **Status:** OPEN.

## Workflow coverage

| Workflow | Finding coverage |
| --- | --- |
| WF-001 | PD-001, PD-012 |
| WF-002 | PD-002 |
| WF-003 | PD-002–PD-005, PD-012, PD-014, PD-016–PD-017, PD-019 |
| WF-004 | PD-004–PD-005, PD-019 |
| WF-005 | PD-005 |
| WF-006 | PD-001, PD-006–PD-007 |
| WF-007 | PD-007 |
| WF-008 | PD-008, PD-011, PD-020 |
| WF-009 | PD-007, PD-009, PD-011, PD-018, PD-020 |
| WF-010 | PD-007, PD-009, PD-020 |
| WF-011 | PD-001, PD-004, PD-006, PD-010, PD-012–PD-013, PD-018–PD-019 |
| WF-012 | PD-001, PD-010–PD-011, PD-014, PD-017–PD-018, PD-020 |
| WF-013 | PD-010, PD-013–PD-014, PD-017 |
| WF-014 | PD-001, PD-006, PD-015 |
| WF-015 | PD-003, PD-010, PD-016–PD-018 |
| WF-016 | PD-003, PD-017 |
| WF-017 | PD-011, PD-019 |
| WF-018 | PD-009, PD-011, PD-018 |

No finding is classified `OBSERVED_MISMATCH`: the available static evidence
surfaces consequential cross-workflow tensions, but does not establish a
contradiction with confirmed owner intent or reproduce an incorrect runtime
outcome. The open questions and proposed checks preserve that distinction.

## Next step

Owner review of [the first question batch](questions.md). Answering questions
records intent only; it does not authorize implementation. Keep requirements
UNCONFIRMED until explicitly answered, and create a separately approved `PC-###`
contract before changing application behavior.
