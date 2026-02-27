// ============ Core Enums ============

export type Decision = "DETECTED" | "NOT_DETECTED";
export type SplitType = "GOLDEN" | "ITERATION" | "HELD_OUT_EVAL" | "CUSTOM";
export type PrimaryMetric = "precision" | "recall" | "f1";
export type ErrorTag =
  | "MISSED_DETECTION"
  | "FALSE_POSITIVE"
  | "AMBIGUOUS_IMAGE"
  | "LABEL_POLICY_GAP"
  | "PROMPT_INSTRUCTION_GAP"
  | "SCHEMA_VIOLATION";

// ============ Detection ============

export interface MetricThresholds {
  min_precision?: number;
  min_recall?: number;
  min_f1?: number;
  primary_metric: PrimaryMetric;
}

export interface Detection {
  detection_id: string;
  detection_code: string;
  display_name: string;
  description: string;
  label_policy: string;
  decision_rubric: string[];
  metric_thresholds: MetricThresholds;
  approved_prompt_version: string | null;
  created_at: string;
  updated_at: string;
}

// ============ Prompt Version ============

export interface PromptStructure {
  detection_identity: string;
  label_policy: string;
  decision_rubric: string;
  output_schema: string;
  examples: string;
}

export interface PromptVersion {
  prompt_version_id: string;
  detection_id: string;
  version_label: string;
  system_prompt: string;
  user_prompt_template: string;
  prompt_structure: PromptStructure;
  model: string;
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  change_notes: string;
  created_by: string;
  created_at: string;
  golden_set_regression_result: RegressionResult | null;
}

export interface RegressionResult {
  passed: boolean;
  run_id: string;
  metrics: MetricsSummary;
  previous_metrics: MetricsSummary | null;
  evaluated_at: string;
}

// ============ Dataset ============

export interface Dataset {
  dataset_id: string;
  name: string;
  detection_id: string;
  split_type: SplitType;
  dataset_hash: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetItem {
  item_id: string;
  dataset_id: string;
  image_id: string;
  image_uri: string;
  image_description?: string | null;
  ai_assigned_label?: Decision | "PARSE_FAIL" | null;
  ai_confidence?: number | null;
  ground_truth_label?: Decision | null;
}

// ============ Run ============

export interface Run {
  run_id: string;
  detection_id: string;
  prompt_version_id: string;
  prompt_snapshot: string; // JSON serialized full prompt
  decoding_params: string; // JSON serialized
  dataset_id: string;
  dataset_hash: string;
  split_type: SplitType;
  created_at: string;
  metrics_summary: MetricsSummary;
  status: "running" | "completed" | "cancelled" | "failed";
  total_images: number;
  processed_images: number;
  prompt_feedback_log?: {
    accepted: PromptEditSuggestion[];
    rejected: PromptEditSuggestion[];
    created_prompt_version_id?: string | null;
    created_at?: string;
  } | null;
}

export interface Prediction {
  prediction_id: string;
  run_id: string;
  image_id: string;
  image_uri: string;
  ground_truth_label?: Decision | null;
  predicted_decision: Decision | null;
  confidence: number | null;
  evidence: string | null;
  parse_ok: boolean;
  raw_response: string;
  parse_error_reason?: string | null;
  parse_fix_suggestion?: string | null;
  inference_runtime_ms?: number | null;
  parse_retry_count?: number | null;
  corrected_label: Decision | null;
  error_tag: ErrorTag | null;
  reviewer_note: string | null;
  corrected_at: string | null;
}

// ============ Metrics ============

export interface MetricsSummary {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  prevalence: number;
  parse_failure_rate: number;
  total: number;
}

// ============ Gemini Response Schema ============

export interface GeminiDetectionResponse {
  detection_code: string;
  decision: Decision;
  confidence: number;
  evidence: string;
}

// ============ Prompt Edit Suggestion ============

export interface PromptEditSuggestion {
  section: string;
  old_text: string;
  new_text: string;
  rationale: string;
  failure_cluster: string;
  priority?: number;
  risk?: "low" | "medium" | "high" | string;
  expected_metric_impact?: string;
  expected_parse_fail_impact?: string;
}
