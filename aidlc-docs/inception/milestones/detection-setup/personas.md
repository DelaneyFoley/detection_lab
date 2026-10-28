# Detection Setup - Personas (MS-DET-01)

**Status:** DRAFT for review. Role definitions originate in the existing production system; these personas describe how those roles use Detection Setup.

## P1 - Detection Author (Super Admin)
- **Who:** Product/Detection PM or Ops/prompt engineer with the Super Admin role.
- **Goal:** Create and iterate on detection definitions and prompt versions with reduced effort, without needing engineering.
- **Needs:** Blank and Prompt Assist authoring, prompt versioning/history, Quick Test diagnostics, clear validation.
- **Pain today:** Producing a testable configuration and handing it to engineering is slow.
- **Primary FRs:** FR-001, FR-002, FR-006, FR-008, FR-013, FR-014.

## P2 - Detection Owner (Super Admin)
- **Who:** The Super Admin who created a detection and chose to lock it to their identity.
- **Goal:** Protect a detection's configuration from unintended edits while allowing chosen collaborators.
- **Needs:** Lock/unlock, collaborator management, exclusive edit/select rights on locked detections, attributable history.
- **Primary FRs:** FR-003, FR-004, FR-005, FR-025, FR-026, FR-031.

## P3 - Collaborator (Super Admin)
- **Who:** A Super Admin added to a locked detection by its owner.
- **Goal:** Contribute edits and version selection on a specific locked detection.
- **Needs:** Scoped edit/select rights; visibility into history and experiments.
- **Primary FRs:** FR-005, FR-006, FR-008, FR-026.

## P4 - Production-Context Experimenter (Super Admin)
- **Who:** An author validating changes inside a replicated production aggregate.
- **Goal:** Measure target performance and detect adverse effects on sibling detections within the real context.
- **Needs:** Context import/refresh, snapshot binding, drift signalling, isolated and aggregate experiments, ground-truth completeness safeguards.
- **Primary FRs:** FR-017 to FR-023.

## P5 - Promotion Preparer (Super Admin)
- **Who:** An author preparing a selected version for engineering to promote to staging then production.
- **Goal:** Hand a complete, reproducible package to engineering.
- **Needs:** Evaluation-gated selection, complete provenance, exportable handoff.
- **Primary FRs:** FR-024, FR-025, FR-028, FR-029.

## Supporting / external actors (context only, not primary this milestone)
- **Annotation / QA teams:** Establish finalized, reviewed ground truth consumed by experiments/evaluation (upstream capability).
- **Engineering:** Owns the production configuration source, promotion to staging/production, governance/security references, and the future direct-insertion capability (MS-DET-02).
- **Evaluation owners:** Define authoritative metrics, thresholds and gate semantics consumed via FR-024.

## Future persona (recorded, not MS-DET-01)
- **P6 - Detection Manager:** A Super Admin with additional Detection Manager permission who, in the future, performs direct insertion to staging/production for detections they own or collaborate on.
