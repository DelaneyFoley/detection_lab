# Detection Setup - Risks, Assumptions and Decisions (MS-DET-01)

**Status:** DRAFT for review. Captures decisions made, assumptions, risks and open questions with owners. Decision IDs `DEC-###`, risks `RISK-###`.

## Decisions (recorded)

| ID | Decision | Source | Owner | Status |
| --- | --- | --- | --- | --- |
| DEC-001 | MS-DET-01 is the only milestone in detailed scope; others at interface level | User instruction + boundary approval 2026-10-27 | Delaney Foley | Approved |
| DEC-002 | All named setup aids (Prompt Assist, Quick Test, replication/snapshot, grouping, version notes) are in scope | Owner answers | Delaney Foley | Approved |
| DEC-003 | Direct production insertion deferred to future MS-DET-02 | Owner B3/D3/D4/D5 + scope confirmation A | Delaney Foley | Approved |
| DEC-004 | Future insertion intents recorded as a future-milestone appendix | Scope confirmation Q2 = A | Delaney Foley | Approved |
| DEC-005 | Super-Admin-only page; shared visibility; action-level lock model | Owner B1/B2/B4 | Delaney Foley | Approved |
| DEC-006 | Immutable saved versions; new-version-on-change | Owner C1 | Delaney Foley | Approved |
| DEC-007 | Hard delete only for unapproved/unselected versions; deletes run logs not datasets | Owner C2 | Delaney Foley | Approved |
| DEC-008 | Prompt Assist output always human-reviewed before save | Owner C3 | Delaney Foley | Approved |
| DEC-009 | Quick Test ephemeral and non-authoritative | Owner C4 | Delaney Foley | Approved |
| DEC-010 | Drift flagged; new version required; older versions keep config + out-of-date badge | Owner D2 | Delaney Foley | Approved |
| DEC-011 | Gemini-only via central allow-list; central secrets, no user keys | Owner E1/E2 | Delaney Foley + Engineering | Approved |
| DEC-012 | Clean build; no data migration | Owner F1 | Delaney Foley | Approved |
| DEC-013 | Security/Resiliency/PBT extensions deferred to Engineering (not enabled) | Owner A1/A2/A3 | Delaney Foley → Engineering | Approved |

## Assumptions

| ID | Assumption | Owner | Validation needed |
| --- | --- | --- | --- |
| AS-001 | Existing production identity system provides Super Admin (and future Detection Manager) roles | Engineering | Confirm role availability + API |
| AS-002 | Authoritative production context is the production `ai-services` configuration | Engineering | Confirm source + access method |
| AS-003 | Finalized ground truth is produced upstream by Annotation/QA | Delaney Foley | Confirm interface/revision semantics |
| AS-004 | Organization policies exist for retention/security/budget | Engineering | Obtain references |

## Open questions (blocking status)

| OQ | Question | Owner | Blocking |
| --- | --- | --- | --- |
| OQ-1 | Evaluation metric/threshold/split/gate semantics | Evaluation owners | Blocks acceptance sign-off for FR-024/025 |
| OQ-2 | Production context source identity + import mechanism | Engineering | Blocks S8 design detail |
| OQ-3 | Governance/security/retention policy references | Engineering | Blocks NFR targets + S2/S11/S13 |
| OQ-4 | Retain below-threshold approval override | Delaney Foley | Blocks FR-027/US-016 |
| OQ-5 | Quick Test image/size limits | Delaney Foley | Non-blocking |
| OQ-6 | Ground-truth completeness warn vs block + threshold | Delaney Foley + evaluation owners | Non-blocking for shape |
| OQ-7 | Definition of "understandable" history | Delaney Foley | Non-blocking |
| OQ-8 | All measurable success/NFR targets | Delaney Foley | Blocks target sign-off |

## Risks

| ID | Risk | Impact | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| RISK-001 | Evaluation contract undefined delays selection work | High | Medium | Resolve OQ-1 early with evaluation owners | Delaney Foley |
| RISK-002 | Context-source binding differs from prototype's local compile | Medium | High | Engineering defines source contract before S8 | Engineering |
| RISK-003 | Absent labels silently invalidate aggregate metrics | High | Medium | Enforce completeness safeguard (FR-023) | Delaney Foley |
| RISK-004 | Treating prototype stack/architecture as target | Medium | Medium | Rebuild; architecture owned by Engineering | Engineering |
| RISK-005 | Missing NFR targets block go-live acceptance | Medium | High | Owner supplies targets during handoff review | Delaney Foley |
| RISK-006 | Scope creep from future-insertion intents | Medium | Medium | Appendix clearly marks MS-DET-02 | Delaney Foley |
| RISK-007 | Audit/governance gaps if Engineering refs arrive late | Medium | Medium | Track OQ-3 as release blocker for S2/S13 | Engineering |

## Future-milestone appendix (MS-DET-02 - recorded per DEC-004)

Not in MS-DET-01 scope; preserved for continuity:
- **Direct insertion:** authorized user inserts a selected version into staging then production.
- **Activation:** likely staged first, possibly direct later once viability/consistency is proven; precedent is pushing notification rules/templates/organization settings from the platform UI.
- **Rollback:** automatic rollback to the previously live version with an audit record.
- **Sibling-regression gating:** warn-with-override when evaluation shows regression in sibling detections beyond an agreed threshold.
- **Permission:** Super Admin + Detection Manager permission and Detection Owner/collaborator on the detection.
