# Outstanding implementation work (follow-ups)

Confirmed prototype intent does **not** mean the code conforms. The items below
are the application changes and investigations required to make the
implementation match the decisions recorded in [decisions.md](decisions.md).
Nothing here is implemented or authorized by recording it. Each `FUP-###` must be
turned into a separately approved `PC-###` change contract before any code or
test is changed. Investigations (`INV-###`) and open questions (`OPEN-###`)
gather evidence or a decision first; they are not implementation approval.

Status legend: `OPEN` (not started), `IN_PC` (covered by an approved change
contract), `DONE` (implemented and verified), `SUPERSEDED`.

## Required application changes

| ID | Decision | Required change | Evidence / gap | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| FUP-001 | PDEC-004 | Make **Start AI Prompt Iteration** perform validate → checkpoint → record-in-history → start as one action; remove the standalone **Finalize HIL** button/label and its separate click. Preserve duplicate-job and duplicate-checkpoint guards. Add helper text. | Two separate POSTs today ([finalize/route.ts](../src/app/api/hil/finalize/route.ts#L46), gate at [prompt-iteration/route.ts](../src/app/api/hil/prompt-iteration/route.ts#L112)). | P1 | OPEN |
| FUP-002 | PDEC-005 | At click time, capture an **immutable** checkpoint **from the live rows** — reviewed evidence + metrics + run + prompt version + evaluation config + ground-truth basis; creation must succeed before iteration starts; preserve the checkpoint for retry if startup fails afterward. Pairs with FUP-003 (the iterator must then read this capture). | Finalize stores only an AI summary + `metrics_snapshot` in a version-note entry ([finalize/route.ts](../src/app/api/hil/finalize/route.ts#L68)); no frozen evidence/GT-basis bundle exists to read. | P1 | OPEN |
| FUP-003 | PDEC-005 | Make the iterator **read the frozen checkpoint** for the entire run instead of re-reading mutable live rows. Capturing a checkpoint at click time (FUP-002) is not enough on its own: the iterator must consume that captured evidence, otherwise edits made *after* Start — and throughout the multi-round async job — silently change the baseline/truth it tunes against (the "mid-run drift window"). | Orchestrator re-reads live `predictions` at job start and scores candidates against `finalized_ground_truth` derived from those mutable rows ([orchestrator.ts](../src/lib/promptIteration/orchestrator.ts#L196), [evaluation.ts](../src/lib/promptIteration/evaluation.ts#L84)). The job is fire-and-forget, so HIL edits or a Recompute All (which overwrites `predictions.ground_truth_label`, [reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L170)) during the run can shift the truth underneath it. Distinct from FUP-002 (capture) and FUP-004 (new checkpoint per Start). | P1 | OPEN |
| FUP-004 | PDEC-005 | Reassess the **one-finalize-per-run** restriction so subsequent intentional iteration starts create a new checkpoint on changed evidence while earlier checkpoints remain preserved. | Second finalize returns 409 ([finalize/route.ts](../src/app/api/hil/finalize/route.ts#L63)). | P2 | OPEN |
| FUP-005 | PDEC-006 | Add an **audit trail for structured attribute (`segment_tags`) edits**, to match the auditable history kept for GT-label corrections. | Attribute edit writes straight to `dataset_items` with no journal ([datasets/route.ts](../src/app/api/datasets/route.ts#L850)); GT edits journal to `groundtruth_corrections` ([reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L127)). | P2 | OPEN |
| FUP-006 | PDEC-007 | Preserve the per-run ground-truth snapshot / original run-time truth when recompute runs, while still refreshing the current-GT comparison. (Applies to recompute/rescoring only — intentional deletion may discard it, PDEC-012.) | `syncRunGroundTruthFromDataset` overwrites `predictions.ground_truth_label` in the DB ([reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L170)). | P1 | OPEN |
| FUP-007 | PDEC-007 | Comparisons and metric surfaces must identify their **ground-truth basis** and **evaluation scope** (image cohort, label scope, metric definition). Matching GT alone is not equivalence. | Synthesis selects "latest completed run" without surfacing basis/scope ([synthesize.ts](../src/lib/promptCompare/synthesize.ts#L34)); see PD-015, PD-018. | P2 | OPEN |
| FUP-008 | PDEC-008 | Add a **review-coverage gate** to Start AI Prompt Iteration: block unless every image has a ground-truth label **and** every false positive / false negative has a populated reviewer note. Return a clear message listing what is missing. TP/TN need no note. | Iteration route gates only on run `completed` + finalized note ([prompt-iteration/route.ts](../src/app/api/hil/prompt-iteration/route.ts#L112)); no coverage validation exists. | P1 | OPEN |
| FUP-009 | PDEC-009 | Surface per-run GT correction value **vs current** GT, and **cross-run per-image flip-flop** detection. (Applies while records exist — intentional deletion may discard them, PDEC-012.) | `groundtruth_corrections` journals per-run transitions but the query is scoped to one run and does not join current GT ([reviewRepository.ts](../src/lib/repositories/reviewRepository.ts#L120), [corrections route](../src/app/api/hil/gt-corrections/route.ts)). | P2 | OPEN |
| FUP-010 | PDEC-010 | Enforce **ground-truth equivalence** as a blocking rule for comparisons (the two runs must share the same dataset revision / GT basis), and identify the GT basis + evaluation scope in results. | No GT-equivalence check today; synthesis joins on (dataset_id, image_id) regardless of GT revision ([synthesize.ts](../src/lib/promptCompare/synthesize.ts#L367)). Extends FUP-007. | P1 | OPEN |
| FUP-011 | PDEC-010 | Add a **model / thinking-level comparison mode**: same prompt + dataset/GT, vary model and/or thinking level. Requires **run-level selection** (by model + thinking level), not "latest per prompt." Uses **existing completed runs only** — no run execution in the compare flow (OPEN-004 resolved). | Selection keys on (prompt, dataset) and `pickLatestCompletedRun` returns only the latest run; model/thinking level is not selectable ([PromptCompare.tsx](../src/components/PromptCompare.tsx#L397), [synthesize.ts](../src/lib/promptCompare/synthesize.ts#L34)). Runs persist `model_used`/`thinking_level` ([runs/route.ts](../src/app/api/runs/route.ts#L185)). | P2 | OPEN |
| FUP-012 | PDEC-011 | On partial creation (detection saved, baseline-prompt request failed), keep a **recoverable draft**: persistent "baseline prompt pending" state, **idempotent retry** that creates the baseline prompt without duplicating the detection, a visible pending indicator with a clear "add a baseline prompt first" message, and manual add as the fallback if retry fails. | Prompt failure keeps the detection and navigates to view with only a toast; no pending state or retry ([DetectionSetup.tsx](../src/components/DetectionSetup.tsx#L434)). Run Inference is already blocked without a prompt version ([BuildDataset.tsx](../src/components/BuildDataset.tsx#L168)); manual add already works. | P1 | OPEN |
| FUP-013 | PDEC-013 | Make approval a **dated, retained decision record** (approved version + evaluation run + override reason + timestamp + actor), backing the "current approved" pointer with append-only history. Records cascade on detection delete (PDEC-012). | Approval is a single overwritable column with no history ([detectionRepository.ts](../src/lib/repositories/detectionRepository.ts#L91), [approval gate](../src/app/api/detections/route.ts#L103)). | P2 | OPEN |
| FUP-014 | PDEC-012 | Correct the delete-confirmation UI wording that claims **datasets** are cascaded — they are not. | Cascade deletes prompts/runs/predictions/notes/corrections, not datasets ([detectionRepository.ts](../src/lib/repositories/detectionRepository.ts#L112)); UI text implies datasets are removed ([DetectionDashboard.tsx](../src/components/DetectionDashboard.tsx#L113)). | P3 | OPEN |

## Investigations (evidence required before scoping a change)

| ID | Question | What to verify | Linked |
| --- | --- | --- | --- |
| INV-001 | How do image-attribute (`segment_tags`) edits affect overall metrics, attribute breakdowns, and filtering, and does recompute refresh those results? | Trace `computeMetricsWithSegments` consumers, HIL live vs stored segment metrics, and recompute-all segment handling. | PDEC-006, PR-071 |

## Open product questions (undecided; not yet requirements)

| ID | Question | Notes | Linked |
| --- | --- | --- | --- |
| OPEN-001 | ~~What review prerequisites must be satisfied before Start AI Prompt Iteration?~~ | **RESOLVED 2026-10-27 → PDEC-008 / FUP-008:** every image has a GT label; every FP/FN has a reviewer note. | PDEC-004, PDEC-008 |
| OPEN-002 | Does the **non-GT `corrected_label`** operation need its own journaled history, separate from `groundtruth_corrections`? | **Narrowed 2026-10-27.** The owner's GT-correction-history need is satisfied by `groundtruth_corrections` (PDEC-009); this item is now only the narrower question of whether the distinct `corrected_label` (prediction-correction) path also needs a separate journal. | PDEC-006, PDEC-009 |
| OPEN-003 | Scope edge cases for the FUP-008 coverage gate | (a) Inference-failed images (not FP/FN/TP/TN): still require a GT label? exempt from the note rule? (b) Multi-label runs: is the FP/FN note required per label or per image? | PDEC-008, FUP-008 |
| OPEN-004 | ~~In the model/thinking-level comparison mode, use only pre-existing completed runs, or trigger the missing runs when the comparison starts?~~ | **RESOLVED 2026-10-27 → PDEC-010 / FUP-011:** use existing completed runs only; no run execution in the compare flow. New model/level runs are created first via the normal run flow. | PDEC-010, FUP-011 |
| OPEN-005 | ~~What may a detection with no baseline prompt (pending draft) do?~~ | **RESOLVED 2026-10-27 → PDEC-011 / FUP-012:** promptless detection persists and blocks Run Inference (already enforced via required prompt selection); recovery is manual add of a prompt version if the idempotent retry fails. | PDEC-011, FUP-012 |

## Workflow

Promote a `FUP-###` to implementation only via `/prototype-change`, producing a
`changes/PC-###.md` contract the owner explicitly approves. Update the Status
column here when an item enters a PC or is completed/verified. Keep superseded
items for traceability rather than deleting them.
