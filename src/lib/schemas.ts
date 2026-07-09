import { z } from "zod";

const DecisionSchema = z.enum(["DETECTED", "NOT_DETECTED"]);
const DetectionCategorySchema = z.enum(["INCORRECT_CAPTURE", "HAZARD_IDENTIFICATION"]);

export const DetectionCreateSchema = z.object({
  detection_code: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  description: z.string().optional(),
  detection_category: DetectionCategorySchema,
  label_policy: z.string().optional(),
  user_prompt_addendum: z.string().optional(),
  decision_rubric: z.array(z.string()).optional(),
  segment_taxonomy: z.array(z.string()).optional(),
  metric_thresholds: z.record(z.string(), z.any()).optional(),
});

export const DetectionUpdateSchema = z.object({
  detection_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  description: z.string().optional(),
  detection_category: DetectionCategorySchema,
  label_policy: z.string().optional(),
  user_prompt_addendum: z.string().optional(),
  decision_rubric: z.array(z.string()).optional(),
  segment_taxonomy: z.array(z.string()).optional(),
  metric_thresholds: z.record(z.string(), z.any()).optional(),
  approved_prompt_version: z.string().trim().min(1).nullable().optional(),
});

export const DetectionDeleteSchema = z.object({
  detection_id: z.string().trim().min(1),
});

export const RunCreateSchema = z.object({
  prompt_version_id: z.string().trim().min(1),
  dataset_id: z.string().trim().min(1),
  detection_id: z.string().trim().min(1),
  allow_eval_run: z.boolean().optional(),
  model_override: z.string().trim().min(1).optional(),
  api_key: z.string().trim().min(1).optional(),
  max_concurrency: z.number().int().min(1).max(12).optional(),
});

export const RunUpdateSchema = z.object({
  run_id: z.string().trim().min(1),
  action: z.literal("cancel").optional(),
  prompt_feedback_log: z.record(z.string(), z.any()).optional(),
});

export const HilUpdateSchema = z.object({
  prediction_id: z.string().trim().min(1),
  corrected_label: DecisionSchema.nullable().optional(),
  ground_truth_label: DecisionSchema.nullable().optional(),
  error_tag: z.string().trim().min(1).nullable().optional(),
  reviewer_note: z.string().nullable().optional(),
  update_ground_truth: z.boolean().optional(),
  correction_reason: z.string().optional(),
});

export const HilRecomputeSchema = z.object({
  run_id: z.string().trim().min(1),
});

export const GeminiAssistSchema = z.object({
  predictions: z.array(z.any()),
  prompt: z.record(z.string(), z.any()),
  detection: z.record(z.string(), z.any()),
  model_override: z.string().optional(),
  api_key: z.string().optional(),
});

export const PromptCreateSchema = z.object({
  detection_id: z.string().trim().min(1),
  version_label: z.string().trim().min(1),
  prompt_structure: z.record(z.string(), z.any()).optional(),
  model: z.string().trim().min(1).optional(),
  temperature: z.number().finite().optional(),
  top_p: z.number().finite().optional(),
  max_output_tokens: z.number().int().min(1).max(8192).optional(),
  change_notes: z.string().optional(),
  version_notes: z.string().optional(),
  created_by: z.string().trim().min(1).optional(),
  source_prompt_version_id: z.string().trim().min(1).nullable().optional(),
});

export const PromptUpdateSchema = z.object({
  prompt_version_id: z.string().trim().min(1),
  golden_set_regression_result: z.record(z.string(), z.any()).nullable().optional(),
  version_notes: z.string().optional(),
});

export const PromptDeleteSchema = z.object({
  prompt_version_id: z.string().trim().min(1),
});

export const DatasetDeleteSchema = z.object({
  dataset_id: z.string().trim().min(1),
});

export const ReviewFlagCreateSchema = z.object({
  prediction_id: z.string().trim().min(1).optional(),
  dataset_item_id: z.string().trim().min(1).optional(),
  detection_id: z.string().trim().min(1),
  image_id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const ReviewFlagResolveSchema = z.object({
  flag_id: z.string().trim().min(1),
  status: z.enum(["resolved", "dismissed"]),
  resolution_action: z.enum([
    "accepted",
    "label_confirmed",
    "label_corrected",
    "attributes_corrected",
    "both_corrected",
    "image_removed",
    "needs_discussion",
    "correct",
    "incorrect_both",
    "incorrect_attributes",
    "incorrect_label",
    "ambiguous",
  ]).optional(),
  resolution_note: z.string().nullable().optional(),
  resolved_by: z.string().trim().min(1).optional(),
  previous_ground_truth_label: z.string().nullable().optional(),
  new_ground_truth_label: z.string().nullable().optional(),
  previous_attributes: z.array(z.string()).nullable().optional(),
  new_attributes: z.array(z.string()).nullable().optional(),
});

// ============ QA Schemas ============

export const QA_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["assigned"],
  assigned: ["in_annotation", "draft"],
  in_annotation: ["submitted", "assigned"],
  submitted: ["in_qa"],
  in_qa: ["approved", "needs_revision"],
  needs_revision: ["in_annotation", "submitted"],
  approved: ["in_qa"],
  finalized: [],
  // archived is set automatically by mergeChildrenIntoParent — no manual transitions out.
  archived: [],
  // Legacy status maps forward
  rejected: ["in_annotation", "needs_revision", "draft"],
};

export const QaStatusUpdateSchema = z.object({
  action: z.literal("update_status"),
  dataset_id: z.string().trim().min(1),
  new_status: z.enum(["draft", "assigned", "in_annotation", "submitted", "in_qa", "needs_revision", "approved", "finalized", "archived", "rejected"]),
  actor: z.string().trim().min(1).optional(),
  revision_note: z.string().optional(),
  qa_override_reason: z.string().trim().min(1).optional(),
});

export const QaAssignSchema = z.object({
  action: z.literal("assign"),
  dataset_id: z.string().trim().min(1),
  assigned_to: z.string().trim().min(1).nullable(),
  actor: z.string().trim().min(1).optional(),
});

export const QaLinkDatasetsSchema = z.object({
  action: z.literal("link_datasets"),
  dataset_id_a: z.string().trim().min(1),
  dataset_id_b: z.string().trim().min(1),
});

export const QaCreateSamplesSchema = z.object({
  action: z.literal("create_samples"),
  dataset_id: z.string().trim().min(1),
  method: z.enum(["random", "stratified"]),
  count: z.number().int().min(1).max(500),
  stratify_by: z.enum(["label", "segment_tags"]).optional(),
  reviewer: z.string().trim().min(1).optional(),
});

export const QaReviewSampleSchema = z.object({
  action: z.literal("review_sample"),
  sample_id: z.string().trim().min(1),
  outcome: z.enum(["accepted", "label_corrected", "attributes_corrected", "both_corrected"]),
  note: z.string().nullable().optional(),
  reviewer: z.string().trim().min(1).optional(),
  original_label: z.string().nullable().optional(),
  original_tags: z.array(z.string()).nullable().optional(),
  corrected_label: z.string().nullable().optional(),
  corrected_tags: z.array(z.string()).nullable().optional(),
});

export const QaResolveDiscrepancySchema = z.object({
  action: z.literal("resolve_discrepancy"),
  dataset_id_a: z.string().trim().min(1),
  dataset_id_b: z.string().trim().min(1),
  image_id: z.string().trim().min(1),
  resolution: z.enum(["accept_a", "accept_b", "override"]),
  override_label: z.enum(["DETECTED", "NOT_DETECTED"]).optional(),
  corrected_tags: z.array(z.string()).optional(),
  actor: z.string().trim().min(1).optional(),
});

export const QaResolveNwaySchema = z.object({
  action: z.literal("resolve_nway_discrepancy"),
  parent_id: z.string().trim().min(1),
  image_id: z.string().trim().min(1),
  accepted_annotator: z.string().trim().min(1).optional(),
  override_label: z.enum(["DETECTED", "NOT_DETECTED"]).optional(),
  corrected_tags: z.array(z.string()).optional(),
  actor: z.string().trim().min(1).optional(),
});

export const DatasetDuplicateSchema = z.object({
  action: z.literal("duplicate"),
  dataset_id: z.string().trim().min(1),
  new_name: z.string().trim().min(1).optional(),
  assigned_to: z.string().trim().min(1).optional(),
  reset_labels: z.boolean().default(true),
  link: z.boolean().default(true),
});

export const DatasetAssignAnnotatorsSchema = z.object({
  action: z.literal("assign_annotators"),
  parent_dataset_id: z.string().trim().min(1),
  annotators: z.array(z.string().trim().min(1)).min(1).max(20),
  reset_labels: z.boolean().default(true),
  reset_segments: z.boolean().default(true),
});

export const DatasetFinalizeParentSchema = z.object({
  action: z.literal("finalize_parent"),
  parent_dataset_id: z.string().trim().min(1),
  resolutions: z.array(z.object({
    image_id: z.string().trim().min(1),
    label: z.enum(["DETECTED", "NOT_DETECTED"]),
    tags: z.array(z.string()).optional(),
  })).optional(),
  actor: z.string().trim().min(1).optional(),
});

export const DatasetSubmitSchema = z.object({
  action: z.literal("submit"),
  dataset_id: z.string().trim().min(1),
  actor: z.string().trim().min(1).optional(),
});
