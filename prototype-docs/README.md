# Living prototype: starting point and change workflow

This is the whole-prototype evidence and intent workspace, separate from the
[production-planning package](../aidlc-docs/aidlc-state.md).

## Start here

1. Read [state](state.md), [baseline inventory](baseline.md), and the
   [requirements register](requirements.md).
2. Review [diagnostic findings](diagnostics.md) and answer the first batch in
   [intent questions](questions.md). Answering questions does not authorize fixes.
3. Use **Prototype Change Partner** in Copilot Chat and
   `/prototype-resume` to discuss the saved review. Use `/prototype-diagnostic`
   to refresh diagnostics after meaningful prototype changes.
4. To change behavior, use `/prototype-change` with the desired outcome or a
   diagnostic ID. Review and explicitly approve its `PC-###` change contract.
   The agent then implements, verifies, and updates this baseline.

If commands/agent are missing, reload VS Code and inspect the workspace
customizations menu or use **Chat: Run Prompt**. The editor must support custom
agents/prompt files and allow workspace customizations. Live picker discovery
has not been verified by writing these files.

Suggested first message:

```text
/prototype-resume
Start with the initial coherence diagnostic, not new features.
Walk me through the highest-impact unanswered intent questions in small batches.
Keep current behavior distinct from what I confirm I want.
Do not implement fixes until I approve a named change contract.
```

## Artifact responsibilities

| Artifact | Responsibility |
| --- | --- |
| [baseline.md](baseline.md) | Whole-app surfaces, journeys, data/interfaces, cross-tab dependencies, evidence limits |
| [requirements.md](requirements.md) | Stable PR IDs, observed behavior, intent status and proposed checks |
| [diagnostics.md](diagnostics.md) | Prioritized PD findings, classification, evidence and proposed disposition |
| [questions.md](questions.md) | PQ intent questions in small batches, options, blank/recorded answers |
| [decisions.md](decisions.md) | Prototype-specific decisions and change history, not copied production commitments |
| [state.md](state.md) | Baseline revision, mode, verification, pending approvals and next action |
| `changes/PC-###.md` (created per change) | Approved scope, acceptance, implementation and verification record |

## What this baseline does and does not mean

The register is a reverse-engineered starting point, not your implicit approval
of everything the code does. Initial intent is **UNCONFIRMED**. Source evidence
is **OBSERVED_IN_CODE**, not a claim that the UI was exercised. Individual tests
may support specific algorithms without validating the whole journey.

The two independent status axes are:

- Intent: `UNCONFIRMED`, `CONFIRMED`, `EXPERIMENT`, `REJECTED`, `SUPERSEDED`.
- Delivery: `OBSERVED_IN_CODE`, `TEST_SUPPORTED`, `RUNTIME_VERIFIED`,
  `NOT_IMPLEMENTED`, `KNOWN_GAP`.

Full inventory means every known capability area has been represented. It is
not exhaustive acceptance coverage, a security review, performance measurement,
or a declaration that all current behavior is correct. Proposed checks in the
register are NOT executed tests. Unknowns stay unknown until answered/tested.

## Sustainable maintenance

For each meaningful change, maintain this chain:

`request -> PR/WF impact -> PQ/PDEC decisions -> approved PC -> code/tests -> docs`

Keep stable IDs and mark superseded records rather than deleting history.
Use scoped baseline updates, not a full rewrite after every edit. Cosmetic
changes do not require new requirements unless they alter behavior.
The [agent contract](../.github/agents/prototype-change-partner.agent.md) defines
approval and validation rules. It is AI-DLC-inspired, not a second installation
of the formal AWS workflow.

There are **two separate approval boundaries**:

1. Confirming prototype intent/accepting the baseline.
2. Authorizing an implementation contract for specified behavior.

Production requirements have a third, independent approval in the production
planner. When ready, ask it to read this baseline plus the code as evidence; do
not copy requirements into production as automatically approved.

## Safety

The agent can edit and execute commands for approved development; this is not a
filesystem sandbox. In diagnostic mode it is instructed to edit Markdown only
here and avoid app/runtime mutations. Review permissions and diffs. No real data,
credentials, model calls, deployments, commits or external publishing are
authorized by initialization. Use synthetic fixtures for validation.
