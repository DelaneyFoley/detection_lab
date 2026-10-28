# Detection Setup - Scope Confirmation After Answers

Your requirements answers (2026-10-27) refined MS-DET-01. Most answers slotted directly into the boundary, but one reverses an earlier inclusion, so I need one explicit confirmation before drafting detailed requirements.

## What changed from your answers

- **Direct production insertion is now OUT of scope for MS-DET-01** and treated as a future enhancement (prospective MS-DET-02). Your answers to B3, D3, D4 and D5 state insertion, activation, rollback and sibling-regression insertion-gating are future work, and that promotion will target staging then production rather than direct-to-production.
- MS-DET-01 now ends at: authoring, prompt versioning/history, Quick Test, production-context replication/snapshot/drift, evaluation-gated selection/approval, and the **promotion handoff** (preparing the selected version and references an engineer needs).
- Context-source binding, data-governance/security references, and the security/resiliency/PBT engineering practices are deferred to Engineering during refinement.
- No data migration (clean build). All success measures and NFR targets are TBD with named owners.

## Question 1: Confirm the narrowed scope

Do you confirm MS-DET-01 as described in the updated [milestone boundary](../milestone-boundary.md), with direct production insertion deferred to a future milestone?

A) Confirmed. Draft the Detection Setup requirements, NFRs and stories for this narrowed scope.

B) Mostly correct, but adjust the scope as I describe after `[Answer]:` before drafting.

C) No — direct production insertion must stay in this milestone. (Note: this conflicts with answers B3/D3/D4/D5; describe how to reconcile after `[Answer]:`.)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A

## Question 2: Future-enhancement intents

May I record your insertion-related intents (staged-then-direct activation, automatic rollback with audit, warn-with-override on sibling regression) as a documented future-milestone appendix in the handoff, so they are preserved but clearly not MS-DET-01 deliverables?

A) Yes — record them as a future-milestone appendix.

B) No — leave them out of the handoff entirely for now.

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A
