import { z } from "zod";

const DecisionSchema = z.enum(["DETECTED", "NOT_DETECTED"]);

export const DetectionCreateSchema = z.object({
  detection_code: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  description: z.string().optional(),
  label_policy: z.string().optional(),
  decision_rubric: z.array(z.string()).optional(),
  segment_taxonomy: z.array(z.string()).optional(),
  metric_thresholds: z.record(z.string(), z.any()).optional(),
});

export const DetectionUpdateSchema = z.object({
  detection_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  description: z.string().optional(),
  label_policy: z.string().optional(),
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

export const DatasetDeleteSchema = z.object({
  dataset_id: z.string().trim().min(1),
});
