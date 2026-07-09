// ============ Core Enums ============

export type Decision = "DETECTED" | "NOT_DETECTED";
export type SplitType = "MASTER" | "GOLDEN" | "ITERATION" | "HELD_OUT_EVAL" | "CUSTOM";
export type PrimaryMetric = "precision" | "recall" | "f1";
export type DetectionCategory = "INCORRECT_CAPTURE" | "HAZARD_IDENTIFICATION";
export type ErrorTag =
  | "MISSED_DETECTION"
  | "FALSE_POSITIVE"
  | "INFERENCE_CALL_FAILED"
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
  qa_approval_threshold?: number;
}

export interface Detection {
  detection_id: string;
  detection_code: string;
  display_name: string;
  description: string;
  detection_category: DetectionCategory;
  label_policy: string;
  user_prompt_addendum: string;
  decision_rubric: string[];
  segment_taxonomy: string[];
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
  user_prompt_addendum?: string;
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
  version_notes: string;
  created_by: string;
  created_at: string;
  golden_set_regression_result: RegressionResult | null;
  source_prompt_version_id?: string | null;
}

export type VersionNoteEntryOrigin = "auto_created" | "auto_diff" | "auto_hil" | "user";
export type VersionNoteEntryEventType =
  | "version_created"
  | "version_edited_from"
  | "hil_finalized"
  | "ai_prompt_iteration"
  | null;

export interface VersionNoteEntry {
  entry_id: string;
  prompt_version_id: string;
  origin: VersionNoteEntryOrigin;
  event_type: VersionNoteEntryEventType;
  body: string;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
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
  detection_id: string | null;
  split_type: SplitType;
  dataset_hash: string;
  size: number;
  created_at: string;
  updated_at: string;
  qa_status: QaStatus;
  assigned_to: string | null;
  linked_dataset_id: string | null;
  qa_notes: string;
  items_labeled: number;
  revision_note: string | null;
  segment_taxonomy: string[];
}

export interface DatasetItem {
  item_id: string;
  dataset_id: string;
  image_id: string;
  image_uri: string;
  image_description?: string | null;
  segment_tags?: string[];
  ai_assigned_label?: Decision | "PARSE_FAIL" | null;
  ai_confidence?: number | null;
  ground_truth_label?: Decision | null;
  item_status?: ItemStatus;
}

// ============ Run ============

export interface Run {
  run_id: string;
  detection_id: string;
  prompt_version_id: string;
  model_used: string;
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
    test_regression_result?: {
      previous: { run_id: string; metrics_summary: MetricsSummary } | null;
      candidate: { run_id: string; metrics_summary: MetricsSummary } | null;
      passed: boolean | null;
      evaluated_at: string;
    } | null;
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
  image_description?: string | null;
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
  segment_metrics?: Record<
    string,
    {
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
  >;
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

// ============ Review Flags ============

export type ReviewFlagStatus = "open" | "resolved" | "dismissed";
export type ResolutionAction =
  | "accepted"
  | "label_confirmed"
  | "label_corrected"
  | "attributes_corrected"
  | "both_corrected"
  | "image_removed"
  | "needs_discussion";

export interface ReviewFlag {
  flag_id: string;
  prediction_id: string | null;
  dataset_item_id: string | null;
  detection_id: string;
  image_id: string;
  reason: string;
  status: ReviewFlagStatus;
  resolution_action: ResolutionAction | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by?: string | null;
  previous_ground_truth_label?: string | null;
  new_ground_truth_label?: string | null;
  previous_attributes?: string | null;
  new_attributes?: string | null;
}

export interface GroundtruthCorrection {
  correction_id: string;
  prediction_id: string;
  run_id: string;
  dataset_id: string;
  image_id: string;
  old_label: Decision | null;
  new_label: Decision | null;
  predicted_decision: Decision | "PARSE_FAIL" | null;
  ai_matches_new_gt: boolean | null;
  reason: string | null;
  actor: string | null;
  created_at: string;
}

// ============ Quality Assurance ============

export type QaStatus =
  | "draft"
  | "assigned"
  | "in_annotation"
  | "submitted"
  | "in_qa"
  | "needs_revision"
  | "approved"
  | "finalized"
  | "archived"
  // Legacy status kept for backward compatibility
  | "rejected";

export type ItemStatus = "unlabeled" | "labeled" | "flagged" | "corrected";

export type QaSampleMethod = "random" | "stratified" | "flagged" | "discrepancy";
export type QaSampleStatus = "pending" | "reviewed" | "skipped" | "accepted";
export type QaSampleOutcome = "accepted" | "label_corrected" | "attributes_corrected" | "both_corrected";
export type QaLogAction =
  | "status_change"
  | "sample_reviewed"
  | "discrepancy_resolved"
  | "flag_resolved"
  | "label_corrected"
  | "assigned"
  | "linked"
  | "submitted"
  | "revision_requested"
  | "approved"
  | "finalized"
  | "unfinalized";

export interface QaSample {
  sample_id: string;
  dataset_id: string;
  item_id: string;
  sample_method: QaSampleMethod;
  reviewer: string | null;
  status: QaSampleStatus;
  outcome: QaSampleOutcome | null;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface QaLog {
  log_id: string;
  dataset_id: string;
  action: QaLogAction;
  actor: string | null;
  details: string;
  created_at: string;
}

export interface Notification {
  notification_id: string;
  recipient: string;
  type: string;
  dataset_id: string | null;
  title: string;
  message: string;
  dismissed: boolean;
  created_at: string;
}

export interface AnnotatorMetrics {
  annotator: string;
  datasets_assigned: number;
  datasets_completed: number;
  items_labeled: number;
  flag_rate: number | null;
  attribute_error: number | null;
  label_error: number | null;
  accuracy: number | null;
  correction: number | null;
}

export interface MetricsSnapshot {
  snapshot_id: string;
  annotator: string;
  period_start: string;
  period_end: string;
  period_type: "week" | "month";
  datasets_assigned: number;
  datasets_completed: number;
  items_labeled: number;
  flag_rate: number | null;
  attribute_error: number | null;
  label_error: number | null;
  accuracy: number | null;
  correction: number | null;
}

export interface DatasetMetric {
  id: string;
  dataset_id: string;
  dataset_name: string;
  annotator: string;
  items_labeled: number;
  flag_rate: number | null;
  attribute_error: number | null;
  label_error: number | null;
  accuracy: number | null;
  correction: number | null;
  status: string;
  updated_at: string;
}
