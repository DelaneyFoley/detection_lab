# Detection Setup Production Handoff - Index (MS-DET-01)

**Status:** DRAFT / BLOCKED — not yet ready for production development. See blockers below.  
**Milestone:** MS-DET-01 - Detection Setup (Inception, production-planning-only).  
**Prepared:** 2026-10-27. **Decision owner:** Delaney Foley.

This package specifies WHAT a separate production team must build for Detection Setup and WHY. It does not perform implementation, and no prototype code, tests, builds, or runtime data were modified or run.

## Agreed target scope

In scope: detection authoring (blank + Prompt Assist), ownership/lock/collaborator model, prompt versioning/history/deletion, Quick Test diagnostics (ephemeral, non-authoritative), production-context replication/snapshot/drift, isolated and aggregate experiments with ground-truth safeguards, authoritative evaluation-result consumption, single evaluation-gated selected version, promotion handoff, Super-Admin access control and auditability.

Out of scope (confirmed): direct production insertion and its controls (future MS-DET-02); detailed work on other capabilities; dataset/labeling workflows; production-source implementation; data migration; target architecture selection.

## Document map (milestone folder `inception/milestones/detection-setup/`)

| Artifact | File |
| --- | --- |
| Whole-product context map (shared) | [product-context-map.md](../../product-context-map.md) |
| Milestone boundary | [milestone-boundary.md](milestone-boundary.md) |
| Functional requirements | [requirements.md](requirements.md) |
| Non-functional requirements | [nfr.md](nfr.md) |
| Personas | [personas.md](personas.md) |
| User stories + acceptance criteria | [stories.md](stories.md) |
| Gap analysis | [gap-analysis.md](gap-analysis.md) |
| Prioritized backlog | [backlog.md](backlog.md) |
| Traceability | [traceability.md](traceability.md) |
| Risks, assumptions, decisions | [risks-and-decisions.md](risks-and-decisions.md) |
| Question/answer records | [questions/](questions) |
| State / audit (shared) | [../../../aidlc-state.md](../../../aidlc-state.md), [../../../audit.md](../../../audit.md) |

> All MS-DET-01 artifacts live in this folder. The whole-product context map and workflow state/audit are shared and stay at `aidlc-docs/inception/` and `aidlc-docs/` respectively.

## Sign-off status

| Item | Status |
| --- | --- |
| Milestone boundary | Approved 2026-10-27 |
| Requirements (FR) | Proposed — awaiting review |
| NFRs | Proposed — many targets TBD |
| Stories + acceptance criteria | Proposed — several decision-dependent |
| Gap analysis / backlog / traceability | Proposed |
| Overall handoff | DRAFT / BLOCKED |

## Blocking items before HANDOFF_READY

1. **OQ-1** evaluation metric/threshold/gate semantics (evaluation owners).
2. **OQ-2** authoritative context-source identity + import mechanism (Engineering).
3. **OQ-3** governance/security/retention policy references (Engineering).
4. **OQ-4** retain below-threshold approval override? (Delaney Foley).
5. **OQ-8** measurable success and NFR targets (Delaney Foley).

Non-blocking-for-shape but needed for Done: OQ-5, OQ-6, OQ-7.

## Rollout / migration / operational acceptance notes

- **Migration:** none — clean build (DEC-012).
- **Rollout:** promotion of a selected version to staging then production is performed by Engineering via the handoff package (FR-028/029); in-app direct insertion is deferred (MS-DET-02).
- **Operational acceptance:** auditability (FR-031), reproducibility (NFR-010), and access control (FR-030) are release-critical; their target values (retention, availability) remain TBD and must be set before go-live.

## Next step

Review [requirements.md](requirements.md), [nfr.md](nfr.md), [personas.md](personas.md) and [stories.md](stories.md). Request changes or approve. On approval, resolve the blocking OQs with their owners; the package remains DRAFT / BLOCKED until required decisions and acceptance criteria are no longer blocking. This package prepares work for a future production team and does not perform it.
