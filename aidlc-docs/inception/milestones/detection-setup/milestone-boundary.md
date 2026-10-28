# Milestone Boundary Proposal: Detection Setup

**Milestone ID:** MS-DET-01  
**Status:** SCOPE REFINED FROM OWNER ANSWERS - CONFIRMATION REQUESTED  
**Decision owner:** Product owner / milestone sponsor (Delaney Foley)  
**Scope rule:** This is the only milestone eligible for detailed Inception planning. Other capabilities may be examined only for dependencies and interface impacts.

## Proposed objective

Enable authorized Super Admin users to create and iterate on detection definitions and prompt versions, configure reproducible isolated or production-aggregate experiments, diagnose behavior with Quick Test, and — after the evaluation gate is passed — designate the single selected/approved prompt version per detection and prepare it for later promotion to staging and then production. Evaluation approval and selection do not publish a version. Direct in-platform insertion into staging/production is a confirmed future enhancement and is out of scope for MS-DET-01.

This objective reflects owner-stated intent from the requirements answers. Exact acceptance measures remain TBD with named owners.

## Owner-stated outcomes

- Enable authorized non-engineering users to create and iterate on detections.
- Reduce the effort required to produce a testable prompt configuration.
- Preserve understandable prompt-version history.
- Support reproducible evaluation configurations.
- Validate target performance within production aggregates.
- Detect adverse effects of new or updated detection definitions/prompts on other detections in the same aggregate context.

These are intended outcomes, not yet measurable acceptance targets. Owners, baselines, measures and thresholds remain TBD.

## Proposed included capability boundary

Detailed requirements discovery and production-team handoff for the following Detection Setup capabilities:

1. **Detection authoring and editing**
   - Create detection definitions from a blank template or Prompt Assist suggestions. Creating a detection is available to Super Admin users.
   - Record a Detection Owner (authenticated user ID) at creation. The owner may lock the detection to their user ID and add other Super Admin users as collaborators.
   - Any unlocked detection is editable by any Super Admin; a locked detection is editable only by its owner and designated collaborators.
   - Maintain detection metadata and decision guidance; define validation and lifecycle.
2. **Prompt versions and history**
   - Create and organize prompt revisions, including prompt grouping and version notes.
   - Saved prompt versions are immutable; any change creates a new version. History is preserved and understandable.
   - Allow hard delete of a version only while it is unapproved/unselected (deletion permitted even after an inference run, provided the version is not approved). Deleting a version removes its associated inference run logs but never the datasets those runs used.
   - Designate the single selected/approved version per detection after the evaluation gate passes: any author may select for unlocked detections; only the owner and collaborators may select for locked detections.
   - Specify version identity and references needed for reproducible downstream evaluation.
3. **Quick Test**
   - Run diagnostic tests against a small set of images and inspect responses, available to authorized users; output is always human-reviewed before any save.
   - Keep Quick Test distinct from authoritative evaluation and release qualification.
   - Quick Test images and results are ephemeral — not persisted after the session. Confirm any max-image/size limits during design (prototype limit is evidence, not a target).
4. **Production-context replication and snapshots**
   - Import assembled production contexts from the authoritative production configuration source through an Admin catalog/interface. The exact source binding and import mechanism are owned by Engineering and determined during refinement (see dependencies); the target is the production `ai-services` configuration, not a local checkout.
   - Refresh the catalog to expose newer production definitions.
   - Freeze the source composition and execution settings as a snapshot associated with a saved prompt version; later refreshes must not alter existing saved versions.
   - **Drift behavior (confirmed):** flag drift and require a new version to adopt a newer production baseline. Prompts created against an older snapshot retain the exact configuration they had at creation and display a badge indicating the date the production context they used fell out of date.
   - Allow experiments to modify a Lab configuration derived from its snapshot. A newer production baseline is adopted through a new version.
   - Support isolated and aggregate experiment configurations, including the completeness requirements for ground truth when scoring target or enabled detections.
5. **Evaluation and selection interfaces**
   - Define Detection Setup's contract for consuming authoritative evaluation results and recording one selected/approved version per detection.
   - Keep dataset-scale scoring, comparisons, held-out gates, ground-truth creation/review and release qualification in their own later capability milestones.
6. **Promotion handoff (direct insertion deferred)**
   - This milestone prepares a selected/approved version and the references an engineer needs to promote it to staging then production (current real-world process: finalized prompt and eval dataset are handed to Engineering).
   - Direct in-platform insertion into staging/production, insertion activation semantics, failure/rollback, and sibling-regression insertion gating are a confirmed future enhancement (prospective MS-DET-02) and are out of scope here. Document the interface awareness only; do not specify detailed insertion controls as deliverables of MS-DET-01.
7. **Supporting foundations**
   - Supporting data entities, APIs/contracts, validation, permissions, auditability, error behavior, privacy/security policy references, operational quality, and clean-build needs for the included behaviors.

The listed setup aids are explicitly in scope for requirements discovery; their prototype implementations are not requirements or architecture commitments.

## Evaluation and approval boundary

Owner-stated intent distinguishes three concepts:

- **Quick Test:** Diagnostic responses on a small image set; never an authoritative release gate.
- **Evaluation:** Run Inference, Prompt Compare and Held-Out Eval are the intended downstream capabilities. Finalized, reviewed datasets provide ground truth. Evaluation and dataset workflows are not detailed work in this milestone.
- **Selected/approved prompt:** A separate designation on a prompt version, available only after the applicable evaluation gate is passed. Only one version at a time is selected for a detection. This records the currently official selection; it does not by itself mean that production has been updated.

The authoritative metric, threshold values, metric-definition version, evaluation result contract, reviewer/approver roles and release criteria are not supplied and remain TBD with Product/Detection PM and evaluation owners. The proposed evaluation result should identify the exact prompt version and context snapshot, effective provider/model/settings, dataset and ground-truth revisions/split, metric definition/scope, per-detection results, failures, comparison baseline, reviewer and decision.

## Explicit exclusions and boundaries

- Detailed requirements, stories, redesign or delivery work for Run Inference, HIL Review, Prompt Feedback, Prompt Compare, Held-Out Eval, Datasets, Annotation, Quality Assurance, Detections & Logs or Admin as whole capabilities.
- **Direct in-platform insertion into staging/production**, insertion activation (immediate vs staged), insertion failure/rollback, and sibling-regression insertion gating — all confirmed future-enhancement work (prospective MS-DET-02), not MS-DET-01 deliverables.
- Changes to the authoritative production configuration source, dataset platform, identity system, model provider or production inference behavior. Required interfaces for context import are examined as dependencies; their implementation is owned by Engineering.
- Assuming an automatic production deployment, activation, rollout or rollback from selecting/approving a prompt.
- Treating the prototype's stack, local SQLite database, filesystem paths, provider list, adjacent `ai-services` checkout, Python compiler or API shapes as target architecture.
- Implementing the prototype, migrating data (none required — clean build), running tests/evaluations, or selecting/implementing a production architecture.
- Inventing measurable success, NFR, quality, workload, latency, reliability, scale or cost thresholds.

The user stated that production is a rebuild with no data migration; this is the target-development approach, not approval to reuse the prototype architecture. Target platform and vendor choices remain TBD and are owned by Engineering.

## Dependencies and interface impacts

| Dependency | Needed for this milestone | Remains outside this detailed scope |
| --- | --- | --- |
| Production configuration/context source | Authority, catalog refresh, source revision, immutable snapshot, composition/settings, drift and compatibility contracts. | Changes to the production source system itself. |
| Evaluation and approval | Authoritative result schema, metric/scope/version, threshold contract, reviewer decision and single-selected-version reference. | Scoring, comparison, held-out evaluation execution and release qualification. |
| Dataset/annotation/QA | Dataset and ground-truth revision references; completeness checks for target and all enabled aggregate detections; diagnostic test-input contract. | Dataset import/management, labeling, QA and annotation workflows. |
| Inference/provider | Gemini model-family configuration, effective model/settings, centrally managed credentials, diagnostic execution and error/data-transfer contracts. | Bulk inference, provider infrastructure and organization-wide credential management. |
| Identity, authorization and audit | Super Admin visibility of the page; Detection Owner lock, collaborator model, and attributable audit for authoring, editing, version selection and context import. Role definitions come from the existing production system. | Whole-product identity implementation and other milestones' permissions. |
| Promotion / future insertion target (MS-DET-02) | Awareness of the references an engineer needs to promote a selected version to staging then production. | Direct in-platform insertion, activation, rollback and sibling-regression gating — deferred future enhancement. |
| Organization policies | Follow established organizational data-retention, security, budget and credential policies. Engineering supplies authoritative policy references during refinement. | Re-defining organization-wide policies; concrete policy references are owned by Engineering (TBD). |

## Resolved from owner answers (2026-10-27)

- **Roles:** Page is visible to Super Admins only; everyone sees everyone's work. Detection creation by any Super Admin; Detection Owner recorded at creation, may lock to their user ID and add Super Admin collaborators; unlocked detections editable by any Super Admin; locked detections editable/selectable only by owner and collaborators. Role definitions come from the existing production system.
- **Version lifecycle:** Immutable saved versions; changes create new versions. Hard delete allowed only for unapproved/unselected versions, including after an inference run; deleting a version deletes its run logs but not datasets.
- **Prompt Assist:** Any authorized user may generate; output is always human-reviewed before save.
- **Quick Test:** Ephemeral images and results.
- **Context drift:** Flag drift and require a new version to adopt a newer baseline; older-snapshot prompts retain their creation-time configuration and show an out-of-date badge with the date.
- **Provider/credentials:** Central Gemini model allow-list; centrally managed secrets with no user-entered keys in production.
- **Migration:** None — clean build.

## Decisions deferred to Engineering or a future milestone

1. **Direct production insertion and controls (future MS-DET-02):** activation (staged vs immediate — likely staged first, possibly direct later, citing the existing precedent of pushing notification rules/templates/org settings from the UI), failure/rollback (intended automatic rollback with audit), and sibling-regression insertion gating (intended warn-with-override). Out of scope for MS-DET-01.
2. **Context source binding (Engineering):** exact authoritative-source identity, import mechanism, revision identification and freshness/error handling are determined by Engineering during refinement; the target is the production `ai-services` configuration.
3. **Authoritative evaluation gate (evaluation owners):** metric definition/version, threshold values, dataset split and ground-truth revision rules, comparison baseline, scope, failure treatment and decision authority remain TBD.
4. **Data-governance and security references (Engineering):** retention, provenance, sensitivity, audit and the security/resiliency/PBT engineering practices are supplied by Engineering during production refinement/implementation. The product owner does not have access to these references.
5. **Measurable success and NFR targets (owner: Delaney Foley):** all success measures and NFR targets (availability, concurrent authors, Quick Test latency, audit retention, etc.) are TBD with named owners to be set during handoff review.

## Approval gate

The owner's answers narrowed MS-DET-01 by moving direct production insertion (and its activation/rollback/regression-gating controls) to a future enhancement. This boundary now covers authoring, prompt versioning, Quick Test, context replication/snapshot/drift, evaluation-gated selection/approval, and the promotion handoff — not direct insertion.

Before I draft detailed requirements, please confirm this narrowed scope in [scope-confirmation.md](questions/scope-confirmation.md). Do not generate detailed requirements until that confirmation is recorded. Keep this milestone limit on resume.
