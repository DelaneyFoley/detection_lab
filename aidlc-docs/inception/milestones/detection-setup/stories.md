# Detection Setup - User Stories (MS-DET-01)

**Status:** DRAFT for review.  
**Scope:** Detection Setup only. Stories trace to [requirements.md](requirements.md) and [personas.md](personas.md). Acceptance criteria use Given/When/Then and include permission/failure cases. Each story: persona, goal/benefit, requirement links, dependencies, acceptance criteria. Stories follow INVEST. IDs are stable (`US-###`).

Where an acceptance value depends on an unresolved decision, the criterion references the relevant `OQ-#`/`TBD` rather than inventing a value.

## EPIC-001 - Detection authoring and ownership

### US-001 - Create a detection from a blank template
- **Persona:** P1 Detection Author. **Benefit:** Start a new detection without engineering.
- **Requirements:** FR-001, FR-003, FR-007, FR-030. **Dependencies:** authentication (NFR-001).
- **Acceptance criteria:**
  - Given an authenticated Super Admin, When they submit a valid new detection (code, display name, category, guidance), Then it is saved and they are recorded as Detection Owner.
  - Given a duplicate detection code, When they submit, Then the system rejects it with an actionable message and saves nothing.
  - Given a non-Super-Admin, When they attempt to reach Detection Setup, Then access is denied.

### US-002 - Generate a draft with Prompt Assist
- **Persona:** P1. **Benefit:** Reduce effort to produce a first testable configuration.
- **Requirements:** FR-002. **Dependencies:** model allow-list (NFR-005), central secrets (NFR-004).
- **Acceptance criteria:**
  - Given a natural-language description, When the user runs Prompt Assist, Then draft fields populate an editable form and nothing is saved automatically.
  - Given generated output, When the user edits and explicitly saves, Then the saved detection reflects the human-reviewed values.
  - Given a provider/API failure, When Prompt Assist runs, Then a clear error is shown and no partial detection is created.

### US-003 - Lock a detection and manage collaborators
- **Persona:** P2 Detection Owner. **Benefit:** Prevent unintended edits while enabling chosen contributors.
- **Requirements:** FR-004, FR-005, FR-026. **Dependencies:** US-001.
- **Acceptance criteria:**
  - Given an owned detection, When the owner locks it, Then only the owner and collaborators can edit or select versions.
  - Given a locked detection, When a non-collaborator Super Admin attempts to edit or select, Then the action is denied and audited.
  - Given a locked detection, When the owner adds/removes a collaborator, Then that user's edit/select rights change accordingly.
  - Given an unlocked detection, When any Super Admin edits, Then the edit is allowed.

### US-004 - Edit detection guidance producing a new version
- **Persona:** P1/P3. **Benefit:** Iterate guidance while preserving history.
- **Requirements:** FR-006, FR-009. **Dependencies:** US-001.
- **Acceptance criteria:**
  - Given an authorized user edits label policy/rubric/addendum, When they save, Then a new prompt version is created and the prior version is unchanged.
  - Given a user without rights on a locked detection, When they attempt to edit, Then the action is denied.

## EPIC-002 - Prompt version management

### US-005 - Create and view prompt versions with history
- **Persona:** P1. **Benefit:** Maintain understandable history.
- **Requirements:** FR-008, FR-011. **Dependencies:** US-001.
- **Acceptance criteria:**
  - Given an authorized user, When they create a prompt version, Then it persists with model/settings and an initial version note.
  - Given a version, When the user opens its history, Then user and system-origin notes are listed chronologically.
  - (OQ-7) The definition of "understandable" history is confirmed by Delaney Foley before this story is accepted as Done.

### US-006 - Group related prompt versions
- **Persona:** P1. **Benefit:** Keep many revisions navigable.
- **Requirements:** FR-010. **Dependencies:** US-005.
- **Acceptance criteria:**
  - Given multiple versions, When the user groups them under a base name, Then they appear grouped with editable group metadata.

### US-007 - Delete an unapproved version safely
- **Persona:** P1. **Benefit:** Remove dead-end experiments without losing datasets.
- **Requirements:** FR-012. **Dependencies:** US-005.
- **Acceptance criteria:**
  - Given an unselected version with an inference run, When the user deletes it, Then the version and its run logs are removed and the datasets used remain intact.
  - Given a selected/approved version, When the user attempts to delete it, Then deletion is blocked with an explanation.

### US-008 - Select/inspect a working version
- **Persona:** P1/P4. **Benefit:** Drive experiments from a chosen version.
- **Requirements:** FR-013. **Dependencies:** US-005.
- **Acceptance criteria:**
  - Given several versions, When the user selects one, Then its compiled preview and settings become the working context.

## EPIC-003 - Quick Test diagnostics

### US-009 - Run an ephemeral Quick Test
- **Persona:** P1. **Benefit:** Fast diagnostic feedback before formal evaluation.
- **Requirements:** FR-014, FR-015, FR-016. **Dependencies:** US-008, NFR-004/005.
- **Acceptance criteria:**
  - Given a selected version and a small image set, When the user runs Quick Test, Then per-image diagnostic results (verdict, evidence, parse status) are shown.
  - Given a completed session, When it ends, Then Quick Test images and results are not persisted.
  - Given a Quick Test result, When the user attempts selection/approval, Then Quick Test cannot satisfy the evaluation gate.
  - (OQ-5) Any max image/size limit is confirmed by Delaney Foley before Done.

## EPIC-004 - Production-context replication and snapshots

### US-010 - Import a production context
- **Persona:** P4. **Benefit:** Author inside the real aggregate.
- **Requirements:** FR-017. **Dependencies:** context-source binding (OQ-2, Engineering).
- **Acceptance criteria:**
  - Given an authorized user, When they import a context from the authoritative source, Then its composition and execution settings are available to author against.
  - Given a source/compile failure, When import runs, Then a clear error with remediation guidance is shown and no partial context is stored.
  - (OQ-2) Source identity/import mechanism confirmed with Engineering before Done.

### US-011 - Snapshot binds to a saved version and resists refresh
- **Persona:** P4. **Benefit:** Reproducibility of past versions.
- **Requirements:** FR-019, NFR-011. **Dependencies:** US-010.
- **Acceptance criteria:**
  - Given a saved production-mode version, When the catalog is later refreshed, Then the version's bound snapshot is unchanged.

### US-012 - Detect drift and badge out-of-date versions
- **Persona:** P4. **Benefit:** Avoid acting on stale context.
- **Requirements:** FR-018, FR-020, NFR-012. **Dependencies:** US-011.
- **Acceptance criteria:**
  - Given a production context changed after a snapshot, When the user views an affected version, Then drift is flagged and the version shows a badge with the date its context fell out of date.
  - Given drift, When the user wants the newer baseline, Then they must create a new version to adopt it; the older version retains its creation-time configuration.

### US-013 - Configure isolated and aggregate experiments
- **Persona:** P4. **Benefit:** Measure target and sibling effects.
- **Requirements:** FR-021, FR-022, FR-023. **Dependencies:** US-010.
- **Acceptance criteria:**
  - Given a derived composition, When the user edits target/members/preamble, Then only the derived version changes, not the snapshot.
  - Given a single-target experiment, When the target lacks complete ground truth, Then the system warns/blocks per OQ-6.
  - Given an aggregate multi-label experiment, When any enabled detection lacks complete ground truth, Then the system warns/blocks per OQ-6.

## EPIC-005 - Evaluation-gated selection and promotion handoff

### US-014 - Consume an authoritative evaluation result
- **Persona:** P5. **Benefit:** Base selection on trustworthy evaluation.
- **Requirements:** FR-024, NFR-010. **Dependencies:** evaluation owners (OQ-1).
- **Acceptance criteria:**
  - Given an evaluation result, When Detection Setup reads it, Then it resolves version, snapshot, provider/model/settings, dataset/ground-truth revision, metric definition/version, per-detection results, failures, baseline, reviewer and decision.
  - (OQ-1) Metric/threshold/gate semantics confirmed with evaluation owners before Done.

### US-015 - Select the single evaluation-gated version
- **Persona:** P2/P5. **Benefit:** Track the one official version.
- **Requirements:** FR-025, FR-026. **Dependencies:** US-014.
- **Acceptance criteria:**
  - Given a version that passed the gate, When an authorized user selects it, Then it becomes the single selected version and any prior selection is replaced.
  - Given a version that has not passed the gate, When a user attempts selection, Then it is blocked.
  - Given a locked detection, When a non-owner/non-collaborator attempts selection, Then it is denied and audited.
  - Given selection, Then no production publication occurs as a result.

### US-016 - (Decision) Below-threshold approval override
- **Persona:** P2. **Benefit:** Allow justified approval of a complex detection.
- **Requirements:** FR-027. **Dependencies:** OQ-4.
- **Acceptance criteria (only if retained):**
  - Given a version below thresholds with a completed held-out eval, When an authorized user approves with a recorded justification, Then approval succeeds and the justification is audited.
  - Given no completed held-out eval, When override is attempted, Then it is blocked.
  - (OQ-4) If Delaney Foley decides not to retain override, this story is withdrawn.

### US-017 - Prepare and export a promotion handoff
- **Persona:** P5. **Benefit:** Give engineering a complete, reproducible package.
- **Requirements:** FR-028, FR-029, NFR-010. **Dependencies:** US-015.
- **Acceptance criteria:**
  - Given a selected version, When the user prepares the handoff, Then it includes version identity, bound snapshot, effective model/settings, evaluation result reference, and dataset/ground-truth revision.
  - Given a prepared handoff, When the user exports it, Then a complete, readable package is produced for engineering.

## EPIC-006 - Access control and auditability

### US-018 - Enforce Super-Admin-only access with shared visibility
- **Persona:** P1-P5. **Benefit:** Correct access posture.
- **Requirements:** FR-030, NFR-002, NFR-003. **Dependencies:** NFR-001.
- **Acceptance criteria:**
  - Given a Super Admin, When they open Detection Setup, Then they can see all detections and work.
  - Given a non-Super-Admin, When they attempt access, Then it is denied.

### US-019 - Record an attributable audit trail
- **Persona:** P2 (and all). **Benefit:** Accountable history.
- **Requirements:** FR-031, NFR-008. **Dependencies:** US-001.
- **Acceptance criteria:**
  - Given any mutating action (create, edit, version-create, delete, import, selection/approval, override), When it occurs, Then an audit event records actor, timestamp and affected entity.
  - (OQ-3) Audit retention period confirmed with Engineering before Done.

## Traceability summary

Full requirement to story to criterion to gap to slice mapping is maintained in [traceability.md](traceability.md).

## Known orphan / dependency notes
- FR-027 maps only to US-016, which is conditional on OQ-4.
- US-014/US-015 acceptance completion depends on OQ-1 (evaluation owners).
- US-010 design completion depends on OQ-2 (Engineering).
