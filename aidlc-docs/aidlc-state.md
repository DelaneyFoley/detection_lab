# AI-DLC State Tracking

## Project Information

- **Project:** Detection Lab production-development handoff
- **Workflow mode:** production-planning-only
- **Project type:** Brownfield prototype
- **Start date:** 2026-10-27
- **Current stage:** INCEPTION - Detection Setup Requirements, NFRs and Stories (review gate)
- **Current status:** DRAFT / BLOCKED - draft requirements/NFRs/personas/stories + handoff package produced; awaiting owner review and blocking-decision resolution

## Workspace Baseline

- **Prototype baseline:** Current worktree inspected on 2026-10-27; treat as evidence, including uncommitted behavior.
- **Languages/frameworks observed:** TypeScript/React/Next.js application with SQLite persistence; README identifies Next.js, Vitest and Node.js.
- **Reverse engineering status:** Lightweight whole-product context map drafted at `inception/product-context-map.md`; no claim of complete reverse engineering or runtime testing.
- **Sensitive inputs:** No credentials, environment files, runtime databases, uploaded datasets, spreadsheets, or image contents were read.
- **Source changes:** None permitted or made.

## Planning Boundary

- **Mode:** production-planning-only
- **Allowed phases:** INCEPTION
- **Current proposed milestone:** MS-DET-01 - Detection Setup
- **Boundary approval:** APPROVED 2026-10-27 (answer A). Revised boundary includes all five named setup aids and direct production insertion of selected versions; see `inception/milestones/detection-setup/milestone-boundary.md` and `inception/milestones/detection-setup/questions/milestone-boundary-approval.md`.
- **Resume guard:** Preserve Detection Setup as the only proposed detailed milestone. Until approval, do not generate detailed requirements. After approval, keep connected capabilities at summary/dependency/interface level unless the product owner explicitly approves a separate scope change.
- **Owner-confirmed for detailed discovery:** Blank Template, Prompt Assist, Quick Test, production-context replication/snapshots, prompt grouping and version notes must be covered. Quick Test is diagnostic and ephemeral, not an authoritative evaluation gate. One selected prompt per detection follows the downstream evaluation gate and is distinct from production publication.
- **Scope confirmed 2026-10-27 (answers A/A):** Direct production insertion deferred to future MS-DET-02; future intents recorded as an appendix. MS-DET-01 covers authoring, prompt versioning, Quick Test, context replication/snapshot/drift, evaluation-gated selection/approval, and promotion handoff.
- **Roles (confirmed):** Page visible to Super Admins only; all work visible to all. Detection Owner recorded at creation, may lock to their user ID and add Super Admin collaborators; unlocked detections editable/selectable by any Super Admin, locked ones only by owner/collaborators. Role definitions come from the existing production system.
- **Lifecycle (confirmed):** Immutable versions; hard delete only for unapproved/unselected versions; deleting a version removes its run logs but not datasets. Prompt Assist output human-reviewed before save.
- **Context drift (confirmed):** Flag drift, require new version for newer baseline; older-snapshot prompts retain creation-time config with an out-of-date badge.
- **Provider/governance (confirmed/deferred):** Central Gemini allow-list; centrally managed secrets, no user keys in production. Data-governance/security references and context-source binding are owned by Engineering (TBD). No data migration — clean build.
- **Targets:** All success measures and NFR targets are TBD; owner Delaney Foley.
- **Construction:** OUT OF SCOPE (not completed).
- **Operations:** OUT OF SCOPE (not completed).

## Extension Configuration

Security Baseline, Resiliency Baseline and Property-Based Testing opt-in prompts were presented in `inception/milestones/detection-setup/questions/requirements.md` (Section A). The product owner answered "Other" to all three, deferring these practices to Engineering during production refinement/implementation. They are therefore NOT enabled as blocking planning constraints for MS-DET-01. Per the planning contract, NFR discovery (authentication, authorization, privacy, retention, auditability, reliability, etc.) still proceeds at requirements level, with concrete security/resiliency/PBT practices owned by Engineering. Do not load the full extension rule files, since none were opted into.

| Extension | Enabled | Decided At |
| --- | --- | --- |
| Security Baseline | No — deferred to Engineering | Requirements Discovery (2026-10-27) |
| Resiliency Baseline | No — deferred to Engineering | Requirements Discovery (2026-10-27) |
| Property-Based Testing | No — deferred to Engineering | Requirements Discovery (2026-10-27) |

## Stage Progress

### INCEPTION

- [x] Workspace detection - brownfield prototype; no existing `aidlc-docs/aidlc-state.md` was present.
- [x] Initial source/evidence scan - source, API schemas/routes and README inspected; no runtime behavior tested.
- [x] Lightweight whole-product context map drafted.
- [x] Detection Setup milestone objective, outcomes, candidate scope, exclusions, dependencies and whole-product decisions proposed.
- [x] Owner-provided whole-product context and setup-aid scope captured in the revised proposal.
- [x] Revised milestone boundary approval - APPROVED 2026-10-27 (answer A).
- [x] Requirements clarifying answers recorded; extension decisions recorded (all deferred to Engineering).
- [x] Scope confirmation - CONFIRMED 2026-10-27 (answers A/A); direct insertion deferred to MS-DET-02.
- [x] Detailed Detection Setup requirements, NFRs, personas and stories drafted under `inception/milestones/detection-setup/`.
- [x] Production handoff package drafted (gap analysis, backlog, traceability, risks/decisions, README).
- [ ] Owner review/approval of requirements/NFRs/stories - PENDING.
- [ ] Resolve blocking OQ-1/OQ-2/OQ-3/OQ-4/OQ-8 with owners - PENDING.
- [ ] HANDOFF_READY - BLOCKED until review + blocking decisions resolved.

## Artifact Layout

MS-DET-01 artifacts live in `aidlc-docs/inception/milestones/detection-setup/` (requirements.md, nfr.md, personas.md, stories.md, gap-analysis.md, backlog.md, traceability.md, risks-and-decisions.md, milestone-boundary.md, README.md, and a `questions/` subfolder). The whole-product context map stays shared at `aidlc-docs/inception/product-context-map.md`; workflow state and audit stay at `aidlc-docs/`.

## Current Artifacts

Shared:
- [Product context map](inception/product-context-map.md)
- [Sanitized audit](audit.md)

Milestone MS-DET-01 (`inception/milestones/detection-setup/`):
- [Milestone boundary](inception/milestones/detection-setup/milestone-boundary.md)
- [Requirements](inception/milestones/detection-setup/requirements.md)
- [Non-functional requirements](inception/milestones/detection-setup/nfr.md)
- [Personas](inception/milestones/detection-setup/personas.md)
- [User stories](inception/milestones/detection-setup/stories.md)
- [Gap analysis](inception/milestones/detection-setup/gap-analysis.md)
- [Backlog](inception/milestones/detection-setup/backlog.md)
- [Traceability](inception/milestones/detection-setup/traceability.md)
- [Risks and decisions](inception/milestones/detection-setup/risks-and-decisions.md)
- [Handoff README](inception/milestones/detection-setup/README.md)
- [Boundary approval question](inception/milestones/detection-setup/questions/milestone-boundary-approval.md)
- [Requirements clarifying questions](inception/milestones/detection-setup/questions/requirements.md)
- [Scope confirmation question](inception/milestones/detection-setup/questions/scope-confirmation.md)

## Resume Instructions

Read this state first. Boundary approved and scope confirmed (direct insertion deferred to MS-DET-02). Draft requirements, NFRs, personas, stories and the handoff package are produced under `inception/milestones/detection-setup/`. The workflow is paused for owner review of these artifacts. Do not advance to HANDOFF_READY until the owner approves the requirements/NFRs/stories and the blocking open questions (OQ-1 evaluation contract, OQ-2 context source, OQ-3 governance refs, OQ-4 override, OQ-8 targets) are resolved with their owners. Keep connected capabilities at interface level. Extensions remain deferred to Engineering (none enabled). Never interpret "continue", "approve", or "finish" as permission to implement or enter Construction/Operations.
