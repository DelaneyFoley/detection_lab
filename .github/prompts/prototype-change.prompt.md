---
description: "Clarify and plan a coherent prototype change, then implement only after approval of its change contract."
agent: Prototype Change Partner
---

Follow [the prototype agent contract](../agents/prototype-change-partner.agent.md).
Read `prototype-docs/state.md` and the relevant requirements/workflows, diagnostic
findings and decisions before acting on the user's requested change.

Trace cross-tab/data/API impact, ask material intent questions, and create the
next `prototype-docs/changes/PC-###.md` with scope, non-goals, affected requirement
IDs, acceptance criteria, verification and data/rollback considerations.
If the request does not yet describe a change, ask for the desired user outcome.

Stop for explicit approval of the named contract before implementation.
Diagnostic review is not implementation approval. After approval, implement and
verify that bounded change and update living prototype docs. Never change
production-plan artifacts or turn an experiment into an approved requirement.
