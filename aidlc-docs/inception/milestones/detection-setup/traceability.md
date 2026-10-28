# Detection Setup - Traceability (MS-DET-01)

**Status:** DRAFT for review. Links requirement → story → acceptance criterion → gap → delivery slice → proposed verification. Use to find orphans and unresolved items.

| Requirement | Story | Key acceptance criterion | Gap | Slice | Verification |
| --- | --- | --- | --- | --- | --- |
| FR-001 | US-001 | Valid create saves + records owner | GAP-002 | S3 | Create acceptance test |
| FR-002 | US-002 | Draft editable, explicit save | GAP-011 | S4 | Prompt Assist test |
| FR-003 | US-001 | Owner recorded at creation | GAP-002 | S3 | Record inspection |
| FR-004 | US-003 | Locked edit/select restricted | GAP-002 | S3 | Permission tests |
| FR-005 | US-003 | Collaborator rights change | GAP-002 | S3 | Permission tests |
| FR-006 | US-004 | Edit creates new version | GAP-003 | S3/S5 | Edit+version test |
| FR-007 | US-001 | Duplicate code rejected | GAP-002 | S3 | Validation test |
| FR-008 | US-005 | Version persists w/ settings | GAP-003 | S5 | Create version test |
| FR-009 | US-004/US-005 | Prior version unchanged | GAP-003 | S5 | Immutability test |
| FR-010 | US-006 | Grouping w/ metadata | — | S5 | Group test |
| FR-011 | US-005 | History listed (OQ-7) | — | S5 | History display test |
| FR-012 | US-007 | Delete rules (runs vs datasets) | GAP-004 | S6 | Delete behavior tests |
| FR-013 | US-008 | Selection drives preview | — | S5 | Working-context test |
| FR-014 | US-009 | Per-image diagnostics | — | S7 | Quick Test run test |
| FR-015 | US-009 | No persistence post-session | GAP-010 | S7 | Persistence check |
| FR-016 | US-009 | Cannot gate selection | GAP-010 | S7 | Gate-exclusion test |
| FR-017 | US-010 | Import usable context (OQ-2) | GAP-007 | S8 | Import test |
| FR-018 | US-012 | Refresh preserves saved | GAP-008 | S8/S9 | Refresh test |
| FR-019 | US-011 | Snapshot immutable on refresh | GAP-008 | S8 | Immutability test |
| FR-020 | US-012 | Drift flagged + badge | GAP-008 | S9 | Drift test |
| FR-021 | US-013 | Derived edit only | GAP-008 | S9 | Composition test |
| FR-022 | US-013 | Isolated+aggregate expressible | GAP-009 | S9 | Config test |
| FR-023 | US-013 | Completeness warn/block (OQ-6) | GAP-009 | S9 | Completeness test |
| FR-024 | US-014 | Result resolves provenance (OQ-1) | GAP-006 | S10 | Contract review |
| FR-025 | US-015 | Single gated selection | GAP-005 | S10 | Selection invariant test |
| FR-026 | US-015 | Selection permissions | GAP-005 | S10 | Permission tests |
| FR-027 | US-016 | Override w/ justification (OQ-4) | GAP-005 | S10 | Conditional test |
| FR-028 | US-017 | Handoff references complete | GAP-013 | S12 | Package review |
| FR-029 | US-017 | Export complete package | GAP-013 | S12 | Export test |
| FR-030 | US-018 | Super-Admin-only + shared visibility | GAP-001 | S1 | Access tests |
| FR-031 | US-019 | Attributable audit per action (OQ-3) | GAP-012 | S2 | Audit event tests |

## Orphan / completeness check

- **Requirements without a story:** none.
- **Stories without a requirement:** none.
- **Stories with conditional acceptance (decision-dependent):** US-005 (OQ-7), US-009 (OQ-5), US-010 (OQ-2), US-013 (OQ-6), US-014 (OQ-1), US-015/US-016 (OQ-4), US-019 (OQ-3).
- **NFRs → slices:** NFR-001/002/003 → S1; NFR-004/005 → S11; NFR-006/007/016/018/019/020 → S13; NFR-008 → S2; NFR-010/011/012 → S8/S9/S10/S12.
- **Untestable-as-written criteria:** none identified; however criteria tied to `TBD` targets (OQ-1, OQ-3, OQ-8) cannot be fully verified until values are supplied.
