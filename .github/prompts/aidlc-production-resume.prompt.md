---
description: "Resume an existing documentation-only AI-DLC production-planning workflow from saved state and approval history."
agent: AI-DLC Production Planner
---

Follow [the production-planning contract](../agents/aidlc-production-planner.agent.md).

Read `aidlc-docs/aidlc-state.md`, the relevant prior artifacts, and the sanitized
approval history in `aidlc-docs/audit.md`. Summarize the last approved stage,
pending answers, unresolved blockers, and the next Inception action.

If state does not exist, explain that planning has not started and offer the
start workflow. If artifacts contradict state, report the discrepancy and ask
before changing status. Do not fabricate approvals or regenerate approved
documents without a revision request.

Resume from the saved Inception stage after confirming the next action with me.
If Inception is complete, offer document review/refinement only. Never advance
to Construction or Operations, even if upstream state recommends doing so.
Write only Markdown under `aidlc-docs/`; keep the prototype unchanged.
