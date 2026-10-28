# AI-DLC: prototype to production-development handoff

## What is installed

AWS AI-DLC **v1.0.1**, configured for GitHub Copilot in this workspace. The
[release provenance](.aidlc-rule-details/PROVENANCE.md) records the source,
resolved commit, archive checksum, and license.

**Your prototype is evidence, not a specification and not an implementation
target for this workflow.** This setup uses AI-DLC's Inception phase to discover
what exists, clarify what production should do, and prepare work for a production
development team. It does not change application code or deploy anything.

AI-DLC is a workflow of instructions, not an AWS runtime service. No AWS account,
AWS credentials, SDK installation, npm dependency, or application server is
needed for planning. You do need GitHub Copilot Chat access and a model available
under your organization's policy. Your normal Copilot data-handling policy still
applies; do not supply confidential records or credentials.

## First use in VS Code

1. Open the **repository root** as your VS Code workspace.
2. Open Copilot Chat (`Cmd+Ctrl+I` on macOS, `Ctrl+Alt+I` on Windows/Linux,
   or use the **Chat: Open Chat** command).
3. In the chat agent picker, select **AI-DLC Production Planner**.
4. Type **`/aidlc-production-plan`** and send it.
5. Review the current-state inventory it produces. Correct its interpretation
   of the prototype before approving it.
6. Answer the requirements and story questions, then approve each stage only
   when it reflects your intended production product.

The prompt also names the custom agent, so selecting it explicitly is a useful
visibility check rather than a second configuration requirement.

If the agent or commands are not visible:

- Run **Developer: Reload Window**, then reopen Chat.
- Check that the workspace is trusted and your Copilot/VS Code version supports
  workspace custom agents and prompt files.
- Use Chat's customization/configuration menu to locate
  [the agent](.github/agents/aidlc-production-planner.agent.md),
  [the start prompt](.github/prompts/aidlc-production-plan.prompt.md), and
  [the resume prompt](.github/prompts/aidlc-production-resume.prompt.md).
  UI labels vary by VS Code version. You can also use **Chat: Run Prompt** from
  the Command Palette, or the prompt editor's run button.
- Verify [workspace instructions](.github/copilot-instructions.md) are enabled.
  If custom agents are unavailable, use regular Agent mode and explicitly attach
  the planning contract and start prompt. The instructions still apply, but the
  custom agent's restricted tool selection will not carry over automatically.

## What to tell it

The start command already sets the planning boundary. Add business context such
as this, replacing the bracketed information:

```text
This prototype demonstrates workflows, not the approved production architecture.
The production users are [roles/teams].
The business outcome is [outcome].
The first release must include [capabilities] and exclude [non-goals].
Known constraints are [platform, integrations, data policy, deadline, budget].
Ask me to confirm behavior rather than treating all prototype features as required.
Use TBD with an owner for any production target I have not supplied.
Do not implement anything.
```

You do not need all answers up front. It should interview you, not fabricate
answers. In particular, confirm:

- Which detection, prompt/version, dataset, labeling/HIL, evaluation, comparison,
  and export workflows belong in production.
- Who uses them, who approves/reviews them, and which permissions are required.
- Data sources, rights/provenance, sensitive data, retention, and audit needs.
- Model/provider policy, quality metrics, reproducibility, cost, and human review.
- Expected workload, performance/reliability targets, and recovery requirements.
- Whether production is a rebuild, reuse, or hybrid; target platforms and
  integrations are decisions, not automatically AWS or the prototype's stack.

## How the working sessions proceed

| Stage | What you do | What Copilot produces |
| --- | --- | --- |
| Workspace detection + reverse engineering | Review and correct its account of the prototype | Evidence-backed current-state inventory, journeys, APIs and architecture |
| Requirements analysis | Answer questions; confirm scope, rules and measurable targets | Functional requirements, production NFRs, assumptions and unresolved questions |
| User stories | Approve the story plan, then review stories and criteria | Personas, epics, stories and verifiable acceptance criteria |
| Workflow planning + optional Inception design/units | Agree on delivery slices, boundaries and dependencies | Planning sequence and, where useful, proposed target components/work units |
| Production handoff | Review gaps, priorities, traceability and blockers; sign off | A document package for the production team; no implementation |

Questions are saved under `aidlc-docs/inception/`, often in a requirements or
plans subfolder, with `[Answer]:` fields. Either fill those fields and save the
file, or answer in chat and ask Copilot to record the answers. Review its
transcription. The model must stop for missing answers and explicit stage
approvals; a tool permission dialog is not a business approval.

AI-DLC also asks whether to enable its security, resiliency, and property-based
testing extensions. Answer explicitly. In this mode, enabled extensions inform
requirements and proposed verification only; they do not authorize code changes,
test execution, or deployment. NFR discovery still happens even if an optional
extension is declined.

Useful replies:

```text
The inventory is incorrect: [correction]. Revise it before proceeding.

Record these answers in the question file: Q1 ..., Q2 ...

Approve the Requirements Analysis artifacts only. Continue to User Stories.

US-004 needs a permission-denied and provider-timeout acceptance criterion.

Show requirements with no story, stories with no requirement, and unresolved TBDs.

Keep this package DRAFT until the platform owner supplies the availability target.
```

## Where the results go

All generated artifacts go under **`aidlc-docs/`**; the folder is created when you
start planning, not pre-populated with guessed requirements during installation.
It is not gitignored, so you can version approved documentation after reviewing
it for sensitive information.

The key outputs are:

| Path under `aidlc-docs/` | Purpose |
| --- | --- |
| `aidlc-state.md` | Current stage, planning-only boundary, extension choices and approvals |
| `audit.md` | Sanitized decision and approval history |
| `inception/reverse-engineering/` | As-is prototype evidence, not a production endorsement |
| `inception/requirements/requirements.md` | Production scope and functional requirements |
| `inception/requirements/production-nfr.md` | Measurable quality/operational requirements and open targets |
| `inception/user-stories/stories.md` and `personas.md` | User stories, acceptance criteria and personas |
| `inception/production-handoff/gap-analysis.md` | What production must add, change, replace or retire |
| `inception/production-handoff/backlog.md` | Prioritized, dependency-aware work for the delivery team |
| `inception/production-handoff/traceability.md` | Requirements linked through stories, criteria, gaps and verification |
| `inception/production-handoff/risks-and-decisions.md` | Open decisions, owners, assumptions and risks |
| `inception/production-handoff/README.md` | Team handoff index, scope, sign-off status and blockers |

Standard upstream plans/design artifacts may also be created within Inception.
Requirements, stories, and gaps have stable IDs so you can track revisions.
Proposed acceptance tests are specifications, not claims that tests have run.

## Resume or revise

For ongoing prototype development, use the separate
[Prototype Change Partner workflow](prototype-docs/README.md). It maintains
whole-prototype intent, source evidence, decisions and diagnostics without
rewriting this production package. When refreshing production planning, ask the
planner to read that baseline plus current code; unconfirmed observations and
even confirmed prototype requirements are not automatically approved production
requirements.

Open a new chat, choose **AI-DLC Production Planner**, and run:

```text
/aidlc-production-resume
```

It reads the saved state and relevant artifacts, summarizes pending decisions,
and confirms the next action. Do not rerun the start command to erase history.
For changes after approval, request a revision with impacted IDs:

```text
Revise FR-003 and its linked stories for [new decision].
Show the impact on acceptance criteria, NFRs, gaps, priorities and dependencies.
Keep existing IDs and request reapproval of affected documents.
```

If files and state disagree, resolve the discrepancy rather than assuming an
approval. If the prototype changes, request an evidence refresh and an impact
review; do not let new prototype behavior silently become a requirement.

## When it is ready for production development

The handoff is ready only when:

- Scope and non-goals are agreed by the responsible stakeholders.
- Prioritized stories trace to requirements and have testable acceptance criteria.
- NFRs have agreed metrics, thresholds, workloads and verification methods.
- Gaps and dependencies have delivery slices and responsible owners/roles.
- Architecture/platform/migration choices are agreed or explicitly delegated
  with non-blocking status; no blocking decisions remain disguised as assumptions.
- The final handoff records actual approval, not AI-inferred approval.

Until then, it stays **DRAFT / BLOCKED**. A complete package ends at
**INCEPTION_COMPLETE / HANDOFF_READY** and stops. Give the handoff folder and
linked artifacts to the production team for review and ticket import. No tickets
are published automatically, no delivery estimates are invented, and production
implementation should happen in a separately authorized development workflow.

## Safety and maintenance

- Normal coding chats do not automatically start AI-DLC. The
  [workspace router](.github/copilot-instructions.md) activates it only on request.
- The [planning agent](.github/agents/aidlc-production-planner.agent.md) has
  read/search/edit tools, but no terminal, web or delegation tools. Its contract
  permits Markdown edits only in `aidlc-docs/`.
- **This is not a filesystem sandbox.** Instructions guide the model; the edit
  tool is not technically path-restricted. Review edit permissions and diffs,
  reject any application edit, and keep normal source-control safeguards.
- No source/runtime/configuration changes are part of planning, even after
  "approve" or "continue". Never provide credentials or production records.
- Keep the bundled release rules unchanged. Do not switch to the moving `v1`
  branch or 2.0 preview without approval. For an approved upgrade, replace the
  vendor files, update provenance, and recheck the local boundary and prompts.

### Installation verification

The setup was checked for release-file equality, valid customization
frontmatter, local links, and preservation of pre-existing tracked code edits.
VS Code agent discovery and the first model-driven planning session must still
be verified in your running Chat UI using the first-use steps above. No planning
stage or stakeholder approval is claimed by installing these files.
