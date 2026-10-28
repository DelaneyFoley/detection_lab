# AWS AI-DLC provenance

- Upstream: <https://github.com/awslabs/aidlc-workflows>
- Approved release: [v1.0.1](https://github.com/awslabs/aidlc-workflows/releases/tag/v1.0.1)
- Release asset: [ai-dlc-rules-v1.0.1.zip](https://github.com/awslabs/aidlc-workflows/releases/download/v1.0.1/ai-dlc-rules-v1.0.1.zip)
- Tag object: `e40f6a93a59d1a22be78314ff32585fdd6b60936`
- Resolved commit: `e49341dbeb8af82758dd85e96ed7fe9bcf38a447`
- Downloaded: 2026-10-27
- Observed archive SHA-256:
  `ac0601544b6c7ba41b541a7a96259d6ea3995ea0b94b2a58a333ae7898e22b39`
- License: [MIT No Attribution (MIT-0)](LICENSE), copied from the resolved
  upstream commit.

The checksum records the downloaded asset; it is not a claim of independent
publisher signature verification.

## Installed mapping

| Release archive path | Workspace path |
| --- | --- |
| `aidlc-rules/aws-aidlc-rules/core-workflow.md` | `core-workflow.md` |
| `aidlc-rules/aws-aidlc-rule-details/*` | Same relative paths in this directory |
| `aidlc-rules/VERSION` | `VERSION` |

These release files are unmodified. Construction and Operations rules are
retained for release integrity, not enabled for this project's planning mode.

The standard Copilot installation puts the core workflow directly in
`.github/copilot-instructions.md`, enabling it for all requests. This project
intentionally uses an opt-in router there instead. The local
[planning agent](../.github/agents/aidlc-production-planner.agent.md) loads the
pinned core and limits execution to documentation-only Inception.

Local routing, prompts, agent instructions, and the
[usage guide](../AI-DLC-GUIDE.md) are project-specific additions, not AWS release
files or claims of AWS certification. See the guide for boundaries and upgrades.
