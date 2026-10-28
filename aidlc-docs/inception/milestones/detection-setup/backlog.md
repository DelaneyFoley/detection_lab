# Detection Setup - Prioritized Delivery Backlog (MS-DET-01)

**Status:** DRAFT for review. A local backlog for human review and later import. No tickets are published automatically. Slices are dependency-ordered; placement is a proposal, not a schedule or estimate.

## Legend
- **Priority:** Must / Should / Could.
- **Readiness:** Ready (shape clear) / Blocked (needs an OQ resolved).
- Owners/roles reference [personas.md](personas.md) and [risks-and-decisions.md](risks-and-decisions.md).

## Release placement (proposed)

- **Foundation (R1):** access control, identity, data model, auditability.
- **Authoring (R2):** detection + prompt version authoring, history, deletion.
- **Validation (R3):** Quick Test, production-context replication, drift, experiments.
- **Selection & handoff (R4):** evaluation-result contract, selection, promotion handoff.
- **Future (MS-DET-02):** direct production insertion.

## Backlog

| Slice | Stories | Requirements | Priority | Readiness | Depends on | Owner/role |
| --- | --- | --- | --- | --- | --- | --- |
| S1 - Access & identity | US-018 | FR-030, NFR-001/002/003 | Must | Blocked (OQ via Engineering identity) | — | Engineering + Delaney Foley |
| S2 - Audit foundation | US-019 | FR-031, NFR-008 | Must | Blocked (OQ-3 retention) | S1 | Engineering + Delaney Foley |
| S3 - Detection authoring & ownership | US-001, US-003, US-004 | FR-001/003/004/005/006/007 | Must | Ready | S1 | Delaney Foley |
| S4 - Prompt Assist | US-002 | FR-002, NFR-004/005 | Should | Ready | S3, S11 | Delaney Foley |
| S5 - Prompt versions & history | US-005, US-006, US-008 | FR-008/009/010/011/013 | Must | Ready (OQ-7 for "understandable" accept) | S3 | Delaney Foley |
| S6 - Safe deletion | US-007 | FR-012 | Must | Ready | S5 | Delaney Foley |
| S7 - Quick Test | US-009 | FR-014/015/016, NFR-004/005 | Should | Ready (OQ-5 limits) | S5, S11 | Delaney Foley |
| S8 - Context replication & snapshots | US-010, US-011 | FR-017/018/019, NFR-011 | Must | Blocked (OQ-2 source) | S3 | Engineering + Delaney Foley |
| S9 - Drift & experiments | US-012, US-013 | FR-020/021/022/023, NFR-012 | Should | Blocked (OQ-6 completeness rule) | S8 | Delaney Foley |
| S10 - Evaluation contract & selection | US-014, US-015, (US-016) | FR-024/025/026/(027) | Must | Blocked (OQ-1, OQ-4) | S5, S2 | Delaney Foley + evaluation owners |
| S11 - Model & secret policy | — (NFR enablement) | NFR-004/005 | Must | Blocked (OQ-3 refs) | S1 | Engineering |
| S12 - Promotion handoff | US-017 | FR-028/029, NFR-010 | Should | Ready after S10 | S10 | Delaney Foley + Engineering |
| S13 - Governance/security hardening | — | NFR-006/007/016/018/019/020 | Must | Blocked (Engineering policy refs) | S1 | Engineering |

## Readiness and blockers

- **Ready to refine now:** S3, S5, S6, S7 (with noted OQs), S4.
- **Blocked pending decisions:** S1/S2/S11/S13 (Engineering identity/policy), S8/S9 (context source + completeness), S10/S12 (evaluation contract + override).
- No delivery estimates are provided; the production team sizes these after decision resolution.

## Out of scope (future backlog seed)
- MS-DET-02: direct insertion, activation (staged→possibly direct), automatic rollback with audit, warn-with-override sibling-regression gating, Detection Manager permission. Captured in [risks-and-decisions.md](risks-and-decisions.md).
