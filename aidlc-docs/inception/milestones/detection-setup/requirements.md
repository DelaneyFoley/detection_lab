# Detection Setup - Production Requirements (MS-DET-01)

**Status:** DRAFT for review  
**Scope:** Detection Setup capability only, per the approved and confirmed [milestone boundary](milestone-boundary.md).  
**Evidence baseline:** Prototype inspected 2026-10-27 (no runtime testing). Owner answers recorded 2026-10-27 in [requirements.md](questions/requirements.md) and [scope-confirmation.md](questions/scope-confirmation.md).  
**Decision owner:** Delaney Foley (product owner). Role definitions and several policy references are owned by Engineering (marked TBD).

> **Layout note:** This milestone's artifacts live under `aidlc-docs/inception/milestones/detection-setup/`. The whole-product context map and workflow state/audit remain shared at `aidlc-docs/inception/` and `aidlc-docs/`.

## Reading guide

Each requirement separates evidence from decision using these labels where relevant:

- **Observed prototype** — behavior seen in source; not automatically a requirement.
- **Confirmed requirement** — owner-confirmed production behavior.
- **Open question / assumption** — unresolved; carries an owner and `TBD`.

Every requirement has: rationale/source, owner, priority (MoSCoW), verification method, approval status. IDs are stable (`FR-###`). Priorities: Must / Should / Could. Approval status starts `Proposed` and becomes `Approved` only on explicit owner sign-off.

## Intent summary

- **Request type:** Production rebuild (clean build, no data migration) of a prototype's Detection Setup capability.
- **Scope estimate:** Single capability with multiple sub-capabilities and several external interfaces.
- **Complexity:** Comprehensive (multi-persona, external integrations, auditability, reproducibility).
- **Primary goal:** Let authorized Super Admin users create, iterate, test and version detection configurations, validate them within replicated production aggregates, and designate one evaluation-gated selected version per detection for later promotion.

## Scope and non-goals

**In scope:** detection authoring (blank + Prompt Assist), ownership/lock/collaborator model, prompt version management and history, Quick Test diagnostics, production-context replication/snapshot/drift, isolated and aggregate experiment configuration, evaluation-result consumption and single selected/approved version, promotion handoff preparation, Super-Admin access control and auditability.

**Out of scope (confirmed):** direct in-platform insertion into staging/production and its activation/rollback/sibling-regression gating (future MS-DET-02); detailed delivery of Run Inference, HIL Review, Prompt Feedback, Prompt Compare, Held-Out Eval, Datasets, Annotation, QA, Detections & Logs, and Admin as whole capabilities; dataset creation/labeling; building/altering the production configuration source; data migration; target architecture/vendor selection.

## Functional requirements

### EPIC-001 - Detection authoring and ownership

**FR-001 - Create detection (blank template)**  
A Super Admin user can create a detection with identity (code, display name), category, decision guidance (label policy, decision rubric), segment taxonomy and metric-threshold configuration.  
- Source: Owner B1; prototype [DetectionSetup.tsx](../../../../src/components/DetectionSetup.tsx), `/api/detections`.  
- Owner: Delaney Foley. Priority: Must. Verification: acceptance test on create + persisted record. Status: Proposed.

**FR-002 - Create detection via Prompt Assist**  
A Super Admin user can generate draft detection fields from a natural-language description; generated output is always presented for human review and editing before it is saved.  
- Source: Owner C3 (A); prototype `/api/gemini/detection-assist`.  
- Owner: Delaney Foley. Priority: Should. Verification: acceptance test that generated fields are editable and require explicit save. Status: Proposed.

**FR-003 - Record Detection Owner at creation**  
On creation the system records the creating user's authenticated identity as the Detection Owner.  
- Source: Owner B1. Owner: Delaney Foley. Priority: Must. Verification: created record stores owner user ID. Status: Proposed.

**FR-004 - Lock / unlock a detection**  
The Detection Owner can lock a detection to their authenticated user ID and later unlock it. While locked, only the owner and designated collaborators may edit or select versions; while unlocked, any Super Admin may edit.  
- Source: Owner B1, B2. Owner: Delaney Foley. Priority: Must. Verification: permission tests for locked/unlocked edit and select paths, including a denied case. Status: Proposed.

**FR-005 - Manage collaborators**  
The Detection Owner can add and remove other Super Admin users as collaborators on a locked detection, granting them edit and selection rights for that detection.  
- Source: Owner B1, B2. Owner: Delaney Foley. Priority: Must. Verification: add/remove collaborator changes effective permissions. Status: Proposed.

**FR-006 - Edit detection metadata and guidance**  
Authorized users can edit detection metadata and decision guidance subject to the lock/collaborator rules; edits to policy, rubric or addendum produce a new prompt version rather than mutating an existing one (see FR-009).  
- Source: Owner B1, C1; prototype update path. Owner: Delaney Foley. Priority: Must. Verification: edit flow + new-version creation. Status: Proposed.

**FR-007 - Validate detection fields**  
The system validates required fields and enforces detection-code uniqueness, rejecting invalid input with an actionable message.  
- Source: Observed prototype (code uniqueness, required fields); confirmed as production need. Owner: Delaney Foley. Priority: Must. Verification: validation tests incl. duplicate code. Status: Proposed.

### EPIC-002 - Prompt version management

**FR-008 - Create prompt version**  
Authorized users can create prompt versions (from blank authoring, Prompt Assist, or a production-replication derivation) carrying system/user prompt structure, model and decoding settings, and change/version notes.  
- Source: Owner B1, C1; prototype `/api/prompts`. Owner: Delaney Foley. Priority: Must. Verification: create + persisted version. Status: Proposed.

**FR-009 - Version immutability**  
Saved prompt versions are immutable. Any change to a saved version results in a new version; prior versions remain unchanged.  
- Source: Owner C1 (X). Owner: Delaney Foley. Priority: Must. Verification: attempt-to-edit creates a new version; original unchanged. Status: Proposed.

**FR-010 - Prompt grouping**  
Users can group related prompt versions (e.g., by base name) and manage group metadata to keep history navigable.  
- Source: Owner "all setup aids"; prototype `/api/prompts/groups`. Owner: Delaney Foley. Priority: Should. Verification: group create/rename/membership. Status: Proposed.

**FR-011 - Understandable version history / notes**  
Each version retains an understandable history of notes and events (user notes and system-origin entries) viewable per version.  
- Source: Owner F2 ("understandable version history"); prototype version-note entries. Owner: Delaney Foley. Priority: Should. Verification: notes CRUD + history display. Open question: definition of "understandable" (owner Delaney Foley, `TBD`). Status: Proposed.

**FR-012 - Delete unapproved / unselected version**  
Users can hard-delete a prompt version only while it is not approved/selected, including after it has an inference run. Deleting a version removes its associated inference run logs but never the datasets those runs used. An approved/selected version cannot be deleted while it holds that designation.  
- Source: Owner C2 (X). Owner: Delaney Foley. Priority: Must. Verification: delete allowed for unselected (removes run logs, keeps datasets); delete blocked for selected. Status: Proposed.

**FR-013 - Select / inspect active working version**  
Within Detection Setup, a user can select and inspect a prompt version (compiled preview) to use as the working version for experiments and downstream actions.  
- Source: Observed prototype; confirmed. Owner: Delaney Foley. Priority: Should. Verification: selection drives preview/experiment context. Status: Proposed.

### EPIC-003 - Quick Test diagnostics

**FR-014 - Run Quick Test**  
An authorized user can run a diagnostic test of the selected version against a small set of uploaded images and view per-image responses (decision/label verdicts, evidence, parse status).  
- Source: Owner "all setup aids", C3/C4; prototype `/api/runs/quick-test`. Owner: Delaney Foley. Priority: Should. Verification: run returns per-image diagnostic results. Status: Proposed.

**FR-015 - Quick Test is ephemeral**  
Quick Test images and results are not persisted after the session; they are not stored as part of the version or as an authoritative result.  
- Source: Owner C4 (A). Owner: Delaney Foley. Priority: Must. Verification: no persisted Quick Test image/result after session ends. Status: Proposed. Open question: max image count/size limits (`TBD`, owner Delaney Foley).

**FR-016 - Quick Test is non-authoritative**  
The UI and data model clearly distinguish Quick Test diagnostics from authoritative evaluation; Quick Test results cannot gate selection/approval.  
- Source: Owner C4, Section-D intent. Owner: Delaney Foley. Priority: Must. Verification: selection/approval cannot reference a Quick Test result. Status: Proposed.

### EPIC-004 - Production-context replication and snapshots

**FR-017 - Import / replicate production context**  
An authorized user can import an assembled production context (ordered detection composition and execution settings) from the authoritative production configuration source through an Admin catalog interface, to author a detection inside the real aggregate.  
- Source: Owner D1, prior production-context answers; prototype `/api/admin/contexts`, contextCatalog. Owner: Engineering (source binding) + Delaney Foley (capability). Priority: Must. Verification: import produces a usable catalog entry. Open question: authoritative source identity/import mechanism (owner Engineering, `TBD`). Status: Proposed.

**FR-018 - Refresh catalog**  
A user can refresh the catalog to expose newer production definitions without altering previously saved versions.  
- Source: Owner D1/D2; prototype refresh. Owner: Engineering + Delaney Foley. Priority: Should. Verification: refresh updates catalog; saved versions unchanged. Status: Proposed.

**FR-019 - Snapshot bound to a saved version**  
Saving a production-mode version freezes the source composition and execution settings into an immutable snapshot bound to that version. Later catalog refreshes never mutate existing snapshots or saved versions.  
- Source: Owner D2; prototype snapshots. Owner: Delaney Foley. Priority: Must. Verification: snapshot immutability across refresh. Status: Proposed.

**FR-020 - Drift detection and badging**  
When the production context changes after a version's snapshot, the system flags drift and requires a new version to adopt the newer baseline. Prompts created against an older snapshot retain the exact configuration they had at creation and display a badge indicating the date the production context they used fell out of date.  
- Source: Owner D2 (X). Owner: Delaney Foley. Priority: Must. Verification: drift flagged; older version retains config; badge shows out-of-date date. Status: Proposed.

**FR-021 - Edit derived experiment composition**  
A user can modify a Lab configuration derived from a snapshot (target member wording, enabled members, preamble, order, model/thinking settings within policy) to run experiments, without changing the underlying snapshot.  
- Source: Owner D-section; prototype composition editing. Owner: Delaney Foley. Priority: Should. Verification: composition edits affect the derived version only. Status: Proposed.

**FR-022 - Isolated and aggregate experiments**  
The user can configure single-target (one detection scored) and aggregate multi-label (every enabled detection scored) experiments against the replicated context.  
- Source: Owner downstream-quality answer. Owner: Delaney Foley. Priority: Should. Verification: both configurations are expressible and distinguishable. Status: Proposed.

**FR-023 - Ground-truth completeness safeguard**  
Before an experiment is treated as valid, the system checks ground-truth completeness for the scored detection(s) and warns/blocks when labels are missing, because absent labels are treated as negatives and can invalidate metrics.  
- Source: Owner downstream-quality answer. Owner: Delaney Foley + evaluation owners. Priority: Should. Verification: incomplete labels produce a warning/block. Open question: warn vs block threshold (`TBD`). Status: Proposed.

### EPIC-005 - Evaluation-gated selection and promotion handoff

**FR-024 - Consume authoritative evaluation result (interface)**  
Detection Setup consumes an authoritative evaluation result produced by downstream evaluation capabilities. The interface identifies the exact prompt version and snapshot, provider/model/settings, dataset and ground-truth revision/split, metric definition/version and scope, per-detection results, failures, comparison baseline, reviewer and decision.  
- Source: Owner downstream-quality answer. Owner: Delaney Foley + evaluation owners. Priority: Must. Verification: contract/schema review; selection reads a conformant result. Open question: metric definitions/thresholds (owner evaluation owners, `TBD`). Status: Proposed.

**FR-025 - Evaluation-gated single selected version**  
A user can designate exactly one selected/approved prompt version per detection, and only after the applicable evaluation gate is passed. Selecting a new version replaces the prior selection. Selection does not publish to production.  
- Source: Owner Q1(lifecycle), B2. Owner: Delaney Foley. Priority: Must. Verification: selection enabled only post-gate; single-selection invariant enforced. Status: Proposed.

**FR-026 - Selection permissions**  
Selection follows the lock model: any Super Admin may select for unlocked detections; only owner and collaborators may select for locked detections.  
- Source: Owner B2. Owner: Delaney Foley. Priority: Must. Verification: permission tests incl. denied case. Status: Proposed.

**FR-027 - Below-threshold approval override (to confirm)**  
The prototype permits approving a version below thresholds when a justification is recorded (a completed held-out eval still required). Whether production retains this override is an open decision.  
- Source: Observed prototype `/api/detections` PUT. Owner: Delaney Foley. Priority: Could. Verification: if retained, override requires justification + completed eval; audited. Open question: retain override? (`TBD`, owner Delaney Foley). Status: Proposed (pending decision).

**FR-028 - Prepare promotion handoff**  
For a selected version, the system assembles the references an engineer needs to promote it to staging then production: version identity, bound snapshot, effective model/settings, evaluation result reference, and dataset/ground-truth revision.  
- Source: Owner B3 / roles answer (handoff to Engineering). Owner: Delaney Foley + Engineering. Priority: Should. Verification: handoff package contains all listed references. Status: Proposed.

**FR-029 - Export handoff package**  
A user can export/share the promotion handoff package for the selected version for engineering consumption.  
- Source: Owner roles answer. Owner: Delaney Foley. Priority: Could. Verification: export produces a complete, readable package. Status: Proposed.

### EPIC-006 - Access control and auditability

**FR-030 - Super-Admin-only visibility**  
The Detection Setup page and its actions are visible only to authenticated Super Admin users; all Super Admins can see all detections and work (no tenant isolation), with action-level restrictions per the lock model.  
- Source: Owner B4. Owner: Delaney Foley. Priority: Must. Verification: non-Super-Admin denied; Super Admin sees all. Status: Proposed.

**FR-031 - Attributable audit trail**  
Create, edit, version-create, delete, context-import, selection/approval and override actions are recorded with actor identity, timestamp and the affected entity, for an auditable history.  
- Source: Planning-contract auditability; owner governance answer. Owner: Delaney Foley + Engineering. Priority: Must. Verification: each action writes an attributable audit event. Open question: audit retention period (owner Engineering, `TBD`). Status: Proposed.

## Business rules

- **BR-1:** Identity and role definitions (Super Admin, future Detection Manager) are provided by the existing production system; Detection Setup consumes them and does not define them.
- **BR-2:** A detection has at most one selected/approved prompt version at any time.
- **BR-3:** Selection/approval requires a passed evaluation gate; Quick Test never satisfies it.
- **BR-4:** Saved versions and their bound snapshots are immutable; catalog refreshes never alter them.
- **BR-5:** Deleting a version deletes its run logs but never datasets; approved/selected versions cannot be deleted while designated.
- **BR-6:** No data migration — production starts clean.

## Open questions (carried as labeled TBD)

| ID | Question | Owner | Blocking? |
| --- | --- | --- | --- |
| OQ-1 | Metric definitions, thresholds, split and gate semantics for evaluation result | Evaluation owners | Blocks final acceptance criteria for FR-024/FR-025 |
| OQ-2 | Authoritative production-context source identity + import mechanism | Engineering | Blocks FR-017 design detail |
| OQ-3 | Data-governance/security/retention policy references | Engineering | Blocks NFR targets, not FR shape |
| OQ-4 | Retain below-threshold approval override (FR-027)? | Delaney Foley | Blocks FR-027 |
| OQ-5 | Quick Test max image/size limits | Delaney Foley | Non-blocking |
| OQ-6 | Ground-truth completeness: warn vs block, threshold | Delaney Foley + evaluation owners | Non-blocking for shape |
| OQ-7 | Definition of "understandable" version history | Delaney Foley | Non-blocking |
| OQ-8 | All measurable success/NFR targets | Delaney Foley | Blocks sign-off of targets, not FR shape |

## Future milestone (recorded, not in MS-DET-01)

Direct production insertion (prospective MS-DET-02): staged-then-possibly-direct activation (precedent: notification rules/templates/org settings pushed from the UI), automatic rollback with audit, warn-with-override on sibling regression, and a future Detection Manager permission (Super Admin + Detection Manager + owner/collaborator). See [risks-and-decisions.md](risks-and-decisions.md).
