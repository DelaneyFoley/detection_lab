---
description: "Start a documentation-only AI-DLC Inception workflow to translate the Detection Lab prototype into a production requirements and delivery handoff."
agent: AI-DLC Production Planner
---

Follow [the production-planning contract](../agents/aidlc-production-planner.agent.md).

Start AWS AI-DLC v1.0.1 production planning for Detection Lab. If state already
exists, offer to resume rather than overwriting it.

Use the prototype as read-only evidence, not as the production specification.
Write only Markdown under `aidlc-docs/`. Discover the current behavior, then
interview me about the desired production product. Produce confirmed
requirements, NFRs, personas, user stories with acceptance criteria, a prioritized
backlog, prototype-to-production gaps, traceability, and a team handoff.

Use comprehensive Inception depth and retain approval gates. Start with
workspace detection and evidence-backed reverse engineering. Do not skip ahead
to invent requirements before asking me. Never modify the prototype or enter
Construction/Operations.
