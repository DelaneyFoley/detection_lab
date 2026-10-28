# Detection Setup - Requirements Clarifying Questions

The MS-DET-01 boundary was approved on 2026-10-27. These questions resolve the open items needed to write confirmed requirements, NFRs and stories for Detection Setup only. Answer by filling each `[Answer]:` tag; choose the "Other" option and describe when none fit. You do not need every answer at once — mark anything unknown as `TBD` with an owner and I will keep it as a labeled open item rather than inventing a value.

Scope reminder: connected capabilities (dataset management, inference execution, evaluation scoring, annotation/QA) stay at interface level. Only answer for how Detection Setup must behave and what contracts it needs.

---

## Section A - Extension opt-ins

These three decisions determine which AI-DLC extension rule sets inform the requirements and proposed verification. In this planning-only workflow, an enabled extension shapes requirements and acceptance criteria; it does not authorize code changes, test execution, or deployment.

### Question A1: Security Extensions
Should security extension rules be enforced as blocking constraints for this milestone's planning?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)

B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - This will be handled by engineering during production refinement/implementation. 

### Question A2: Resiliency Extensions
Should the resiliency baseline (directional best practices from the AWS Well-Architected Reliability Pillar) be applied as design-time guidance for this milestone?

A) Yes — apply the resiliency baseline as directional best practices and design-time guidance (recommended for business-critical workloads as an informed starting point to validate and harden before go-live)

B) No — skip the resiliency baseline (suitable for PoCs, prototypes, and experimental projects where rapid iteration matters more than reliability)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - This will be handled by engineering during production refinement/implementation. 

### Question A3: Property-Based Testing Extension
Should property-based testing (PBT) rules inform the proposed verification for this milestone?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)

B) Partial — enforce PBT rules only for pure functions and serialization round-trips (suitable for projects with limited algorithmic complexity)

C) No — skip all PBT rules (suitable for simple CRUD applications, UI-only projects, or thin integration layers with no significant business logic)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - This will be handled by engineering during production refinement/implementation. 
---

## Section B - Users, roles and permissions

### Question B1: Authoring roles
Which roles must be able to create and edit detection definitions and prompt versions in production Detection Setup?

A) Product/Detection PM and Ops/prompt engineering only

B) Those roles plus Annotation/QA (read or limited)

C) A single combined "detection author" role for now

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - Any Super Admin user role should be able to create new detections/prompt versions for those new detections. There should be a Detection Owner that is logged during detection creation, who has the option to lock the detection to their authenticated user ID. They should be able to add other Super Admin users as collaborators, who are able to edit that specific detection. Any unlocked detection can be edited by anyone. The user roles are determined by the existing production system. 

### Question B2: Selection/approval authority
Who may designate the single selected/approved prompt version for a detection (the one that passed the evaluation gate)?

A) Same as authoring roles — any author may select

B) A restricted approver role distinct from authors (separation of duties)

C) Product/Detection PM only

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - Same as authoring roles — any author may select for unlocked detections, but only the Detection Owner and designated collaborators may select for locked detections. 

### Question B3: Production insertion authority
Who may perform the direct production insertion of a selected version, and must it be a different person than the one who selected it?

A) Same approver may both select and insert

B) Insertion requires a distinct authorized role (separation of duties enforced)

C) Insertion requires an Engineering/Ops approval step in addition to the Detection Lab action

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - this will be a future enhancement of detection lab. Currently, the ability to directly insert into the production environment is not within scope. And actually, we will not promote directly to production, but to staging and then production. But in future state, the user must be a Super Admin with additional Detection Manager permissions and be the Detection Owner or an approved collaborator. 

### Question B4: Tenancy/isolation
Is organization/team/tenant isolation required (users only see and act on detections for their team/area)?

A) No isolation needed — all authorized users share all detections

B) Team/area scoping required

C) Full multi-tenant isolation required

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
The page is only visible to Super Admins and there are certain actions (outlined in the answers above) that should be locked, but everyone can see everyone's work. They just may not be able to edit locked detections or promote to the staging/production environments (when we implement that enhancement in a future milestone).

---

## Section C - Detection and prompt lifecycle

### Question C1: Version immutability
Once a prompt version is saved (or evaluated/selected), may its content change?

A) Saved versions are immutable; any change creates a new version

B) Versions are editable until selected/approved, then frozen

C) Freeform edits allowed; history is informational only

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - Saved versions are immutable; any change creates a new version. However versions can be deleted (see answer below).

### Question C2: Deletion
Should users be able to delete detections and prompt versions in production (the prototype allows cascade delete)?

A) No hard delete; archive/retire only, preserving history and audit

B) Hard delete allowed for unselected/never-inserted versions only

C) Hard delete allowed with audit record

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - Hard delete allowed for unapproved/unselected/never-inserted versions only. You can delete after running an inference run as long as it isnt an approved version. Deleting a prompt version will delete the associated inference run logs, but not the datasets they were run on.

### Question C3: Prompt Assist generation
Prompt Assist sends a user's natural-language description to the model to generate detection fields. What governs this in production?

A) Keep as-is: any authorized user may generate suggestions; output is always human-reviewed before save

B) Allowed but restricted to certain roles and/or logged for audit

C) Needs a defined policy for what text may be sent and how outputs are validated before use

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A

### Question C4: Quick Test inputs and retention
Quick Test uploads a small set of images for diagnostic inference. What are the production expectations?

A) Ephemeral — images and results are not persisted after the session

B) Results retained with the version for traceability; images not retained

C) Both retained under organization data-retention policy

X) Other (please describe after `[Answer]:` tag below; include any max-image or size limits if known, else TBD)

[Answer]:
A
---

## Section D - Production-context integration and insertion

### Question D1: Authoritative context source identity
How should the authoritative production configuration source be identified for import and snapshotting (today the prototype compiles a neighboring `ai-services` checkout)?

A) A versioned repository/service with an explicit revision identifier per import

B) A published configuration API/service

C) Undecided — target source is TBD (name an owner)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
C) engineering will determine this during implementation/refinement. In the prototype, it pulls from a local version of the ai-service repo i have saved on my computer, but in production, it should pull directly from the production ai-services repo. The how/when/implementation will be determined after consulting engineering. 

### Question D2: Drift handling
When the production context changes after a version's snapshot was taken, what must Detection Setup do?

A) Flag drift and require a new version to adopt the newer baseline (prototype behavior)

B) Block insertion of a drifted version until re-snapshot/re-evaluation

C) Only inform the user; no enforcement

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - Flag drift and require a new version to adopt the newer baseline, but prompts created using older versions retain the configuration they had when they were created and add a badge for the date the production context that was used fell out of date with the current version.

### Question D3: Insertion activation semantics
When an authorized user inserts a selected version into production, what happens?

A) It becomes the live production configuration immediately

B) It is staged/proposed and activated by a separate production deployment process

C) TBD — depends on the production system's deployment model (name an owner)

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - this is not part of this milestone, but the future implementation will likely be B, with the posibility of A after we prove it's viability/consistency. We push updates to notification rules, notification templates, organization settings directly to production when they are updated in the platform UI, so there may be a precident for direct production insertion in a future state.

### Question D4: Insertion failure and rollback
What must happen if an insertion fails or must be reversed?

A) Automatic rollback to the previously live version with an audit record

B) Manual rollback via Detection Lab with confirmation

C) Rollback is owned by the production/Engineering process, not Detection Lab

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X- again, this is not within scope of this milestone, but it will be A. 

### Question D5: Aggregate regression protection
You want to detect adverse effects on other detections in the same context. Should insertion be blocked when evaluation shows regression in sibling detections?

A) Yes — block insertion on sibling regression beyond an agreed threshold (threshold owner: TBD)

B) Warn only; allow insertion with explicit override and reason

C) Out of scope for insertion gating; handled entirely in the evaluation milestone

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X -  out of scope for this milestone, but it will be B in the future enhancement work.
---

## Section E - Provider, model and data governance

### Question E1: Permitted models
Gemini is the stated model family. Which model identifiers/settings are permitted, and who owns that list?

A) A centrally governed allow-list of Gemini models; Detection Setup selects only from it

B) Any Gemini model the provider exposes

C) TBD — name the owner of the model policy

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A

### Question E2: Credential custody
How are provider credentials handled in production (the prototype accepts a session key or env var)?

A) Centrally managed secrets; no user-entered keys in production

B) Central secrets with optional per-user keys for diagnostics

C) TBD — name the owner

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A

### Question E3: Data governance references
You stated retention, provenance, sensitivity and audit follow existing organization policies. Please identify the authoritative policy source(s) and owner so requirements can cite them rather than invent them.

A) I will provide the policy document/owner names here

B) Use placeholders citing "organization policy (owner TBD)" until I supply references

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
X - I do not have access to these. They will be added by engineering during refinement. 

---

## Section F - Migration and measurable targets

### Question F1: Migration scope
Production is a rebuild. Must existing detections, prompt versions, or context snapshots be migrated and validated into the new system?

A) No migration — start clean

B) Migrate active/selected detections and their current versions only

C) Migrate full history

D) TBD — name an owner

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
A

### Question F2: Success measures
For each owner-stated outcome, do you have (or can you name an owner for) a measurable target? Provide values where known; otherwise mark TBD with an owner.

- Reduce effort to produce a testable configuration: target/owner = Delaney Foley
- Preserve understandable version history: definition of "understandable"/owner = Delaney Foley
- Reproducible evaluation configurations: measure/owner = Delaney Foley
- Validate target performance within production aggregates: measure/owner = Delaney Foley
- Detect adverse effects on sibling detections: measure/owner = Delaney Foley

A) Values provided above

B) All TBD with owners named above

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
B

### Question F3: Non-functional expectations
Do you have any known NFR targets to record now (availability window, concurrent authors, acceptable Quick Test latency, audit retention)? Provide values or mark TBD with owner.

A) Values provided here:

B) All TBD with owners to be named during handoff review

X) Other (please describe after `[Answer]:` tag below)

[Answer]:
B
---

When you have filled in the answers (or marked items TBD with owners), tell me you're done and I will transcribe, resolve any remaining ambiguities, record extension decisions, and then draft the Detection Setup requirements and NFRs for your review.
