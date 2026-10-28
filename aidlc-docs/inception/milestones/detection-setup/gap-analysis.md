# Detection Setup - Gap Analysis (MS-DET-01)

**Status:** DRAFT for review. Compares current prototype evidence against the confirmed target requirements. Recommendations are proposals for the production team, pending approval. "Keep/Replace/Add/Retire" refers to the production rebuild, not edits to the prototype (no prototype changes are made).

## Method

Evidence is the inspected prototype (source, API routes, schemas, README). Runtime behavior was not tested. The target is a clean production rebuild. Gaps are classified by the production action recommended.

## Gap register

| ID | Area | Current evidence (prototype) | Target requirement | Recommendation | Priority | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-001 | Identity/roles | API routes have no production identity/role enforcement; actions are open | FR-030, NFR-001/002/003 Super-Admin gating + lock model | Add production authN/Z from existing identity system | Must | Engineering + Delaney Foley |
| GAP-002 | Ownership/lock | No owner/lock/collaborator concept on detections | FR-003/004/005 | Add ownership, lock, collaborator model | Must | Delaney Foley |
| GAP-003 | Version immutability | Versions created new, but no explicit immutability guarantee/enforcement | FR-009, NFR-011 | Add enforced immutability | Must | Delaney Foley |
| GAP-004 | Deletion rules | Cascade delete removes runs; dataset preservation present, but no "block if selected" rule tied to production selection semantics | FR-012 | Keep dataset-preserving delete; add block-on-selected rule | Must | Delaney Foley |
| GAP-005 | Selection/approval gate | Approval checks held-out eval + thresholds with override; single approved version tracked | FR-025/026, BR-2/3 | Keep gate concept; formalize single-selection + permissions; confirm override (OQ-4) | Must | Delaney Foley + evaluation owners |
| GAP-006 | Evaluation result contract | Evaluation evidence read from run records ad hoc | FR-024, NFR-010 | Add a defined authoritative evaluation-result contract | Must | Delaney Foley + evaluation owners |
| GAP-007 | Context source | Compiles a local `ai-services` checkout via Python | FR-017/018, OQ-2 | Replace with production-source binding chosen by Engineering | Must | Engineering |
| GAP-008 | Snapshot/drift | Snapshots + provenance exist; drift exposure present in catalog meta | FR-019/020, NFR-011/012 | Keep snapshot model; add drift badge with out-of-date date + new-version-required rule | Should | Delaney Foley |
| GAP-009 | Ground-truth completeness | Multi-label scoring treats absent labels as negatives; limited safeguard | FR-023, NFR-012 | Add completeness warn/block (OQ-6) | Should | Delaney Foley + evaluation owners |
| GAP-010 | Quick Test retention | Uploaded images processed in-request; no explicit retention policy statement | FR-015/016 | Confirm ephemeral handling; add non-authoritative guardrail | Must | Delaney Foley |
| GAP-011 | Secrets/model policy | Accepts session key or env var; broad provider list incl. non-Gemini | FR (model), NFR-004/005 | Replace with central secrets + Gemini allow-list | Must | Engineering |
| GAP-012 | Auditability | Logging exists; no attributable domain audit trail | FR-031, NFR-008 | Add attributable audit for all mutating actions | Must | Delaney Foley + Engineering |
| GAP-013 | Promotion handoff | Finalized prompt/dataset handed to engineering manually, outside the app | FR-028/029 | Add in-app promotion handoff package assembly/export | Should | Delaney Foley + Engineering |
| GAP-014 | Persistence/architecture | Local SQLite + filesystem uploads | Target architecture (rebuild) | Replace per Engineering target architecture (TBD) | Must | Engineering |
| GAP-015 | Non-Gemini providers | Prototype supports OpenAI/Anthropic code paths | Gemini-only policy (E1) | Retire non-Gemini paths for production scope | Should | Delaney Foley |
| GAP-016 | Governance/security practices | None formalized | NFR-006/007/016/018/020; deferred extensions | Add per Engineering policy references (TBD) | Must | Engineering |

## Keep / Replace / Add / Retire summary

- **Keep (concept, rebuilt):** detection/prompt-version model, snapshot/provenance model, dataset-preserving delete, evaluation-gated single approved version, Quick Test diagnostics, prompt grouping/version notes.
- **Replace:** context-source binding, persistence/architecture, credential handling, provider breadth.
- **Add:** production identity/role + lock model, enforced immutability, drift badge, ground-truth completeness safeguard, evaluation-result contract, attributable audit, promotion handoff assembly/export.
- **Retire (for this scope):** non-Gemini provider paths; any direct-to-production assumptions (deferred to MS-DET-02).

## Blocking dependencies

- OQ-1 (evaluation contract), OQ-2 (context source), OQ-3 (governance refs), OQ-4 (override), OQ-8 (targets) must be resolved to finalize acceptance criteria and sign-off. See [risks-and-decisions.md](risks-and-decisions.md).
