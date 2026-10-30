# Prototype workflow state

## Identity and evidence baseline

- Agent: **Prototype Change Partner**.
- Mode: baseline/diagnostic only.
- Current status: **PC-001 + PC-002 IMPLEMENTED** (Single Detection template +
  Prompt Feedback on the single Detection Prompt); baseline diagnostic otherwise
  **AWAITING_OWNER_REVIEW**.
- Baseline revision: `PB-001`, 2026-10-27.
- Source commit (baseline): `73e0049d09df6c11226c53d3af87c93eaedbfdd3`.
- Worktree at inventory start: clean. PC-001 (approved 2026-10-29) updates
  application source/tests; prototype-docs record its scope and verification.
- Scope: full prototype, all 11 top-level tabs and auxiliary shared surfaces;
  18 workflow entries and 104 source-derived candidate requirement rows.
- Intent: all PR rows UNCONFIRMED. No application behavior has been approved
  for preservation or modification by requesting this inventory.
- Production planning: separate existing Detection Setup milestone, DRAFT/BLOCKED;
  its files, scope, approvals and state remain unchanged.

## Verification

- Source inspection: navigation/components, API/repositories/services,
  schemas/types, existing test definitions.
- Existing helper tests: `npm test` on 2026-10-27, **8 suites / 129 tests passed**.
  Import-path review found no expected DB/provider execution in these suites.
- VS Code test discovery unavailable (zero controllers); configured Vitest runner
  used instead. No tooling/dependency changes were needed.
- Tests support algorithms, not complete browser/API/DB journeys or intent.
- No app server/browser run, real-data reads/mutations, provider calls, adjacent
  repo execution, deployment, build, migration or reseeding.
- Setup validation: YAML/frontmatter and all five prompt-to-agent references
  passed; prototype and production tool boundaries remain separate. Local
  Markdown file references resolve and cited line numbers are within bounds.
  Requirements/findings/questions have unique contiguous IDs and valid
  cross-references; all 18 workflows and 33 API routes are represented.
- Preservation check: tracked application source/tests/manifests/configuration,
  production-planning artifacts and vendor rules match baseline HEAD.
- Live VS Code picker discovery and full browser/API journey validation remain
  unverified. Setup validation is not behavioral acceptance or intent sign-off.

## Approval gates

- Workflow setup requested: yes (PDEC-001 through PDEC-003).
- Baseline intent accepted: **NO**; pending review by workflow.
- Initial diagnostic: **COMPLETE**; 20 open findings (PD-001–PD-020) and 17
  product questions (PQ-001–PQ-017). **Batch A complete — PQ-001–PQ-005 answered
  2026-10-27** (PDEC-004–PDEC-013); Batch B+ (PQ-006–PQ-017) unanswered. This is
  a source-based diagnostic, not exercised UI or API validation.
- Approved implementation contract: **PC-001 & PC-002 — APPROVED & IMPLEMENTED**
  (owner Delaney Foley, 2026-10-29). PC-001: Single Detection template as a
  one-member Production Replication; retires Admin category prompts; reworks
  Prompt Assist, Compare and Iteration onto the single Detection Prompt +
  aggregate path. PC-002: the Prompt Feedback flow now edits the single Detection
  Prompt and saves a composition-backed version for Single Detection sources.
  Both statically verified (tsc, 143 tests, build). Earlier Batch A intent
  (PDEC-004–013) remains recorded but unimplemented and is tracked in
  [followups.md](followups.md) (FUP-001–FUP-014, INV-001).
- Net-new development: paused until diagnostic review and a named change
  approval, or an explicit owner decision to proceed with specified open risks.
- Repairs: not automatically authorized; each bounded repair needs PC approval.

## Next action

**PC-001 and PC-002 are implemented and statically verified** (tsc clean; 143
tests pass; production build green). PC-001 makes Single Detection templates run
as a one-member Production Replication (Admin category prompts retired; Prompt
Assist, Compare and Iteration on the single Detection Prompt + aggregate path);
PC-002 brings the Post-HIL Prompt Feedback flow onto the same model (single
Detection Prompt edits → composition-backed version). See
[changes/PC-001.md](changes/PC-001.md) and [changes/PC-002.md](changes/PC-002.md).
Still unverified: live VLM inference, the browser UI, and the AI suggestion
quality of the reworked generation/feedback prompts (provider calls are out of
scope for this role). Follow-up: guarded legacy JSX in the version editor can be
removed in a later cleanup.

Remaining baseline work (unchanged by PC-001/PC-002): continue Batch B (PQ-006
onward) and prioritize [followups.md](followups.md) into named `PC-###`
contracts. Keep unanswered requirements UNCONFIRMED. Each further behavior change
needs its own approved change contract. Use `/prototype-resume` in a new chat. Do
not regenerate the baseline or erase answers. Do not load formal AWS AI-DLC.

## Resume references

- [Guide](README.md)
- [Baseline inventory](baseline.md)
- [Requirements register](requirements.md)
- [Diagnostics](diagnostics.md)
- [Intent questions](questions.md)
- [Decisions and history](decisions.md)
- [Outstanding implementation work](followups.md)

Allocate future IDs after existing maxima, preserving superseded IDs. No PC
records exist yet. Production-plan changes require the separate production agent.
