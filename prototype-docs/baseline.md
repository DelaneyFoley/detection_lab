# Whole-prototype baseline inventory

## Evidence boundary

- Baseline date: 2026-10-27.
- Baseline commit: `73e0049d09df6c11226c53d3af87c93eaedbfdd3`.
- Worktree was clean at inventory start. Setup adds documentation and agent
  customization only; no application change is authorized by this baseline.
- Method: static source inspection across app navigation/components, API routes,
  repositories/services, schemas/types and existing test definitions.
- No browser journeys, app server, live APIs, provider inference, runtime DB,
  uploaded/seed records, image/spreadsheet contents or adjacent repo were read/run.
- This is a whole-capability inventory with candidate requirements, NOT a signed
  specification, exhaustive field/action proof, or a production readiness review.
- Any test execution/results are recorded separately in [state](state.md).

## Product and people

Observed purpose: configure detections and versioned visual-model prompts,
prepare/label image datasets, run inference, review/correct results, compare and
iterate prompts, and evaluate against held-out data.

The UI contains authoring, annotator, reviewer/QA and administrator task surfaces.
These are observed activities, not proof of distinct authenticated roles or
permission enforcement. Who should own each action is an intent question.
The prototype has binary and multi-label pathways, plus development and
production-mirror execution. "Production" mode here means an aggregate prompt
replication pathway, not deployment/publication to a live service.

## Navigation and surface inventory

The [shell](../src/app/page.tsx#L17) exposes six guided tabs and five management
tabs. Panels remain mounted and are hidden/shown rather than URL-routed.

| Surface | Entry, capabilities and dependencies | Main evidence |
| --- | --- | --- |
| Detection Setup | Create/edit detections; prompt creation/version/group/note management; assist, replication, quick test, approval | [DetectionSetup](../src/components/DetectionSetup.tsx#L125) |
| Run Inference | Choose prompt and saved dataset, load rows, save/run, poll/cancel, inspect results and enter HIL | [BuildDataset](../src/components/BuildDataset.tsx#L25) |
| HIL Review | Choose completed run; table/image inspection, filters, corrections, flags, finalization/iteration surfaces | [HilReview](../src/components/HilReview.tsx#L42) |
| Prompt Feedback | Selected-run metrics, suggestions and candidate prompt creation | [PostHilMetrics](../src/components/PostHilMetrics.tsx#L13) |
| Prompt Compare | Select prompt versions/dataset/label; compare runs and request synthesis | [PromptCompare](../src/components/PromptCompare.tsx#L20), [synthesis panel](../src/components/shared/PromptCompareSynthesisPanel.tsx) |
| Held-Out Eval | Held-out execution, progress/results/export, prior runs; directs approval to Setup | [HeldOutEval](../src/components/HeldOutEval.tsx#L73) |
| Detections & Logs | Detection/run history and inspection | [DetectionDashboard](../src/components/DetectionDashboard.tsx) |
| Datasets | Saved dataset/item/metadata management, upload/append, assign/split/merge/archive/export | [SavedDatasets](../src/components/SavedDatasets.tsx#L20), nested [MergeDatasets](../src/components/MergeDatasets.tsx#L53) |
| Quality Assurance | Pipeline, Flags Queue, QA Sampling, Discrepancies, Performance Metrics | [QualityAssurance](../src/components/QualityAssurance.tsx#L93) |
| Admin | Template Governance, Production Contexts, ordered members/annotators and image limits | [AdminPrompts](../src/components/AdminPrompts.tsx#L83) |
| Annotation | My Datasets, Flags, Performance Metrics; assignment/status-oriented work filters | [MyWork](../src/components/MyWork.tsx#L87) |
| Shared/auxiliary | Feedback/toasts, flags queue, image preview, metric/decision badges, attribute layouts, prompt iteration/synthesis panels, global error reset | [shared components](../src/components/shared), [global error](../src/app/global-error.tsx) |

### Entry and state

- Header: active detection, model selector, optional API key (memory-only), and
  Create New Detection. A new workflow clears the selected detection and opens
  Setup. Management tabs can be used without selecting a detection.
- Guided tabs require a started workflow; HIL/Feedback/Compare/Held-Out additionally
  require a detection. Individual panels apply further prerequisites.
- [Shared store](../src/lib/store.ts#L3): tab/detection/model/API key, per-detection
  selected prompt and run, pending dataset/subview navigation and refresh counter.
  No browser persistence is established by this store. Reload continuity is not
  the same as stored database records.
- Mounted panels retain component-local forms/filters while hidden. Cross-tab
  refresh depends on explicit counter/effects, not automatic universal invalidation.
  Mounting is still subject to the shell's started-workflow/detection gates;
  retaining local state is not guaranteed across a gate-driven unmount.
- Errors include local validation/status messages, model/template fallbacks and
  global reset. Consistent recoverable errors across every view are NOT verified.

## Workflow map

Every workflow below has requirements in [the register](requirements.md).
These are source-derived paths; acceptance is proposed, not executed.

| ID | Journey and prerequisites | Result/handoff | Ambiguity or recovery boundary |
| --- | --- | --- | --- |
| WF-001 | Open app -> select/create detection -> choose guided/management view | Shared workspace context | Reload loses transient context; hidden panels retain local state |
| WF-002 | Setup -> create/edit detection identity, policy, rubric, taxonomy, thresholds | Detection consumed by prompts/datasets/runs | Required/default fields vs owner intent; edit impacts existing versions |
| WF-003 | Setup -> blank/assisted/replicated prompt -> inspect -> save version/group/notes | Prompt consumed by inference/comparison/evaluation | Human acceptance, model/config precedence, version lineage/deletion |
| WF-004 | Setup/Admin -> context catalog -> frozen snapshot/composition -> prompt | Production-mirror aggregate execution | Local external integration, drift, target vs sibling changes |
| WF-005 | Setup -> upload quick-test images -> execute diagnostic preview | Ephemeral authoring feedback | Not equivalent to durable evaluation/approval evidence |
| WF-006 | Datasets -> upload/append/merge -> select/edit items/metadata -> export | Reusable datasets for annotation/inference | Accepted active inputs, duplicate IDs, binary vs multi-label truth |
| WF-007 | Datasets -> split/duplicate/assign -> annotate child work | Parent/child/link/split relations | Split vs annotation copy identity; which datasets are eligible to run |
| WF-008 | Annotation -> assigned work -> label/tag -> flag -> submit/revise | Submitted datasets enter QA | Completion vs partial save, revision semantics, permissions/identity |
| WF-009 | QA pipeline -> sample -> review -> approve/return | Reviewed child data | Counts, sample thresholds, QA bypass/override meaning |
| WF-010 | QA -> compare children -> resolve discrepancies -> merge/finalize parent | Finalized ground truth and archived children | Which conflicts block; finalization/reopen consequences |
| WF-011 | Run Inference -> prompt + top-level dataset + model -> run | Persisted run/predictions -> HIL/logs | Config precedence, progress/failure/cancel and restart recovery |
| WF-012 | HIL -> completed run -> corrections/flags; explicit GT/attribute edits save to dataset at edit time | Reviewed evidence -> metrics; "Recompute All vs Current GT" is comparison-only | Checkpoint vs canonical GT (PDEC-006/007); per-run GT snapshot overwritten by recompute (FUP-006); unaudited attribute edits (FUP-005) |
| WF-013 | Prompt iteration -> **Start AI Prompt Iteration** (one action: validate -> immutable checkpoint -> record in history -> start) -> candidates/evaluation | Candidate versions/rounds -> Setup/Compare | Finalization consolidated (PDEC-004/005); iterator must use saved checkpoint not live rows (FUP-003); eligibility/discard still PQ-014 |
| WF-014 | Compare -> selected prompts/dataset/label -> latest completed runs -> synthesis | Comparison/report/job | Dataset revision/config comparability, cancellation and reproducibility |
| WF-015 | Held-Out -> explicit eval run -> thresholds -> Setup approval | Approved prompt pointer or reasoned override | Selection vs publication, stale evidence, caller-held-out opt-in |
| WF-016 | Detections & Logs -> inspect history/results -> export/delete actions | Run inspection/cross-tab review | Provenance, destructive actions and retention |
| WF-017 | Admin -> templates/context/members/limits; shared layouts | Configuration consumed by authoring and review | Defaults, refresh behavior, source authority |
| WF-018 | Flags, notifications, performance/history across Annotation/QA/HIL | Follow-up work and review accountability | Unified vs separate queues, recipient/actor semantics, metric denominators |

### Cross-tab coherence constraints to confirm

1. Detection + prompt selections must not silently refer to a different
   detection after navigation or deletion.
2. Dataset ID, revision/hash, split role and label semantics must remain
   interpretable across ingest, annotation, QA, inference, HIL, comparison/export.
3. Prompt version, composition/snapshot, model and decoding parameters jointly
   determine a run; a display name alone cannot establish equivalence.
4. Human correction, dataset truth and historical run truth may differ. The
   desired update/recompute/history policy is unresolved, not assumed.
5. Selection/approval of a prompt is not deployment to production.
6. Finalized, approved, submitted and completed apply to different objects; a
   completed run is not automatically approved data or a finalized HIL review.

## Entity and lifecycle inventory

Evidence: [types](../src/types/index.ts), [DB source](../src/lib/db.ts#L31),
[repositories](../src/lib/repositories), [schemas](../src/lib/schemas.ts).

| Entity | Identity/relationships and stored meaning |
| --- | --- |
| Detection | ID/code/category, policy/rubric/taxonomy/thresholds, approved prompt pointer |
| PromptVersion | Detection ID, version label, structured/rendered prompts, model/decoding config, notes, lineage, regression result, mode/context/composition/snapshot |
| ProductionSnapshot / Composition | Frozen context source/revision/checksum/model/members vs editable aggregate working copy; exact/modified replication provenance |
| Dataset / DatasetItem | Optional detection, split/hash/QA/assignment/link/parent/taxonomy; items contain image refs, binary/multi-label truth, attributes/descriptions |
| Run / Prediction | Detection/prompt/dataset IDs, prompt snapshot, dataset hash, decoding params, status/progress/metrics; output/raw response/parse diagnostics/corrections/labels |
| ReviewFlag / GroundtruthCorrection | Dataset item or prediction issue; resolution, reviewer, old/new labels/attributes and correction history |
| QA sample / log / discrepancy resolution | Sample method/status/outcome, actors, review/status actions and reconciled annotation differences |
| PromptIteration job/round / compare job | Source references, objective/constraints, queued/running/terminal state, reports/logs, candidates and selected result |
| VersionNoteEntry / prompt group metadata | Version creation/edit/HIL/iteration narrative, notes, grouping/rename metadata |
| Notifications / metrics snapshots / settings | Recipient/dismissal, annotator/dataset/period metrics, templates/limits/layouts/context caches |

State vocabularies:

- Binary decision: `DETECTED`, `NOT_DETECTED`; parse/call failure is distinct from
  a successful negative decision.
- Dataset splits: `MASTER`, `GOLDEN`, `ITERATION`, `HELD_OUT_EVAL`, `CUSTOM`,
  `DISCOVERY`.
- [QA transitions](../src/lib/schemas.ts#L160): draft -> assigned ->
  in_annotation -> submitted -> in_qa -> approved OR needs_revision; revision
  can return to annotation/submission. Approved can reenter QA. Finalized and
  archived have no manual transition out in that table. Legacy rejected maps
  forward; specialized endpoints may implement additional transitions.
- Run status: running/completed/cancelled/failed. Other jobs have queued states
  and may use different cancellation spelling; do not assume interchangeability.
- Prompt execution: DEVELOPMENT_MODE / PRODUCTION_MODE; provenance:
  exact_replication / modified_replication. Multi-label aggregate scoring differs
  from a single target with unscored siblings.

## API/interface inventory

Each link goes to the route implementation. Methods were checked against route
exports. Operation descriptions do not promise every action is allowed in every
lifecycle state.

| Route | Exported methods | Responsibility / main consumers |
| --- | --- | --- |
| [health](../src/app/api/health/route.ts) | GET | DB/app health |
| [datasets](../src/app/api/datasets/route.ts) | GET, POST, PUT, DELETE | Dataset/item CRUD, ingest and workflow actions |
| [datasets/export](../src/app/api/datasets/export/route.ts) | GET | Dataset projection/download |
| [detections](../src/app/api/detections/route.ts) | GET, POST, PUT, DELETE | Detection CRUD and approved-prompt gate |
| [prompts](../src/app/api/prompts/route.ts) | GET, POST, PUT, DELETE | Prompt-version CRUD |
| [prompts/groups](../src/app/api/prompts/groups/route.ts) | GET, PUT, DELETE | Group metadata |
| [prompts/groups/rename](../src/app/api/prompts/groups/rename/route.ts) | POST | Group rename |
| [prompts/compare-synthesize](../src/app/api/prompts/compare-synthesize/route.ts) | GET, POST, PUT, DELETE | Compare jobs/synthesis/cancellation |
| [runs](../src/app/api/runs/route.ts) | GET, POST, PUT | List/detail/create/cancel/update runs |
| [runs/export](../src/app/api/runs/export/route.ts) | GET | Run/prediction export |
| [runs/quick-test](../src/app/api/runs/quick-test/route.ts) | POST | Uploaded-image diagnostic inference |
| [runs/recompute-all](../src/app/api/runs/recompute-all/route.ts) | POST | Bulk metric recomputation |
| [qa](../src/app/api/qa/route.ts) | GET, POST, PUT | Pipeline, assignments, sampling, review, discrepancies and status |
| [qa/metrics](../src/app/api/qa/metrics/route.ts) | GET | Annotator performance |
| [qa/metrics/history](../src/app/api/qa/metrics/history/route.ts) | GET | Period snapshots/history |
| [qa/metrics/datasets](../src/app/api/qa/metrics/datasets/route.ts) | GET | Dataset-level performance |
| [hil](../src/app/api/hil/route.ts) | PUT, POST | Prediction corrections/feedback/recompute |
| [hil/gt-corrections](../src/app/api/hil/gt-corrections/route.ts) | GET, PATCH | Ground-truth correction history/update |
| [hil/finalize](../src/app/api/hil/finalize/route.ts) | GET, POST | Finalized HIL evidence |
| [hil/diagnose-note](../src/app/api/hil/diagnose-note/route.ts) | POST | Model-assisted diagnostic notes |
| [hil/prompt-iteration](../src/app/api/hil/prompt-iteration/route.ts) | GET, POST, PUT | Iteration jobs/rounds/discard |
| [review-flags](../src/app/api/review-flags/route.ts) | GET, POST, PUT, DELETE | Flag creation/resolution/history |
| [version-note-entries](../src/app/api/version-note-entries/route.ts) | GET, POST, PUT, DELETE | Version-note lifecycle |
| [notifications](../src/app/api/notifications/route.ts) | GET, PUT | Recipient notification/dismissal |
| [attribute-layouts](../src/app/api/attribute-layouts/route.ts) | GET, PUT | Persisted attribute display layout |
| [admin/prompts](../src/app/api/admin/prompts/route.ts) | GET, PUT | Shared templates/settings |
| [admin/contexts](../src/app/api/admin/contexts/route.ts) | GET, POST | Compiled production-context catalog/cache |
| [admin/contexts/snapshot](../src/app/api/admin/contexts/snapshot/route.ts) | GET, POST | Frozen context snapshot |
| [admin/backfill-split-labels](../src/app/api/admin/backfill-split-labels/route.ts) | POST | Administrative label backfill |
| [gemini](../src/app/api/gemini/route.ts) | POST | Model inference operation |
| [gemini/models](../src/app/api/gemini/models/route.ts) | POST | Model discovery |
| [gemini/describe-dataset](../src/app/api/gemini/describe-dataset/route.ts) | POST | Generated dataset description |
| [gemini/detection-assist](../src/app/api/gemini/detection-assist/route.ts) | POST | Assisted authoring |

## Verification inventory and limits

### Reachability correction and dormant source

The current shell mounts `SavedDatasets` for Datasets, `BuildDataset` for Run
Inference, and the `Annotation` export of `MyWork` for Annotation. `MergeDatasets`
is reachable inside SavedDatasets. **DatasetManager is not imported/mounted by
the current shell or other inspected components.** Its CSV parser and older
dataset controls are dormant/legacy source, not a current ingest capability.
PR-035/036 preserve that evidence with explicit dormant status pending owner
disposition; they do not establish current CSV support or a reachable collision.
The internal QA `finalized` subview type is also not a visible subtab; finalized
datasets are represented in pipeline/status surfaces.

Existing tests were inspected for declared scenarios. They primarily exercise
shared algorithms, not complete mounted UI/API/database workflows.

| Existing suite | Behavior supported by test definitions | Workflow links |
| --- | --- | --- |
| [metrics](../tests/metrics.test.ts) | Confusion metrics, corrected labels, call-failure exclusion, segments and per-label scoring | WF-011/012/015 |
| [aggregate compiler](../tests/aggregateCompile.test.ts) | Aggregate format, target presence, schema validation | WF-004/011 |
| [production mirror](../tests/productionMirror.test.ts) | Frozen/structured target, sibling edits, parameter changes, replication provenance | WF-003/004 |
| [multi-label stratification](../tests/multiLabelStratify.test.ts) | Counts/ratios, no duplication, label balancing, empty input | WF-006/007 |
| [annotator corrections](../tests/annotatorCorrections.test.ts) | Attribute/label corrections across QA/discrepancies, revisions, historical cases | WF-008/009/010/018 |
| [image ID sorting](../tests/imageIdSort.test.ts) | Numeric suffix ordering | WF-006/012 |
| [iteration metrics](../tests/promptIterationMetrics.test.ts) | Objectives/constraints, group-aware splits, eligibility and promotion | WF-013 |
| [iteration workflow helpers](../tests/promptIterationWorkflow.test.ts) | Reviewed-row packaging, prompt field roundtrip, regression helpers/report | WF-003/012/013 |

No existing end-to-end UI suite is identified in the eight test files.
No evidence here establishes browser behavior, API enforcement for every action,
restart recovery, real-data migration, provider compatibility or performance.
Runtime validation needing real data or model calls requires separate permission.

## Production-planning relationship

The existing [Detection Setup production package](../aidlc-docs/inception/milestones/detection-setup/README.md)
already contains owner-confirmed production decisions and draft requirements.
It is **not** the prototype intent baseline. Its state is DRAFT/BLOCKED pending
review and decisions. This setup does not change it, reapprove it, or expand its
milestone scope. Future production evidence refreshes can consume this inventory
and confirmed prototype decisions without automatically inheriting them.
