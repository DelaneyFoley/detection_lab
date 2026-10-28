# Detection Setup - Production Non-Functional Requirements (MS-DET-01)

**Status:** DRAFT for review  
**Scope:** Detection Setup only. See [requirements.md](requirements.md) and [milestone-boundary.md](milestone-boundary.md).  
**Note:** NFR discovery proceeds even though the three AI-DLC extensions were deferred to Engineering. Concrete security/resiliency/testing practices and most numeric targets are owned by Engineering or Delaney Foley and are labeled `TBD` with an owner — no thresholds are invented.

Each NFR: statement, rationale/source, owner, verification method, target. Targets marked `TBD (owner)` are unresolved and blocking only for final target sign-off, not for requirement shape.

## Security and access

**NFR-001 - Authentication**  
All access uses the existing production authentication; unauthenticated users cannot reach Detection Setup.  
- Source: Owner B4, E2. Owner: Engineering. Verification: auth gate test. Target: production SSO/identity (mechanism TBD, Engineering).

**NFR-002 - Authorization (role + lock model)**  
Super-Admin-only page; action-level enforcement of the owner/collaborator lock model for edit and selection.  
- Source: Owner B1, B2, B4. Owner: Delaney Foley + Engineering. Verification: positive and negative permission tests per action. Target: 100% of mutating actions enforce role + lock rules.

**NFR-003 - Visibility / tenancy**  
All Super Admins can view all detections and work; no tenant isolation. Restrictions apply only to actions, not visibility.  
- Source: Owner B4. Owner: Delaney Foley. Verification: visibility test across users. Target: full shared visibility, action-scoped restriction.

**NFR-004 - Secret management**  
Provider credentials are centrally managed; no user-entered API keys in production.  
- Source: Owner E2 (A). Owner: Engineering. Verification: no user-key code path in production config; secrets sourced centrally. Target: central secret store (specific store TBD, Engineering).

**NFR-005 - Model governance**  
Only models from a centrally governed Gemini allow-list are selectable.  
- Source: Owner E1 (A). Owner: Delaney Foley + Engineering. Verification: selection restricted to allow-list; non-listed rejected. Target: enforced allow-list (contents/owner TBD).

**NFR-006 - Data handling and privacy**  
Quick Test images/results are ephemeral; prompt/image content sent to the provider follows organization data-handling policy.  
- Source: Owner C4, E3. Owner: Engineering (policy refs). Verification: no Quick Test persistence; policy-reference review. Target: per organization policy (references TBD, Engineering).

**NFR-007 - Retention and deletion**  
Detection/version/snapshot/audit retention and deletion follow organization policy; deletion rules per FR-012 (versions deletable only while unselected; datasets never deleted by version delete).  
- Source: Owner C2, E3. Owner: Engineering. Verification: retention config review; delete-rule tests. Target: per organization policy (TBD, Engineering).

## Auditability and observability

**NFR-008 - Auditability**  
Every mutating action (create, edit, version-create, delete, import, selection/approval, override) is attributable (actor, timestamp, entity) and retained.  
- Source: Planning contract; Owner governance. Owner: Delaney Foley + Engineering. Verification: audit event present per action; tamper-resistance review. Target: retention period TBD (Engineering).

**NFR-009 - Observability**  
Operations and failures (provider errors, import/compile failures, validation errors) are logged with enough context to diagnose, without leaking secrets or sensitive content.  
- Source: Prototype logging; planning contract. Owner: Engineering. Verification: structured logs; redaction review. Target: TBD (Engineering).

## Reproducibility and correctness

**NFR-010 - Reproducibility**  
A selected/approved version fully identifies what produced its result: version content, bound snapshot, effective provider/model/settings, dataset and ground-truth revision/split, and metric definition/version.  
- Source: Owner downstream-quality answer; outcome "reproducible evaluation configurations". Owner: Delaney Foley + evaluation owners. Verification: a selected version resolves all listed references. Target: 100% of selected versions carry complete provenance.

**NFR-011 - Snapshot and version immutability**  
Saved versions and bound snapshots never change after creation, including across catalog refreshes.  
- Source: Owner C1, D2. Owner: Delaney Foley. Verification: immutability tests across refresh/drift. Target: zero post-save mutation.

**NFR-012 - Aggregate integrity signalling**  
The system surfaces ground-truth incompleteness and context drift so users do not act on invalid metrics.  
- Source: Owner D2, downstream-quality answer. Owner: Delaney Foley. Verification: drift badge + incompleteness warning shown. Target: drift/incompleteness always signalled.

## Reliability and performance

**NFR-013 - Availability**  
Detection Setup is available during authoring workflows.  
- Source: Standard. Owner: Delaney Foley. Verification: TBD. Target: `TBD (Delaney Foley)` — no availability window supplied.

**NFR-014 - Quick Test responsiveness**  
Quick Test returns diagnostic results in an acceptable interactive time.  
- Source: Owner F3 (B). Owner: Delaney Foley. Verification: latency measurement. Target: `TBD (Delaney Foley)` — provider-bound; not inferred from prototype.

**NFR-015 - Concurrency / scale**  
Multiple Super Admin authors can work concurrently without data loss or lock-model violations.  
- Source: Owner F3 (B). Owner: Delaney Foley. Verification: concurrent-edit tests; single-selection invariant under concurrency. Target: concurrent-author count `TBD (Delaney Foley)`.

**NFR-016 - Resiliency of external calls**  
Provider and context-source failures are handled gracefully with clear user feedback and no partial/corrupt saves.  
- Source: Prototype error handling; resiliency practice deferred to Engineering. Owner: Engineering. Verification: fault-injection review. Target: TBD (Engineering).

## Usability and accessibility

**NFR-017 - Usability for non-engineers**  
Authorized non-engineering Super Admins can create and iterate on detections with reduced effort versus the current hand-off-to-engineering process.  
- Source: Owner outcomes. Owner: Delaney Foley. Verification: task-based usability measure. Target: effort-reduction measure `TBD (Delaney Foley)`.

**NFR-018 - Accessibility**  
The interface meets the organization's accessibility standard.  
- Source: Planning contract. Owner: Engineering/Design. Verification: accessibility audit. Target: standard `TBD (Engineering/Design)`.

## Cost and compliance

**NFR-019 - Cost controls**  
Provider usage (Quick Test, experiments) stays within organization budget/policy.  
- Source: Owner governance answer. Owner: Engineering. Verification: usage/budget review. Target: `TBD (Engineering)`.

**NFR-020 - Compliance with organization policy**  
Data governance, security and retention comply with existing organization policies.  
- Source: Owner E3, governance answers. Owner: Engineering. Verification: policy-conformance review against named references. Target: references `TBD (Engineering)`.

## Deferred engineering practices (not enabled extensions)

| Area | Decision | Owner |
| --- | --- | --- |
| Security baseline | Deferred to Engineering during production refinement/implementation | Engineering |
| Resiliency baseline | Deferred to Engineering | Engineering |
| Property-based testing | Deferred to Engineering | Engineering |

These are recorded so the production team addresses them explicitly; they are not enabled as blocking AI-DLC planning constraints for MS-DET-01.
