# Prototype requirements register: source-derived starting point

Baseline: 2026-10-27, commit `73e0049d09df6c11226c53d3af87c93eaedbfdd3`.
Read [the inventory](baseline.md) for workflow IDs, evidence limits and entities.

## Status and ownership contract

**Every row initially has status U/O**:

- `U` = intent **UNCONFIRMED**: observed behavior, not owner approval.
- `O` = delivery **OBSERVED_IN_CODE**: static evidence, not runtime verification.

Updated intent abbreviations in use after owner review: `C` = **CONFIRMED**
(owner-decided intent; cite the PDEC), `S` = **SUPERSEDED** (behavior replaced by
a later decision; cite the PDEC). A confirmed/superseded intent does not imply
the code already conforms — unmet intent is tracked as follow-up work in
[followups.md](followups.md).

Both statuses are explicit per row. Future rows/revisions should use full status
names or documented abbreviations, with confirmation source/test evidence.
Passing shared helper tests does NOT promote entire rows to runtime-verified.

Unless overridden, **intent owner = product owner (Delaney Foley), priority =
UNTRIAGED**. These are review-routing defaults, not business commitments.
Implementation responsibility is unassigned. Checks below are proposed
acceptance/verification steps, NOT executed manual/API checks. They use synthetic
fixtures and must be refined after intent confirmation.

The register deliberately includes existing behavior and known constraints
without endorsing them. Do not repair or preserve behavior merely because it
appears here. Rejected/experimental behavior stays traceable.

## Workspace and navigation

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-001 | WF-001 | Six guided and five management tabs are available | [shell navigation](../src/app/page.tsx#L17) | Each of the 11 sidebar items selects its corresponding panel | U/O |
| PR-002 | WF-001 | Tab switches hide/show mounted panels without changing URL | [panel rendering](../src/app/page.tsx#L327) | Switch away/back; inspect retained form/filter state and unchanged URL | U/O |
| PR-003 | WF-001 | Selecting a detection establishes shared active workflow context | [header selector](../src/app/page.tsx#L252) | Change detection; verify dependent panels show matching context, not previous rows | U/O |
| PR-004 | WF-001 | Create New Detection clears current selection and opens Setup create mode | [create entry](../src/app/page.tsx#L303) | Click from another tab; new form has no previous detection ID | U/O |
| PR-005 | WF-001 | Guided entry gates differ from globally accessible management panels | [gates](../src/app/page.tsx#L296) | Without detection, check guided prerequisite messages and management access | U/O |
| PR-006 | WF-001 | API key is optional and held in memory; model is shared globally | [key/model controls](../src/app/page.tsx#L210), [store](../src/lib/store.ts#L3) | Use synthetic key; reload clears key; inspect model effect across detections | U/O |
| PR-007 | WF-001 | Model discovery filters options, with static/fallback selection behavior | [model loading](../src/app/page.tsx#L72) | Stub available/unavailable model responses; check selected fallback and error visibility | U/O |
| PR-008 | WF-001 | Prompt/run selections are keyed per detection in an in-memory store | [store selections](../src/lib/store.ts#L20) | Select different prompts/runs in two detections; switch back; reload separately | U/O |
| PR-009 | WF-001 | Pending dataset/subview state enables cross-tab handoffs; mutations broadcast refresh | [store navigation/refresh](../src/lib/store.ts#L29) | Follow dataset handoff; ensure target selected once and mutation refreshes consumers | U/O |
| PR-010 | WF-001 | A global error boundary offers recovery/reset | [global error](../src/app/global-error.tsx) | Inject isolated render failure and check usable recovery without claiming data preservation | U/O |

## Detection and prompt authoring

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-011 | WF-002 | Detection create/edit captures code/name/category, description, policy, rubric, taxonomy and thresholds | [form state](../src/components/DetectionSetup.tsx#L125), [schemas](../src/lib/schemas.ts#L16) | Roundtrip supported fields; reject blank required identity and duplicate code | U/O |
| PR-012 | WF-002 | Omitted authoring fields on detection update preserve existing values | [update preservation](../src/app/api/detections/route.ts#L166) | Update metadata only; existing policy/addendum/rubric remain unchanged | U/O |
| PR-013 | WF-003 | Creation offers Blank Template, Prompt Assist and Production Replication | [mode cards](../src/components/DetectionSetup.tsx#L1882) | Open each mode; confirm its required inputs and available controls | U/O |
| PR-014 | WF-003 | Blank mode supports manually authored fields and an initial baseline prompt | [creation handler](../src/components/DetectionSetup.tsx#L359) | Create synthetic detection manually; inspect saved detection and initial version | U/O |
| PR-015 | WF-003 | Prompt Assist validates description and populates editable generated fields | [generateWithPromptAssist](../src/components/DetectionSetup.tsx#L454) | Empty description blocks; successful response populates fields; failure retains input | U/O |
| PR-016 | WF-003 | Detection creation and initial prompt creation are separate requests | [handleCreateDetection](../src/components/DetectionSetup.tsx#L383) | Intent CONFIRMED PDEC-011: on prompt failure keep a recoverable draft with explicit pending state + idempotent retry (not atomic; not transient-toast-only); promptless detection blocks inference and is recovered by manual prompt add. Gap FUP-012 | C/O |
| PR-017 | WF-003 | Admin templates are loaded, with built-in defaults retained on request failure | [template loading](../src/components/DetectionSetup.tsx#L214) | Stub saved/default templates and a failure; document which content is used | U/O |
| PR-018 | WF-003 | Prompt selection syncs across Setup/Run Inference; approved prompt initializes selection | [selection effects](../src/components/DetectionSetup.tsx#L278) | Open approved detection; switch version/tab; ensure explicit choice is not repeatedly overwritten | U/O |
| PR-019 | WF-003 | Version-row editing presents locked metadata and saves prompt changes as a new version | [version edit](../src/components/DetectionSetup.tsx#L1852) | Edit policy/rubric; compare old/new version IDs, content and lineage | U/O |
| PR-020 | WF-003 | Structured prompt editor shows compiled runtime preview and model/decoding configuration | [prompt editor](../src/components/DetectionSetup.tsx#L2363), [PromptForm save](../src/components/DetectionSetup.tsx#L4133) | Compare preview, saved version and compiled request using synthetic fields | U/O |
| PR-021 | WF-003 | Prompt groups support organization, rename and bulk version selection/actions | [group management](../src/components/DetectionSetup.tsx#L2997), [rename route](../src/app/api/prompts/groups/rename/route.ts) | Rename/select group; check member visibility and deletion scope | U/O |
| PR-022 | WF-003 | Single/group/bulk version deletions share a DELETE helper | [deletePromptVersionRequest](../src/components/DetectionSetup.tsx#L102) | Cancel/confirm each action; inspect dependent runs/notes and active-selection recovery | U/O |
| PR-023 | WF-003 | Version notes include user and automatic creation/edit/HIL/iteration events | [VersionNoteEntry](../src/types/index.ts#L158), [note route](../src/app/api/version-note-entries/route.ts) | Create/edit user note and inspect automatic event ordering/attribution | U/O |
| PR-024 | WF-002 | Primary metric and precision/recall/F1 minimums are configurable | [threshold UI](../src/components/DetectionSetup.tsx#L2363), [MetricThresholds](../src/types/index.ts#L35) | Set boundary values 0/1 and invalid values; inspect UI/API enforcement independently | U/O |

## Production replication and quick test

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-025 | WF-004 | Production-mode save requires context, snapshot, composition and a target unless multi-label | [creation validation](../src/components/DetectionSetup.tsx#L363), [run validation](../src/app/api/runs/route.ts#L135) | Omit prerequisites one by one; single-target/multi-label paths return clear outcomes | U/O |
| PR-026 | WF-004 | Aggregate controls edit target/siblings, preamble, inclusion and support members | [ProductionModePanel](../src/components/DetectionSetup.tsx#L3850) | Toggle/add/remove members; check preview order and enabled/target/support semantics | U/O |
| PR-027 | WF-004 | Frozen versus structured target and sibling/config edits determine replication provenance | [productionMirror tests](../tests/productionMirror.test.ts#L32), [productionMirror](../src/lib/productionMirror.ts) | Exercise target-only, sibling, preamble and parameter edits; compare exact/modified results | U/O |
| PR-028 | WF-004 | Admin refresh updates catalog; saved snapshots/versions remain frozen and drift is displayed | [ProductionContexts](../src/components/AdminPrompts.tsx#L311), [catalog persistence](../src/lib/services/contextCatalog.ts#L78) | With stub catalogs, refresh revision; saved snapshot unchanged and drift visible | U/O |
| PR-029 | WF-004 | Catalog compilation depends on configured/sibling ai-services and Python; snapshot uses cached context | [compiler integration](../src/lib/services/contextCatalog.ts#L20), [snapshot route](../src/app/api/admin/contexts/snapshot/route.ts#L49) | Isolated fixture: missing compiler/context produces explicit error; no adjacent repo execution in baseline | U/O |
| PR-030 | WF-004 | Aggregate single-target presence semantics differ from multi-label per-label scoring | [types](../src/types/index.ts#L130), [aggregate tests](../tests/aggregateCompile.test.ts#L41), [run mode](../src/app/api/runs/route.ts#L155) | Omit target vs emit siblings; verify per-image/per-label output and metric denominators | U/O |
| PR-031 | WF-005 | Setup quick test accepts uploaded images for diagnostic inference separately from saved evaluation runs | [Setup](../src/components/DetectionSetup.tsx#L4465), [quick-test route](../src/app/api/runs/quick-test/route.ts) | Synthetic upload: inspect outputs, error/limit cases and whether any durable evidence is saved | U/O |

## Datasets, ingest, identity and splits

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-032 | WF-006 | Saved datasets load globally, auto-select initially, and load items/flags on selection | [SavedDatasets loading](../src/components/SavedDatasets.tsx#L93) | Empty/populated list and rapid selection changes show only the selected dataset's items | U/O |
| PR-033 | WF-006 | Dataset metadata supports name, detection association, split and taxonomy changes | [metadata editing](../src/components/SavedDatasets.tsx#L1365) | Save/reload each field; check dependent inference/annotation views refresh | U/O |
| PR-034 | WF-006 | Dataset item data supports image refs, descriptions, binary/multi-label truth and tags; active SavedDatasets loads/manages items | [SavedDatasets](../src/components/SavedDatasets.tsx#L93), [DatasetItem](../src/types/index.ts#L202) | Edit supported fields in active UI; roundtrip including blank/cleared values; do not assume every typed field has a control | U/O |
| PR-035 | WF-006 | DORMANT SOURCE ONLY: unmounted DatasetManager CSV parser expects exact image_id,image_url,ground_truth_label header and binary rows; not an active-shell capability | [legacy parseCsvManifest](../src/components/DatasetManager.tsx#L910), [active shell](../src/app/page.tsx#L361) | First confirm whether CSV ingest is desired; only test/reactivate parser under an approved change contract | U/O |
| PR-036 | WF-006 | DORMANT SOURCE ONLY: legacy CSV parser sanitizes IDs; current-shell reachability was not found | [legacy normalization](../src/components/DatasetManager.tsx#L916), [active shell](../src/app/page.tsx#L361) | If retained/reactivated, specify collision policy using inputs normalizing to the same ID; not a current reproduced issue | U/O |
| PR-037 | WF-006 | Saved item order can be sorted by image ID or ground truth, in both directions | [sort controls](../src/components/SavedDatasets.tsx#L183), [sort tests](../tests/imageIdSort.test.ts) | Check numeric suffix ordering, null labels and reverse order | U/O |
| PR-038 | WF-006 | Saved datasets support appending uploaded/dropped images and exporting contents | [upload surface](../src/components/SavedDatasets.tsx#L2837), [export](../src/app/api/datasets/export/route.ts) | Append synthetic image refs; export and compare identifiers/labels/tags | U/O |
| PR-039 | WF-007 | Parent/linked annotation children are distinct from split children via split_parent_id | [grouping logic](../src/components/SavedDatasets.tsx#L249), [Dataset](../src/types/index.ts#L181) | Create fixture with both relationships; inspect grouping and available actions | U/O |
| PR-040 | WF-007 | Assignment/duplication accepts annotators and label/segment reset options | [assignment schemas](../src/lib/schemas.ts#L238), [dataset actions](../src/app/api/datasets/route.ts) | Duplicate/reset and preserve variants; ensure originals and assignment relations are correct | U/O |
| PR-041 | WF-007 | Split creation validates images/truth and separates iteration, golden and held-out data | [split creation](../src/app/api/datasets/route.ts#L266), [UI splitRowsForAutoSplit](../src/components/SavedDatasets.tsx#L3341) | Compare UI-requested counts and API-generated ratios on tiny/imbalanced datasets | U/O |
| PR-042 | WF-007 | API automatic ratios are 50/20/30; generated split records are independently hashed and finalized | [split ratios](../src/app/api/datasets/route.ts#L332), [split persistence](../src/app/api/datasets/route.ts#L374) | Inspect counts/hash/parent/QA status; confirm intentional QA shortcut before endorsing it | U/O |
| PR-043 | WF-007 | Multi-label splitting uses stratification; binary and set-valued truth follow different validation paths | [GT validation](../src/app/api/datasets/route.ts#L312), [stratification tests](../tests/multiLabelStratify.test.ts) | Check every item exactly once, ratios/rare labels and mixed-input policy | U/O |
| PR-044 | WF-006 | Merge preview requires at least two labeled source detections, groups by frame URI, and reports label gaps/conflicts | [merge preview](../src/app/api/datasets/route.ts#L178), [merge UI](../src/components/MergeDatasets.tsx#L208) | Overlapping frame fixtures show correct union, source coverage and conflicts | U/O |
| PR-045 | WF-006 | Merge UI describes present-wins resolution and permits held-out split choice | [merge wording](../src/components/MergeDatasets.tsx#L309), [split selector](../src/components/MergeDatasets.tsx#L464) | Compare conflicting labels and selected split in resulting dataset; confirm policy with owner | U/O |
| PR-046 | WF-006 | Detection-less datasets use default attributes; live tag clears differ from backfill skip-empty behavior | [taxonomy defaults](../src/lib/repositories/datasetRepository.ts#L79), [tag sync](../src/lib/repositories/datasetRepository.ts#L8) | Compare detection-bound defaults, reorder-only edits, explicit clears and backfill | U/O |

## Annotation and QA

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-047 | WF-008 | Annotation has My Datasets/Flags/Performance tabs and status work filters | [MyWork filters](../src/components/MyWork.tsx#L87), [filter mapping](../src/components/MyWork.tsx#L2303) | Check underlying QA statuses for each visible category and archived visibility | U/O |
| PR-048 | WF-008 | Opening work loads items/flags; archived work additionally loads correction history | [openAnnotationView](../src/components/MyWork.tsx#L2223) | Compare active/archived fixtures, including failed history request | U/O |
| PR-049 | WF-008 | Dirty description notes save on item navigation/unmount using keepalive update | [note cleanup](../src/components/MyWork.tsx#L844), [saveNote](../src/components/MyWork.tsx#L916) | Change note, navigate rapidly/leave; verify persisted final text and visible failure | U/O |
| PR-050 | WF-008 | Label/attribute edits use optimistic updates and attempted failure rollback | [saveItem](../src/components/MyWork.tsx#L1000) | Delay/reorder/reject writes; confirm displayed and persisted final value match | U/O |
| PR-051 | WF-008 | Annotation supports opening/resolving item flags and displays request errors | [flag handlers](../src/components/MyWork.tsx#L1100) | Create/resolve flag; check error, counts and QA queue handoff | U/O |
| PR-052 | WF-008 | Submission requires an allowed source status and every item labeled | [submission gate](../src/app/api/qa/route.ts#L380) | Incomplete/wrong-status submission rejects; complete allowed submission succeeds | U/O |
| PR-053 | WF-009 | QA has Pipeline/Flags/Sampling/Discrepancies/Performance views and active-tab refresh | [QA tabs](../src/components/QualityAssurance.tsx#L93), [refresh](../src/components/QualityAssurance.tsx#L160) | Visit every view; update elsewhere, return and inspect stale selection/count behavior | U/O |
| PR-054 | WF-009 | Pipeline drag/drop and server updates enforce allowed status transitions | [handleDrop](../src/components/QualityAssurance.tsx#L381), [API transition check](../src/app/api/qa/route.ts#L414) | Valid/invalid moves agree across UI and direct synthetic API calls | U/O |
| PR-055 | WF-009 | QA can assign annotators and link datasets | [assignment/link handlers](../src/components/QualityAssurance.tsx#L431), [schemas](../src/lib/schemas.ts#L187) | Assign/unassign/link; check duplicate/self/missing target handling and refresh | U/O |
| PR-056 | WF-009 | Sampling supports random/stratified selection, review outcomes and attempt history | [sample schemas](../src/lib/schemas.ts#L200), [history](../src/components/QualityAssurance.tsx#L2669) | Fixed synthetic sample: review all outcomes and inspect attempt-specific history | U/O |
| PR-057 | WF-009 | Latest fully reviewed sampling attempt below 90% needs override reason for approval | [approval rule](../src/app/api/qa/route.ts#L440) | Below/at/above threshold, incomplete/no samples and reason/no-reason branches | U/O |
| PR-058 | WF-009 | Revision note is stored on needs_revision and cleared on annotation/submission | [revision handling](../src/app/api/qa/route.ts#L481), [return UI](../src/components/SavedDatasets.tsx#L3488) | Send back with note, reopen, resubmit; inspect what history remains available | U/O |
| PR-059 | WF-010 | Parent finalization requires children approved; normal conflicts require resolutions | [finalize_parent](../src/app/api/datasets/route.ts#L942), [resolution schema](../src/lib/schemas.ts#L254) | Unapproved child/unresolved conflict blocks; approved resolved children finalize correctly | U/O |
| PR-060 | WF-010 | Discovery reconciliation is attribute-oriented and approved children can auto-finalize parent | [Discovery merge](../src/app/api/datasets/route.ts#L959), [auto-finalize](../src/app/api/qa/route.ts#L466) | Compare normal/Discovery data; last-child approval triggers one complete merge | U/O |
| PR-061 | WF-010 | QA parent eligibility query requires two approved children and excludes finalized/archived/Discovery parents | [eligible parent listing](../src/app/api/qa/route.ts#L51) | Compare listing vs finalize action for one/two children and special statuses | U/O |
| PR-062 | WF-009 | Shared status helpers derive parent status from child ordering and define read-only/edit sets | [status helpers](../src/lib/statusConstants.ts#L47) | Check empty/mixed children, archived/finalized and annotation aliases | U/O |

## Inference, run lifecycle and metrics

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-063 | WF-011 | Run Inference loads detection prompts and top-level datasets, excluding linked annotation children | [run selection](../src/components/BuildDataset.tsx#L83) | Verify child/split/global dataset eligibility and prompt fallback behavior | U/O |
| PR-064 | WF-011 | Selecting saved dataset loads working rows; Save and Run are separate UI modes | [working rows](../src/components/BuildDataset.tsx#L120), [run start](../src/components/BuildDataset.tsx#L249) | Check which mode persists dataset vs run; report side effects precisely | U/O |
| PR-065 | WF-011 | Run creation validates prompt/dataset/detection existence; held-out execution requires explicit opt-in | [run prerequisites](../src/app/api/runs/route.ts#L83), [RunCreateSchema](../src/lib/schemas.ts#L49) | Missing/mismatched IDs and held-out false/true cases, using isolated fixtures | U/O |
| PR-066 | WF-011 | Run stores prompt snapshot, dataset hash and mode-dependent decoding parameters | [Run type](../src/types/index.ts#L220), [snapshot creation](../src/app/api/runs/route.ts#L166) | Compare persisted values with executed request, then edit source to test historical reads | U/O |
| PR-067 | WF-011 | New run starts running with zero progress; prediction writes include parse/retry diagnostics | [run creation](../src/lib/repositories/runRepository.ts#L67), [prediction insert](../src/lib/repositories/runRepository.ts#L93) | Isolated execution fixture stores correct initial and per-item metadata/counts | U/O |
| PR-068 | WF-011 | UI polls progress to completed/failed/cancelled, permits cancel and HIL handoff | [poll/cancel](../src/components/BuildDataset.tsx#L268), [HIL entry](../src/components/BuildDataset.tsx#L552) | Cancel before/during completion; no false completed state, handoff keeps correct run | U/O |
| PR-069 | WF-011 | Prediction reads enrich results using run dataset and image ID | [prediction join](../src/lib/repositories/runRepository.ts#L8) | Duplicate/normalized IDs and revised items do not silently attach another image's truth | U/O |
| PR-070 | WF-011 | Provider selection uses claude/gemini prefixes; other model strings map to OpenAI | [provider mapping](../src/lib/models.ts#L1), [inference dispatch](../src/lib/inference/index.ts) | Supported and unknown IDs route predictably; confirm unknown-model policy before changing | U/O |
| PR-071 | WF-011 | Metrics use corrected labels, exclude inference-call failures, and support overlapping segments/per-label summaries | [metric tests](../tests/metrics.test.ts#L29), [metric type](../src/types/index.ts#L280) | TP/FP/FN/TN fixtures with failures, null GT, correction and multi-label rows have agreed denominators | U/O |
| PR-072 | WF-011 | Threshold evaluation emits precision/recall/F1 failures; "Recompute All vs Current GT" re-scores against current dataset GT (no commit, no inference) | [thresholds](../src/lib/metrics.ts#L114), [bulk recompute](../src/app/api/runs/recompute-all/route.ts#L10) | Intent CONFIRMED PDEC-007: recompute is comparison-only and must preserve checkpoints, original predictions and audit history; clearing `corrected_label` is in-memory only. Gap FUP-006 (recompute overwrites per-run GT snapshot), FUP-007 (label GT basis/scope) | C/O |

## HIL, feedback and iterative improvement

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-073 | WF-012 | HIL selects completed runs and offers table/image views and prediction/label filters | [HIL state/loading](../src/components/HilReview.tsx#L42) | Mixed run statuses; each filter/view yields consistent same-run evidence | U/O |
| PR-074 | WF-012 | HIL updates correction, GT, error tag and reviewer note; explicit GT and structured attribute edits save to the dataset at edit time | [HilUpdateSchema](../src/lib/schemas.ts#L64), [HIL handler](../src/app/api/hil/route.ts#L10), [attr save](../src/app/api/datasets/route.ts#L850) | Explicit GT/attribute edits persist on save (no promote step); `corrected_label` stays distinct and split-dependent. Intent CONFIRMED PDEC-006; attribute-audit gap FUP-005, metric effects INV-001 | C/O |
| PR-075 | WF-012 | Review flags can attach to prediction or dataset item and retain resolution details | [flag schema](../src/lib/schemas.ts#L128), [HIL flags](../src/components/HilReview.tsx#L1978) | Flag/resolve/dismiss in HIL; inspect Annotation/QA visibility and allowed resolution actions | U/O |
| PR-076 | WF-012 | GT correction history is journaled per run (append-only; survives recompute) and retrievable | [GT corrections route](../src/app/api/hil/gt-corrections/route.ts), [record](../src/lib/repositories/reviewRepository.ts#L127), [GroundtruthCorrection](../src/types/index.ts#L379) | Intent CONFIRMED PDEC-009: per-run corrected value preserved and comparable to current GT; cross-run flip-flop visible. Gap FUP-009 (current query is single-run, no current-GT join) | C/O |
| PR-077 | WF-012/013 | Standalone HIL finalize to be absorbed into Start AI Prompt Iteration | [finalize guard](../src/app/api/hil/finalize/route.ts#L46) | Intent SUPERSEDED: no separate finalize action (PDEC-004). One Start action validates, checkpoints, records, and starts. Implementation gap FUP-001 | S/O |
| PR-078 | WF-012/013 | Checkpoint records run-linked evidence + metrics in version history | [finalize entry](../src/app/api/hil/finalize/route.ts#L68) | Intent CONFIRMED PDEC-005: checkpoint must bundle immutable reviewed evidence + metrics + run + prompt version + eval config + GT basis; survive startup failure. Gaps FUP-002 (capture), FUP-004 (re-checkpoint) | C/O |
| PR-079 | WF-013 | Prompt Feedback uses selected run, post-review metrics and selectable improvement suggestions | [PostHilMetrics](../src/components/PostHilMetrics.tsx#L13), [suggestion save](../src/components/PostHilMetrics.tsx#L288) | Change selected run and accept/reject suggestions; derived version cites correct source | U/O |
| PR-080 | WF-013 | Start AI Prompt Iteration creates the checkpoint and starts from it; reuses active job and returns queued work | [iteration guards/enqueue](../src/app/api/hil/prompt-iteration/route.ts#L113) | Intent CONFIRMED PDEC-004/005/008: single action, no separate finalize click; duplicate submit/retry must not duplicate jobs or checkpoints; **gated on coverage** (every image has GT; every FP/FN has a reviewer note). Gaps FUP-001 (consolidate), FUP-003 (iterator must use saved checkpoint), FUP-008 (coverage gate). Edge cases OPEN-003 | C/O |
| PR-081 | WF-013 | Iteration evaluates objective eligibility separately from score and uses group-aware splits | [eligibility](../src/lib/promptIteration/metrics.ts#L53), [split logic](../src/lib/promptIteration/metrics.ts#L336), [tests](../tests/promptIterationMetrics.test.ts) | High score failing constraints cannot win; duplicate groups never cross tuning/holdout | U/O |
| PR-082 | WF-013 | Reviewed-row packaging uses corrected truth and reviewer notes; candidate/report helpers preserve prompt fields | [workflow helper tests](../tests/promptIterationWorkflow.test.ts#L45) | Correction/note precedence, user addendum roundtrip and no-promotion report are explicit | U/O |
| PR-083 | WF-013 | Discarding completed iteration round deletes candidate prompt/runs/notes and reselects remaining best | [discard/reselection](../src/app/api/hil/prompt-iteration/route.ts#L181) | Discard current best and last round; source survives and new best satisfies intended objective | U/O |
| PR-084 | WF-013 | Iteration job state is persisted but worker starts asynchronously in the local process | [enqueue/start](../src/app/api/hil/prompt-iteration/route.ts#L145), [queue interface](../src/lib/services/interfaces.ts#L21) | Isolated process-stop/cancel test leaves truthful recoverable job status | U/O |

## Comparison, evaluation and approval

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-085 | WF-014 | Comparison uses selected prompts, dataset and label with completed runs | [comparison controls](../src/components/PromptCompare.tsx#L397), [run coverage check](../src/lib/promptCompare/synthesize.ts#L333) | Intent CONFIRMED PDEC-010: ground truth held constant (same dataset revision/GT required, FUP-010); add model/thinking-level mode via run-level selection over existing completed runs only (FUP-011) | C/O |
| PR-086 | WF-014 | Synthesis selects latest completed run per prompt/dataset | [run selection](../src/lib/promptCompare/synthesize.ts#L34) | Intent CONFIRMED PDEC-010: "latest per (prompt, dataset)" is insufficient — selection must key on specific runs (model + thinking level) to support model/thinking-level comparison (FUP-011) and must verify GT equivalence (FUP-010) | C/O |
| PR-087 | WF-014 | Compare jobs support progress, terminal success/failure and cancellation | [compare execution](../src/lib/promptCompare/synthesize.ts#L293), [terminal handling](../src/lib/promptCompare/synthesize.ts#L589) | Fail/cancel each phase; no stale success overwrites terminal cancellation | U/O |
| PR-088 | WF-015 | Held-Out Eval runs explicit evaluation and exposes progress, prior results and CSV export | [eval start](../src/components/HeldOutEval.tsx#L73), [CSV export](../src/components/HeldOutEval.tsx#L190) | Run synthetic held-out fixture; inspect completion/history/export without auto-approval | U/O |
| PR-089 | WF-015 | Approval in Setup requires prompt ownership and a completed held-out run normally meeting thresholds | [approval gate](../src/app/api/detections/route.ts#L103) | Intent CONFIRMED PDEC-013: approval becomes a dated, retained decision record (version + eval + override reason + timestamp + actor), not a single mutable pointer; stays distinct from deployment. Gap FUP-013 | C/O |
| PR-090 | WF-015 | Override reason can waive metric thresholds, but not absence of completed held-out evidence | [override rule](../src/app/api/detections/route.ts#L146) | Reason with zero completed eval rejects; below-threshold completed eval follows recorded override | U/O |
| PR-091 | WF-015 | Held-Out UI describes approval as a manual Setup action, not deployment | [approval guidance](../src/components/HeldOutEval.tsx#L428) | Evaluation completion alone does not publish/change selected approved pointer | U/O |

## Logs, administration, flags and shared contracts

| ID | WF | Observed behavior | Evidence | Proposed acceptance / verification | Status |
| --- | --- | --- | --- | --- | --- |
| PR-092 | WF-016 | Detection dashboard expands per-detection run logs and loads/caches detail by run ID | [detail cache](../src/components/DetectionDashboard.tsx#L20), [log rendering](../src/components/DetectionDashboard.tsx#L557) | Expand multiple runs; results/feedback remain associated with right IDs after refresh | U/O |
| PR-093 | WF-016 | Dashboard exports CSV with metadata/metrics/descriptions/predictions and JSON run logs | [CSV export](../src/components/DetectionDashboard.tsx#L153), [JSON export](../src/components/DetectionDashboard.tsx#L290) | Compare dashboard and API exports for same synthetic run, GT revision and provenance | U/O |
| PR-094 | WF-016 | Detection deletion hard-deletes and cascades prompts/runs/predictions/notes/corrections (not datasets) and reports failure | [deleteDetection](../src/components/DetectionDashboard.tsx#L113), [cascade](../src/lib/repositories/detectionRepository.ts#L112), [delete API](../src/app/api/detections/route.ts#L194) | Intent CONFIRMED PDEC-012: hard-delete + cascade is intended; datasets and current GT/attribute labels unaffected. Fix delete-UI wording that claims datasets are cascaded (FUP-014) | C/O |
| PR-095 | WF-017 | Admin edits templates, context settings, ordered members/annotators and image limits | [AdminPrompts](../src/components/AdminPrompts.tsx#L83), [settings API](../src/app/api/admin/prompts/route.ts) | Save/reload settings; check consumer refresh, invalid limits and default fallback | U/O |
| PR-096 | WF-017 | Attribute layouts are separately persisted shared display settings | [layout API](../src/app/api/attribute-layouts/route.ts), [layout repository](../src/lib/repositories/attributeLayoutRepository.ts) | Save/reload layout; verify missing/new taxonomy attributes remain accessible | U/O |
| PR-097 | WF-017 | Administrative split-label backfill supports up/down/both reconciliation | [backfill API](../src/app/api/admin/backfill-split-labels/route.ts#L8) | Synthetic parent/split disagreement and blanks have documented conflict precedence | U/O |
| PR-098 | WF-018 | Notifications load for chosen annotator; dismissal removes local notification | [MyWork notifications](../src/components/MyWork.tsx#L2204), [notification API](../src/app/api/notifications/route.ts) | Change annotator, dismiss, reload and simulate failure; confirm recipient/state semantics | U/O |
| PR-099 | WF-018 | Performance surfaces use annotator/dataset metrics and historical snapshots | [metric types](../src/types/index.ts#L475), [metrics routes](../src/app/api/qa/metrics/route.ts), [history](../src/app/api/qa/metrics/history/route.ts) | Trace metric denominator/time window to reviews/corrections; check missing-data display | U/O |
| PR-100 | WF-018 | Correction accounting distinguishes QA/discrepancy corrections and self-revision | [correction tests](../tests/annotatorCorrections.test.ts), [deriveImageCorrection](../src/lib/annotatorCorrections.ts) | Repeated rounds/attribute add-remove/self-fix fixtures reconcile with displayed totals | U/O |
| PR-101 | WF-018 | Flags are available in dataset, prediction, Annotation and QA views | [FlagsQueue](../src/components/shared/FlagsQueue.tsx), [flag API](../src/app/api/review-flags/route.ts) | Same issue across surfaces has consistent resolution/actor/count and refresh | U/O |
| PR-102 | WF-001 | API helpers implement validation/pagination and optional in-memory rate limiting | [API helpers](../src/lib/api.ts#L5), [schemas](../src/lib/schemas.ts) | Invalid JSON/schema/page inputs return explicit errors; configured limiter behavior is distinguishable | U/O |
| PR-103 | WF-011 | Local SQLite schema initialization/migrations supply persistence outside tracked source | [DB source](../src/lib/db.ts#L31), [QA migrations](../src/lib/db.ts#L838), [runtime notes](../README.md) | In isolated temporary DB only, migrate twice and check no unintended reset/data loss | U/O |
| PR-104 | WF-011 | Inference/authoring assistance supports provider requests distinct from local labeling workflows | [provider list](../src/lib/models.ts#L1), [assist API](../src/app/api/gemini/detection-assist/route.ts), [dataset description](../src/app/api/gemini/describe-dataset/route.ts) | Stub provider success/error/timeout; no credential/network requirement for local browsing/labeling | U/O |

## Review and maintenance

No rows are owner-confirmed merely because this file was requested. Review by
workflow, starting with the [diagnostic questions](questions.md). Confirmation
must record a PDEC/answer/date; changed behavior requires a separate approved PC.
Use [decisions](decisions.md) for rationale and [state](state.md) for progress.
Prototype IDs are intentionally distinct from the production package's FR/US IDs.
