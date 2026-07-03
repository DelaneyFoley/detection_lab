# Detection Lab — Feature Handoff Document

**Date:** June 2, 2026  
**Author:** Delaney Foley  
**Purpose:** Engineering handoff for implementing new annotation workflow, QA pipeline, and secondary review features in the production platform.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature 1: Annotation Tab (Annotator Workspace)](#2-feature-1-annotation-tab)
3. [Feature 2: Annotation View (Image-by-Image Labeling)](#3-feature-2-annotation-view)
4. [Feature 3: Secondary Review (Flagging System)](#4-feature-3-secondary-review)
5. [Feature 4: Annotator Flags Tracking Page](#5-feature-4-annotator-flags-tracking)
6. [Feature 5: Annotator Performance Page](#6-feature-5-annotator-performance)
7. [Feature 6: Quality Assurance Tab Updates](#7-feature-6-qa-tab-updates)
8. [Feature 7: Saved Datasets Tab Updates](#8-feature-7-saved-datasets-updates)
9. [Implementation Order of Operations](#9-implementation-order)
10. [Data Model Requirements](#10-data-model-requirements)
11. [Claude Prompts for Implementation](#11-claude-prompts)

---

## 1. Executive Summary

This document covers the full annotation and quality assurance workflow features built in the Detection Lab prototype. These features enable:

- **Annotators** to receive assigned datasets, label images one by one, flag uncertain items for secondary review, track their flags and performance metrics
- **QA Managers** to review flagged items, resolve flags with documented actions, sample annotations for quality checks, and track annotator performance across detections
- **The system** to maintain a complete audit trail of all labeling decisions, flag resolutions, and status transitions

### Workflow Overview

```
Dataset Created → Assigned to Annotator → Annotator Labels Images → 
  (optionally flags uncertain items) → Annotator Submits → 
  QA Manager Reviews (sampling + flag resolution) → 
  Approved/Needs Revision → Finalized
```

### QA Status Lifecycle

```
draft → assigned → in_progress → submitted → in_qa → approved → finalized
                         ↑                        ↓
                         └──── needs_revision ←───┘
```

---

## 2. Feature 1: Annotation Tab

### What It Is
A dedicated workspace for annotators to see all their assigned datasets, track progress, and navigate to their labeling work. It replaces a kanban-style board with a more efficient dashboard.

### Why It Matters
Annotators need a single place to see what's assigned to them, what needs attention (revisions, flags), and what's complete — without navigating multiple tabs or views.

> **See:** `screenshots/02_annotation_my_datasets.png`

### Layout & Components

#### Header
- Page title ("Annotation") + subtitle on the left
- "I am" user selector dropdown on the right (1/5 page width) — annotators select their identity

#### Sub-Tab Navigation Bar
Full-width pill tab bar (matching the Saved Datasets style) with icons:
- **My Datasets** (grid icon) — default view, shows assigned work
- **Flags** (flag icon) — tracks flagged items and resolutions
- **Performance** (trending-up icon) — personal metrics dashboard

#### My Datasets View
- **4 Summary Cards** (clickable, filter the table):
  - Assigned (inbox icon, blue) — datasets with status `assigned`
  - Needs Attention (warning icon, red) — `needs_revision` or has open flags
  - In Progress (clock icon, amber) — status `in_progress`
  - Complete (check icon, green) — `submitted`, `in_qa`, `approved`, `finalized`

- **Status Filter Tabs** (full-width, with icons):
  - All | Action Needed | In Progress | Submitted | Done

- **Dataset Table** (fixed columns):
  | Column | Width | Content |
  |--------|-------|---------|
  | Dataset | 30% | Name + revision note if needs_revision |
  | Detection | 20% | Parent detection name |
  | Progress | 22% | Progress bar + X/Y (Z%) |
  | Status | 15% | Color-coded badge |
  | Flags | 13% | Open flag count or "—" |

  - Click row → opens annotation view (editable or read-only based on status)
  - Sort order: needs_revision → flagged → in_progress → assigned → rest

### User Stories
- As an annotator, I want to see all my assigned datasets in one place so I can prioritize my work
- As an annotator, I want to quickly identify which datasets need revision so I can address manager feedback first
- As an annotator, I want to see my progress percentage so I know how much work remains

### Example Claude Prompt
```
Implement an Annotation workspace page for annotators. The page should have:
1. A header with "Annotation" title and a user identity selector (dropdown of known annotators, right-aligned, 1/5 width)
2. A full-width sub-tab bar with icons for "My Datasets", "Flags", and "Performance"
3. The My Datasets view should show:
   - 4 clickable summary stat cards (Assigned, Needs Attention, In Progress, Complete)
   - A full-width filter tab bar with icons (All, Action Needed, In Progress, Submitted, Done)
   - A fixed-column table showing dataset name, detection, progress bar with percentage, status badge, and flag count
   - Clicking a row opens the annotation view for that dataset
   - Datasets should be sorted by priority: needs_revision first, then flagged, then in_progress
The tab bars should match the style used in the Saved Datasets page — full width, rounded container with subtle border, icon + label per tab, highlighted active state.
```

---

## 3. Feature 2: Annotation View

### What It Is
A full-screen, image-by-image labeling interface where annotators assign ground truth labels, select attributes (segment tags), flag uncertain items, and add notes.

### Why It Matters
This is where the actual annotation work happens. It needs to be efficient for high-volume labeling with minimal clicks, keyboard navigation, and zoom/pan capabilities for detailed image inspection.

### Layout

#### Header Section
- Back button (returns to dashboard)
- Dataset name (large, below back button)
- Detection name + progress counter (e.g., "Major Corrosion · 431/500 labeled (86%)")
- Read-only badge (shown for submitted/approved/finalized datasets)
- Max width container with consistent margins (`max-w-7xl`)

#### Two-Column Grid Layout

**Left Column: Image Panel**
- Toolbar: image counter (X/Y — image_id), Copy ID button, Zoom +/-, Reset, Prev/Next navigation
- Large image viewport (500px height) with:
  - Zoom: 1x to 4x
  - Pan: drag-to-move when zoomed
  - Keyboard: Arrow Left/Right for navigation
- Zoom percentage indicator

**Right Column: Review Panel (stacked cards)**
1. **Secondary Review Card**
   - If not flagged: "Flag for Secondary Review" button
   - If flagged: Shows flag reason, amber indicator, "Resolve Flag" button
2. **Ground Truth Label Card**
   - Horizontal buttons: DETECTED | NOT_DETECTED | UNSET
   - Color-coded active states (purple for detected, accent for not_detected)
3. **Attributes Card** (if detection has segment_taxonomy)
   - Toggleable tag pills for each attribute option
4. **Annotator Note Card**
   - Textarea for free-form notes
   - Auto-saves on blur or image navigation
   - Stored in `image_description` field
5. **Resolved Flag History** (if item has a resolved flag)
   - Shows original question, resolution action, note, date

### Key Behaviors
- **Auto-save notes**: When navigating away from an image or blurring the textarea, unsaved notes are persisted
- **Keyboard navigation**: Arrow keys move between images (only when not focused on input/textarea)
- **Read-only mode**: For submitted/approved/finalized datasets — all inputs disabled, lock badge shown
- **QA Report Card**: Shown for approved datasets — displays acceptance rate and correction count from QA sampling

### User Stories
- As an annotator, I want to label images quickly with minimal clicks using horizontal button layout
- As an annotator, I want to zoom and pan images to inspect details for difficult cases
- As an annotator, I want to flag items I'm uncertain about rather than guessing
- As an annotator, I want to add notes to remind myself of observations for later
- As an annotator, I want to use keyboard shortcuts to navigate quickly through images

### Example Claude Prompt
```
Implement an image-by-image annotation view with:
1. A header showing dataset name, detection, and progress (X/Y labeled)
2. A two-column layout:
   - Left: Image panel with zoom (1-4x), pan (drag when zoomed), prev/next navigation, and keyboard arrow key support
   - Right: Stacked review cards for:
     a. Secondary Review (flag button or flagged state with resolve option)
     b. Ground Truth Label (horizontal DETECTED/NOT_DETECTED/UNSET buttons, color-coded)
     c. Attributes (toggleable tag pills from detection's segment taxonomy)
     d. Annotator Note (auto-saving textarea)
     e. Resolved flag history (if applicable)
3. Read-only mode when dataset status is submitted/approved/finalized
4. Auto-save behavior for notes (on blur and on image navigation)
5. Match the HilReview page style with max-w-7xl margins and space-y-6 spacing
```

---

## 4. Feature 3: Secondary Review (Flagging System)

### What It Is
A mechanism for annotators to flag uncertain items for manager review, and for managers to resolve those flags with documented actions.

### Why It Matters
Not every image has a clear-cut label. Rather than forcing annotators to guess (and introducing errors), the flagging system lets them escalate uncertainty while documenting their specific question. This creates an audit trail and enables targeted manager review.

### How It Works

#### Annotator Side (in Annotation View)
1. Annotator clicks "Flag for Secondary Review" on any image
2. Modal appears asking for the reason/question (e.g., "Unsure if this qualifies as detected — looks borderline")
3. Flag is created with: dataset_item_id, detection_id, image_id, reason, status="open"
4. Flagged items show an amber indicator in the annotation view
5. Annotator can continue labeling other images

#### Manager Side (in QA Tab → Flags Queue)
1. Manager sees all open flags in a paginated list with image thumbnails
2. Clicking a flag opens ImagePreviewModal with full details:
   - Image at full size with zoom/pan
   - Flag reason (highlighted in amber)
   - Model prediction (if available)
   - Current ground truth label (editable)
   - Attributes (editable)
   - Resolution options:
     - Label Confirmed
     - Label Corrected
     - Attributes Corrected
     - Image Removed
     - Needs Discussion
   - Optional resolution note
   - Resolve or Dismiss buttons
3. Batch operations: Resolve All / Dismiss All with selected action

#### Resolution Actions
| Action | Meaning |
|--------|---------|
| label_confirmed | Annotator's label was correct |
| label_corrected | Manager changed the ground truth label |
| attributes_corrected | Manager changed the segment tags |
| image_removed | Image removed from dataset (ambiguous/bad quality) |
| needs_discussion | Requires team discussion before resolution |

### Data Model
```
review_flags:
  flag_id (PK)
  prediction_id (nullable — for flags from model predictions)
  dataset_item_id (nullable — for flags from annotation)
  detection_id
  image_id
  reason (text)
  status: "open" | "resolved" | "dismissed"
  resolution_action (nullable)
  resolution_note (nullable)
  created_at
  resolved_at (nullable)
```

### User Stories
- As an annotator, I want to flag images I'm unsure about with a specific question so the manager knows what to look at
- As a QA manager, I want to see all open flags with image previews so I can quickly resolve them
- As a QA manager, I want to document my resolution action so there's an audit trail of decisions
- As a QA manager, I want to batch-resolve flags when they share the same resolution

### Example Claude Prompt
```
Implement a secondary review flagging system:
1. In the annotation view, add a "Flag for Secondary Review" button that opens a modal asking for the reason/question
2. Create a review_flags table with: flag_id, dataset_item_id, detection_id, image_id, reason, status (open/resolved/dismissed), resolution_action, resolution_note, created_at, resolved_at
3. In the QA section, create a Flags Queue view showing:
   - List of open flags with image thumbnails (10x10 rounded), image ID, reason, and date
   - Click to open a full image preview modal with:
     - Zoom/pan image viewer
     - Flag reason highlighted
     - Editable ground truth label and attributes
     - Resolution action selector (label_confirmed, label_corrected, attributes_corrected, image_removed, needs_discussion)
     - Optional resolution note
     - Resolve and Dismiss buttons
   - Batch resolve/dismiss all open flags
   - Collapsible Resolved Flags section showing resolution details
4. Flag counts should appear in the annotation dashboard table
5. Resolved flags should show their resolution history in the annotation view
```

---

## 5. Feature 4: Annotator Flags Tracking

### What It Is
A sub-page within the Annotation tab where annotators can see all their open and resolved flags across all assigned datasets, with the ability to view resolution details.

### Why It Matters
Annotators need feedback on their flagged items to learn from manager decisions and apply those learnings to future labeling.

> **See:** `screenshots/03_annotation_flags_open.png`, `screenshots/04_annotation_flags_resolved.png`

### Layout

#### Filter Pills
- **Open (N)** — items still awaiting manager review
- **Resolved (N)** — items that have been resolved

#### Flag List (matching QA Flags Queue style)
Each row shows:
- Image thumbnail (10x10, rounded) or flag icon fallback
- Image ID (monospace) + Dataset name (separated by middot)
- Flag reason text
- For resolved: resolution action badge + note + date
- For open: "Flagged [date]" + "Click to view"

#### Image Preview Modal
Clicking any flag opens the shared ImagePreviewModal with:
- Full image with zoom/pan
- Details panel: Image ID, Dataset name, Flag Reason (amber box), Ground Truth Label, Annotator Note
- For resolved flags: Resolution section with action, note, and date

### User Stories
- As an annotator, I want to see which of my flags are still open so I know what's pending review
- As an annotator, I want to review resolution details to learn from manager feedback
- As an annotator, I want to see the image again when reviewing resolved flags for context

### Example Claude Prompt
```
Add a "Flags" sub-page to the annotation workspace that shows:
1. Filter pills for Open/Resolved with counts
2. A scrollable list of flags (matching the QA Flags Queue card-row style):
   - Image thumbnail, image ID + dataset name, reason, date
   - Resolved flags show resolution action badge and note inline
3. Clicking any flag opens the shared image preview modal with:
   - Full zoomable image
   - Side panel showing: Image ID, Dataset name, Flag reason (amber highlighted), ground truth label, annotator note
   - For resolved: resolution action, note, and date
4. Only show flags belonging to datasets assigned to the current annotator
```

---

## 6. Feature 5: Annotator Performance

### What It Is
A personal metrics dashboard showing the annotator's accuracy, flag rate, and per-dataset performance on finalized datasets.

### Why It Matters
Annotators benefit from seeing their own performance metrics to self-correct and improve. It also provides transparency about how their work is evaluated.

> **See:** `screenshots/05_annotation_performance.png`

### Layout

#### Summary Cards (4 cards with InfoTip tooltips)
| Card | Metric | Tooltip |
|------|--------|---------|
| Accuracy | % labels confirmed correct in QA | "Correct samples ÷ total reviewed samples" |
| Flag Rate | % items with open flags | "Open flags ÷ total items assigned" |
| Datasets Finalized | Count of approved/finalized datasets | "Datasets that completed full QA process" |
| Items Labeled | Total items labeled | "Total images labeled across all datasets" |

#### Finalized Datasets Table
| Column | Content |
|--------|---------|
| Dataset | Name |
| Items | Total size |
| Accuracy | Per-dataset accuracy (color-coded: ≥90% green, ≥75% amber, <75% red) |
| Corrections | Number of QA corrections made |
| Status | Badge |

### Metrics Calculation
- **Accuracy**: Derived from QA sampling — (samples marked correct) / (total samples reviewed)
- **Flag Rate**: (open flags count) / (total items assigned to annotator)
- **Correction Rate**: 1 − accuracy (inverse)
- These are calculated server-side from the `qa_samples` and `review_flags` tables

### User Stories
- As an annotator, I want to see my accuracy rate so I know how I'm performing
- As an annotator, I want to see per-dataset breakdowns to identify where I struggled
- As an annotator, I want tooltip explanations of each metric so I understand what's being measured

### Example Claude Prompt
```
Add a "Performance" sub-page to the annotation workspace showing:
1. 4 summary stat cards with tooltip explanations (use an info icon that shows a popover on hover):
   - Accuracy: % labels confirmed correct (correct samples ÷ reviewed samples)
   - Flag Rate: % items flagged (open flags ÷ total items)
   - Datasets Finalized: count of approved/finalized datasets
   - Items Labeled: total items labeled
2. A table of finalized datasets showing: name, item count, per-dataset accuracy (color-coded), corrections count, status badge
3. Empty state message when no datasets are finalized yet
4. Metrics should come from a dedicated metrics API endpoint, not the annotator list endpoint
```

---

## 7. Feature 6: Quality Assurance Tab Updates

### Changes Made

> **See:** `screenshots/06_qa_pipeline.png`, `screenshots/07_qa_flags_queue.png`, `screenshots/08_qa_metrics_logs.png`

#### 1. Renamed "Logs & Metrics" → "Metrics & Logs"
The sub-tab in the QA tab was renamed to emphasize metrics first.

#### 2. Button Reorder
"Annotator Metrics" button moved to the left (first position), "Activity Log" to the right.

#### 3. Detection Filter Inline
The detection selector dropdown is now on the same line as the view toggle buttons, right-aligned, 1/3 page width. Only visible when Metrics view is active.

#### 4. Metrics Table Tooltips
Every metric column header now has an InfoTip (hover info icon) explaining what the metric measures:
- Accuracy: "Correct samples ÷ total reviewed samples"
- Flag Rate: "Open flags ÷ total items assigned"
- Label Error: "Label corrections ÷ total resolved flags"
- Attr Error: "Attribute corrections ÷ total resolved flags"
- Discrepancy: "Label disagreements between linked datasets ÷ total overlapping items"
- Correction: "1 − accuracy rate"

#### 5. Flags Queue Page Size Selector
- Removed from full-width row (was stretching across entire page)
- Now displays as a compact "X / page" dropdown, right-aligned above both Open and Resolved sections
- Options: 10/page, 25/page, 50/page
- Controls pagination for both open and resolved flag lists

### User Stories
- As a QA manager, I want metrics emphasized over logs since that's my primary concern
- As a QA manager, I want to filter metrics by detection to compare annotator performance per task
- As a QA manager, I want tooltip explanations on metrics so I can share the screen with stakeholders

### Example Claude Prompt
```
In the QA section's Metrics & Logs view:
1. Rename the tab to "Metrics & Logs"
2. Put "Annotator Metrics" button first (left), "Activity Log" second
3. When Metrics view is active, show a detection filter dropdown on the same line as the buttons, right-aligned, 1/3 width
4. Add hover tooltips (info icon with popover) to each metric column header explaining the calculation
5. For the Flags Queue page, replace the full-width "Per page" selector with a compact "X / page" dropdown (right-aligned, above both flag sections)
```

---

## 8. Feature 7: Saved Datasets Tab Updates

### Changes Made

> **See:** `screenshots/09_saved_datasets.png`

#### 1. Removed Duplicate Dataset Name Field
In the Dataset Details component (opened when clicking a dataset row), the "Dataset Name" field was removed from the detail grid since the name already appears as the component header. Grid changed from 5 columns to 4.

### User Stories
- As a user, I don't want to see the same information repeated in the same view

### Example Claude Prompt
```
In the dataset detail view, remove the redundant "Dataset Name" field since the name is already displayed as the component title. Adjust the remaining fields to fill the grid evenly.
```

---

## 9. Implementation Order of Operations

### Phase 1: Data Model & API (Backend)
1. **Review Flags table** — Create the `review_flags` table with all fields
2. **QA Samples table** — Ensure `qa_samples` table exists for accuracy tracking
3. **QA Logs table** — For audit trail
4. **Dataset status fields** — Add `qa_status`, `assigned_to`, `items_labeled`, `revision_note` to datasets
5. **API endpoints**:
   - `GET/POST/PUT /api/review-flags` (CRUD + counts + filtering)
   - `GET /api/qa/metrics` (annotator metrics calculation)
   - `GET /api/qa?action=samples` (QA sampling stats)
   - `GET /api/qa?action=annotators` (known annotator names)
   - `GET /api/qa?action=item_details` (flag detail lookup)

### Phase 2: Shared Components
1. **ImagePreviewModal** — Reusable modal with zoom/pan, navigation, and optional details panel
2. **InfoTip** — Hover tooltip component for metric explanations
3. **Status badges** — Color-coded badge component for QA statuses
4. **DecisionBadge** — DETECTED/NOT_DETECTED label display

### Phase 3: Annotation View (Core Labeling)
1. Image panel with zoom/pan/navigation
2. Ground truth label buttons (horizontal)
3. Attribute tag toggles
4. Annotator notes (auto-save)
5. Keyboard navigation
6. Read-only mode

### Phase 4: Secondary Review System
1. Flag creation modal (in annotation view)
2. Flag indicators on flagged items
3. Resolve modal (in annotation view for managers)
4. Resolved flag history display

### Phase 5: Annotation Dashboard
1. User selector
2. Summary stat cards
3. Filter tabs
4. Dataset table with progress bars
5. Navigation to annotation view

### Phase 6: Annotation Sub-Pages
1. Flags tracking page (open/resolved lists + image preview)
2. Performance page (metrics cards + finalized table)

### Phase 7: QA Tab Updates
1. Flags Queue view (open/resolved sections + batch ops + preview modal)
2. Metrics & Logs view (metrics table with tooltips + activity log)
3. Page size selector fix

### Phase 8: Polish
1. Tab bar styling (full-width, icons)
2. Tooltip content
3. Saved Datasets deduplication fix

---

## 10. Data Model Requirements

### Core Tables

```sql
-- Review flags for secondary review workflow
CREATE TABLE review_flags (
  flag_id TEXT PRIMARY KEY,
  prediction_id TEXT,          -- nullable, for flags from model predictions
  dataset_item_id TEXT,        -- nullable, for flags from annotation view
  detection_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open, resolved, dismissed
  resolution_action TEXT,      -- label_confirmed, label_corrected, attributes_corrected, image_removed, needs_discussion
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- QA sampling for accuracy measurement
CREATE TABLE qa_samples (
  sample_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  sample_method TEXT NOT NULL,  -- random, stratified, flagged, discrepancy
  reviewer TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, reviewed, skipped, accepted
  outcome TEXT,                -- accepted, label_corrected, attributes_corrected, both_corrected
  note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

-- Audit log for all QA actions
CREATE TABLE qa_logs (
  log_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  action TEXT NOT NULL,         -- status_change, sample_reviewed, flag_resolved, etc.
  actor TEXT,
  details TEXT,                 -- JSON blob with action-specific details
  created_at TEXT NOT NULL
);
```

### Dataset Fields Required
```sql
-- Additional fields on datasets table
qa_status TEXT DEFAULT 'draft',     -- draft/assigned/in_progress/submitted/in_qa/needs_revision/approved/finalized/archived
assigned_to TEXT,                    -- annotator name
items_labeled INTEGER DEFAULT 0,    -- cached count of labeled items
revision_note TEXT                   -- manager's note when requesting revision
```

### Key Queries for Metrics
- **Accuracy**: `SELECT COUNT(*) WHERE outcome='accepted' / COUNT(*) WHERE status='reviewed'` from qa_samples
- **Flag Rate**: `SELECT COUNT(*) WHERE status='open'` from review_flags ÷ total items
- **Label Error Rate**: Flags resolved with `resolution_action IN ('label_corrected', 'both_corrected')` ÷ total resolved
- **Discrepancy Rate**: Items with different labels in linked datasets ÷ total overlapping items

---

## 11. Claude Prompts for Implementation

### Full System Prompt (for starting fresh)
```
I need to implement an annotation and QA workflow system for a detection labeling platform. The system has:

ROLES:
- Annotators: Label images with DETECTED/NOT_DETECTED, assign attributes, flag uncertain items
- QA Managers: Review flags, sample annotations for accuracy, track annotator performance

WORKFLOW:
Datasets flow through: draft → assigned → in_progress → submitted → in_qa → approved/needs_revision → finalized

KEY FEATURES NEEDED:
1. Annotation workspace with user identity selector, summary dashboard, and image-by-image labeling view
2. Secondary review flagging (annotator flags → manager resolves with documented action)
3. Annotator flags tracking page (see own flags + resolutions)
4. Annotator performance page (accuracy, flag rate, per-dataset metrics)
5. QA metrics dashboard (per-annotator: accuracy, flag rate, label error, attr error, discrepancy, correction rates)
6. Flags queue for QA managers (batch operations, image preview modals)

DESIGN PATTERNS:
- Full-width tab bars with icons for section navigation
- Summary stat cards (clickable to filter)
- Fixed-column tables with progress bars and status badges
- Image preview modals with zoom/pan and side detail panels
- InfoTip hover tooltips for metric explanations
- Auto-saving annotator notes
- Keyboard navigation for image-by-image views

Please implement these features following this architecture. Start with [specific feature].
```

### Individual Feature Prompts

See the "Example Claude Prompt" section under each feature above for targeted prompts to implement each feature independently.

---

## Appendix: Visual Reference (Screenshots)

All screenshots are in the `screenshots/` directory. They show the prototype with seeded realistic data.

### Annotation Tab — My Datasets Dashboard

![Annotation My Datasets](screenshots/02_annotation_my_datasets.png)

Shows: Delaney selected as user, sub-tab bar (My Datasets / Flags with badge / Performance), 4 summary cards, filter tab bar with icons, dataset table with progress bars, status badges, and flag counts.

### Annotation Tab — Flags (Open)

![Annotation Flags Open](screenshots/03_annotation_flags_open.png)

Shows: Open flags list with image thumbnails, dataset name per flag, flag reason, date, and "Click to view" action. Filter pills (Open/Resolved) with counts.

### Annotation Tab — Flags (Resolved)

![Annotation Flags Resolved](screenshots/04_annotation_flags_resolved.png)

Shows: Resolved flags with resolution action badges and notes visible in expanded view.

### Annotation Tab — Performance

![Annotation Performance](screenshots/05_annotation_performance.png)

Shows: 4 metrics cards (Accuracy, Flag Rate, Datasets Finalized, Items Labeled) each with InfoTip hover tooltip. Empty state message when no finalized datasets exist for this annotator.

### Quality Assurance — Pipeline View

![QA Pipeline](screenshots/06_qa_pipeline.png)

Shows: Kanban-style pipeline with datasets organized by status columns (Draft, Assigned, In Progress, Submitted, In QA, Needs Revision, Approved, Finalized). Cards show dataset name, detection, assignee, flag count, and progress bar. Filters for status, detection, and assignee.

### Quality Assurance — Flags Queue

![QA Flags Queue](screenshots/07_qa_flags_queue.png)

Shows: Open flags section with image thumbnails, flag reasons, dates, batch action buttons (Resolve All / Dismiss All), resolution action dropdown, per-page selector (compact, right-aligned). Resolved flags section below with resolution badges.

### Quality Assurance — Metrics & Logs

![QA Metrics & Logs](screenshots/08_qa_metrics_logs.png)

Shows: "Annotator Metrics" and "Activity Log" toggle buttons (Metrics first), detection filter selector (inline, 1/3 width), table with columns: Annotator, Datasets, Items, Accuracy, Flag Rate, Label Error, Attr Error, Discrepancy, Correction — each with InfoTip tooltip icon.

### Saved Datasets Tab

![Saved Datasets](screenshots/09_saved_datasets.png)

Shows: Full-width tab bar with icons (All / Finalized / In Review / Processing / Drafts / Archived), dataset table with status badges and linked dataset indicators, pagination, and expandable dataset details panel.

---

### Design Tokens Used
- Active tab: `bg-[rgba(92,184,255,0.12)]` with `ring-1 ring-[rgba(182,223,255,0.22)]`
- Card hover: `bg-[var(--app-table-row-hover)]`
- Status colors: emerald (approved/finalized), blue (assigned/in_progress), amber (submitted/in_qa), red (needs_revision)
- Accent blue: `#5cb8ff`
- DETECTED label: purple accent
- NOT_DETECTED label: secondary accent
- Surface: `var(--app-surface-strong)`, `var(--app-surface-soft)`
- Text hierarchy: `var(--app-text)`, `var(--app-text-muted)`, `var(--app-text-subtle)`
- Borders: `var(--app-border)`, `var(--app-border-strong)`

### Reproducing Screenshots

To regenerate screenshots with fresh data:
```bash
node scripts/seed-qa-data.mjs     # Seeds realistic annotation/QA data
node scripts/capture-screenshots.mjs  # Captures all feature screenshots
```

Requires: dev server running on port 3000, puppeteer installed.

---

*End of handoff document. For questions or clarification, contact Delaney Foley.*
