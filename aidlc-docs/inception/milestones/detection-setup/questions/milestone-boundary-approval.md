# Detection Setup Milestone Boundary Approval

Review the revised [milestone boundary](../milestone-boundary.md) and [whole-product context map](../../../product-context-map.md). The boundary explicitly includes all five setup aids named by the owner and direct insertion of a selected prompt version into production as a required future capability. Approval is only for the milestone boundary; it does not approve a production architecture, detailed insertion controls, detailed requirements, or TBD thresholds.

## Owner-provided intent captured

The owner's answers are recorded in the revised milestone boundary, including:

- Detection definitions and prompt versions are created, iterated, tested and organized by Product/Detection PM and Ops/prompt engineering; Annotation and QA establish ground truth; Engineering currently supports the separate production integration.
- Blank Template, Prompt Assist, Quick Test, Production Replication/context snapshots, prompt grouping and version notes must all be covered.
- Quick Test is diagnostic, not an authoritative release gate. The one currently selected prompt per detection is designated only after the downstream evaluation gate is passed; selection is not itself production publication.
- Production-context configuration is authoritative. Catalog refreshes expose updated production definitions; immutable snapshots bind saved versions to their starting configuration; experiments modify derived Lab configuration; adopting a newer production baseline requires a new version.
- Finalized/reviewed datasets supply ground truth. Target and enabled aggregate detections require complete labels for valid metrics. Evaluation capabilities remain later milestones, with interfaces needed by Detection Setup covered here.
- Gemini is the stated model family. Credentials and data governance follow existing organizational policies; exact policy references and provider configuration details remain to be identified.
- Production is a rebuild. Target platform/vendors and migration scope are TBD.
- Owner-stated outcomes: enable authorized non-engineering users to create and iterate; reduce effort to produce testable configuration; preserve history; enable reproducible evaluation; validate target performance in aggregates; detect adverse effects on other detections in the same context.

## Question 1 - explicit boundary approval

Do you approve the revised MS-DET-01 boundary in [milestone-boundary.md](../milestone-boundary.md) as the sole detailed Inception scope, with all named setup aids and direct production insertion included, and other capabilities limited to dependency/interface analysis?

A) Approve this revised boundary. Continue to Detection Setup requirements discovery, keeping detailed production-insertion controls and all TBD targets explicit.

B) Request further changes. Describe them after `[Answer]:`; this is not approval until the revised boundary is presented for confirmation.

C) Do not approve this boundary. Describe the milestone or scope you want instead after `[Answer]:`.

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A — Approved on 2026-10-27. Continue to Detection Setup requirements discovery; keep detailed production-insertion controls and all TBD targets explicit.
