# Detection Lab - Whole-Product Context Map

**Status:** Lightweight prototype evidence map; supplemented with owner-stated production intent  
**Evidence baseline:** Current worktree inspected on 2026-10-27. No app, tests, builds, scripts, or runtime data were accessed or run.  
**Purpose:** Show shared concepts and dependencies across the product without creating detailed requirements for every capability.

## Product shape observed in the prototype

The app presents a connected workflow for defining a detection, authoring prompts, applying them to labeled image datasets, reviewing outcomes, and evaluating prompt quality. A separate set of management views supports datasets, annotation, quality assurance, run logs, and admin templates. This describes the prototype only; it is not an approved production architecture or a commitment to retain every feature.

## Capability and dependency map

| Capability | Whole-product role | Key shared concepts and dependencies |
| --- | --- | --- |
| Detection Setup | Defines detection identity and decision guidance; manages prompt versions; includes model/configuration surfaces and prototype-only authoring/testing paths. | Detection definition, prompt version, category, label policy, rubric, segment taxonomy, model/provider, version notes, optional production context/snapshot. Feeds inference and evaluation; consumes evaluation results for prompt approval in the prototype. |
| Run Inference | Applies a selected detection, prompt version, model, and dataset to produce a run and predictions. | Detection, prompt version, dataset/split, provider/model, inference output and run status. |
| HIL Review | Reviews predictions and can correct labels or record review findings. | Run, prediction, ground truth, correction, error tags, review flags; corrected data may affect later evaluation and feedback. |
| Prompt Feedback | Uses review/evaluation evidence to propose prompt changes and save a candidate version. | Detection, prompt version, predictions, review corrections, model response; creates a prompt-version dependency back to Detection Setup. |
| Prompt Compare | Compares outcomes across prompt runs. | Prompt versions, runs, datasets, metrics and comparison jobs. |
| Held-Out Eval | Runs evaluation/regression checks against held-out data; its results gate approved-prompt selection in the prototype API. | Prompt version, detection, held-out dataset/split, run, metric definitions and thresholds, approval decision. |
| Datasets | Creates and manages datasets, items, labels, splits and dataset relationships. | Image references, ground-truth labels, segment tags, provenance, split, detection association; supplies input to inference, HIL, QA and evaluation. |
| Annotation | Presents assigned datasets and annotation progress. | Dataset, dataset item, annotator/assignment, label and annotation state. |
| Quality Assurance | Assigns/reviews QA samples and handles dataset status and discrepancies. | Dataset, samples, annotator, review outcome, discrepancy and audit log. |
| Detections & Logs | Inspects detections and inference run history. | Detection, run, prediction, status, metrics and logs. |
| Admin | Edits shared prompt templates and accesses production-context integration surfaces. | Prompt-assist/feedback templates, category templates, production context catalog and frozen snapshots. |

### End-to-end relationships

1. Detection Setup creates a detection definition, one or more prompt versions and provides a quick test capability for rapid, low cost feedback.
2. Dataset management and annotation/QA provide labeled datasets and splits.
3. Run Inference combines detection + prompt version + model/provider + dataset and produces runs and predictions.
4. HIL Review may correct predictions or ground truth; Prompt Feedback may use these outcomes with VLM feedback to create another prompt version and test is against the previous version.
5. Prompt Compare and Held-Out Eval consume prompt versions, runs, datasets and metrics. In the prototype, a completed held-out run and configured thresholds (or a recorded override reason) are checked before a prompt can be approved.
6. Detection Setup is therefore coupled to downstream run/evaluation interfaces even if those capabilities are delivered in separate milestones.

## Detection Setup evidence and interface dependencies

Observed in the current source:

- The top-level navigation and component wiring are in [src/app/page.tsx](../../src/app/page.tsx). Detection Setup is one capability in the wider tabbed application.
- [src/components/DetectionSetup.tsx](../../src/components/DetectionSetup.tsx) includes detection create/edit, prompt authoring/version management, a prompt preview, Prompt Assist, Production Replication from a production context, a Quick Test using uploaded images, and approved-prompt selection. This is a list of observed surfaces; production intent is recorded separately below.
- [src/lib/schemas.ts](../../src/lib/schemas.ts) and [src/types/index.ts](../../src/types/index.ts) show prototype data shapes for detection fields, prompt versions, composition and snapshots. The Detection type is defined in `src/types/index.ts`.
- `/api/detections` handles detection listing and create/update/delete; the update path checks prompt ownership and held-out evaluation results before approval. `/api/prompts` handles prompt-version listing and create/update/delete.
- Other direct setup interfaces include `/api/runs` for run history/evaluation evidence, `/api/runs/quick-test` for uploaded-image inference, `/api/gemini/detection-assist` for generated setup suggestions, `/api/admin/prompts` for shared templates, `/api/admin/contexts` for a compiled production-context catalog, `/api/admin/contexts/snapshot` for frozen context snapshots, `/api/prompts/groups` for prompt grouping, and `/api/version-note-entries` for version history notes.
- Production-context catalog compilation currently reads a neighboring `ai-services` checkout through a local Python integration (`src/lib/services/contextCatalog.ts`). The prototype stores compiled catalog data and snapshots through its repository/data-store layer. A production team is not required to preserve this implementation or integration.
- The README describes local SQLite persistence and external model-provider configuration. That is prototype evidence only; target hosting, storage, model providers and secrets handling remain undecided.

## Interface impacts to adjacent milestones

These are dependencies to define for Detection Setup, not approval to expand this milestone:

- **Dataset and labeling capabilities:** Detection Setup needs stable contracts for labeled dataset references/ground-truth revisions when configuring aggregate evaluation and for diagnostic Quick Test inputs. Dataset ingest, editing, annotation and QA remain separate work.
- **Inference and provider capabilities:** Setup needs a contract for allowed model/provider identifiers, configuration, secrets custody, timeouts/errors and any image/prompt data sent to providers. Bulk inference and provider operations remain separate work.
- **Evaluation and approval capabilities:** Setup needs a defined evaluation result contract, metric/threshold semantics, held-out dataset reference and authorized approver decision. Evaluation execution, comparison and HIL remain separate work.
- **Production context source:** Define the authoritative source, read permissions, version/revision identifiers, snapshot behavior, drift handling and compatibility/error contract. Do not assume the adjacent repository or Python compiler is the production choice.
- **Identity and audit services:** The target needs an agreed identity/authorization contract for who may create, edit, approve, delete, import, or view detection and prompt records, plus attributable audit events. The inspected prototype request handlers do not establish a production identity model.
- **Downstream consumption:** Define how a saved or approved detection/prompt version is referenced by later inference/evaluation milestones, including stable IDs, immutable version semantics, status and deprecation behavior.

## Owner-stated production intent

The product owner supplied the following intended behaviors and dependencies while reviewing the milestone proposal. They inform the revised boundary but do not constitute approval of that boundary or a detailed requirement set:

- Product/Detection PM and Ops/prompt engineering create, iterate and test detections. Annotation and QA teams establish ground truth. Engineering currently supports insertion into the separate production service; future intent is to enable production Detection Lab to insert selected prompt versions directly.
- Blank Template, Prompt Assist, Quick Test, production-context replication/snapshot, prompt grouping and version notes are all to be covered in Detection Setup planning.
- Quick Test is diagnostic, not an authoritative gate. A single currently selected version per detection is designated after downstream evaluation passes; that designation is distinct from publishing to production.
- Production configuration is authoritative for aggregate context composition and execution settings. Catalog refreshes expose updates; a saved version's snapshot remains unchanged; experiments modify a Lab-derived configuration; adopting a new baseline requires a new version.
- Finalized, reviewed datasets provide ground truth. Single-target evaluation needs complete target labels; multi-label evaluation needs complete ground truth for every enabled detection scored. Incomplete labels can invalidate metrics.
- Run Inference, Prompt Compare and Held-Out Eval are intended downstream evaluation capabilities and remain outside detailed planning for this milestone.
- Gemini is the stated model family. Credentials and data handling follow existing organizational policies. Production is a rebuild; target platform/vendors and migration scope are unresolved.
- Owner-stated outcomes are to enable authorized non-engineers to create/iterate, reduce effort to produce testable configurations, preserve understandable history, support reproducibility, validate target behavior within production aggregates, and identify adverse effects on other detections in a context.

## Boundaries for this map

- **Observed prototype:** Facts above are based on source/configuration/README inspection; runtime behavior has not been tested.
- **Owner-stated intent:** Captured above and in [milestone-boundary.md](milestones/detection-setup/milestone-boundary.md); detailed requirements and acceptance targets are not yet approved.
- **Proposed scope:** Detection Setup only, as described in [milestone-boundary.md](milestones/detection-setup/milestone-boundary.md).
- **Open questions:** Production-insertion authorization/activation/rollback controls; exact role permissions and approval authority; metric definitions/thresholds; provider settings and applicable policy references; context source identity/freshness details; migration scope; target architecture; and measurable success/NFR targets.
