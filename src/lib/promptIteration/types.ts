import type { Decision, MetricsSummary } from "@/types";

/**
 * Shared types for the automated AI prompt-iteration workflow.
 *
 * The workflow packages a finalized HIL review, analyzes failure modes, asks
 * an AI to draft several candidate prompt variants, evaluates each on a held-out
 * slice of the reviewed images, then promotes the best safe candidate to a new
 * prompt version — with anti-overfitting guardrails throughout.
 */

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type IterationPhase =
  | "preparing"
  | "baseline"
  | "analysis"
  | "generation"
  | "evaluation"
  | "selection"
  | "saving"
  | "reporting"
  | "done";

export type RowOutcome = "TP" | "FP" | "FN" | "TN" | "PARSE_FAIL" | "UNLABELED";

/** A single reviewed image packaged for AI analysis / evaluation. */
export interface ReviewedRow {
  image_id: string;
  image_uri: string;
  /** Original dataset ground-truth label before HIL review. */
  original_ground_truth: Decision | null;
  /** Finalized label after HIL review (reviewer correction wins). */
  finalized_ground_truth: Decision | null;
  ai_predicted: Decision | null;
  ai_evidence: string | null;
  reviewer_note: string | null;
  /** Finalized attribute/segment tags for this image (for attribute-aware splits). */
  attributes: string[];
  confidence: number | null;
  parse_ok: boolean;
  /** Outcome of the ORIGINAL run's prediction vs the finalized ground truth. */
  outcome: RowOutcome;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  parseFail: number;
  total: number;
}

export interface CoreMetrics {
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export type CandidateKind = "lean" | "conservative" | "recall" | "balanced";

/** A candidate prompt variant proposed by the AI (or heuristic fallback). */
export interface PromptCandidate {
  id: string;
  kind: CandidateKind;
  label: string;
  target_failure_mode: string;
  rationale: string;
  /** Tuned prompt_structure fields. Omitted fields inherit from the source. */
  label_policy: string;
  decision_rubric: string;
  system_prompt?: string | null;
  /**
   * Tuned detection-specific guidance (the "Detection-Specific Addendum" body
   * of the user prompt template). When provided, the user prompt template is
   * rebuilt from the fixed base + this addendum; when null, it inherits.
   */
  user_prompt_addendum?: string | null;
}

/** Result of evaluating a candidate on the holdout slice. */
export interface CandidateResult {
  candidate: PromptCandidate;
  confusion: Confusion;
  metrics: CoreMetrics;
  /** Character length of the compiled tuned fields (complexity proxy). */
  complexity: number;
  /** Genuine parse errors (schema-invalid model output) on the holdout. */
  parse_errors: number;
  /** image_ids whose prediction changed vs the baseline on the holdout. */
  changed_rows: string[];
  /** Reasons this candidate was rejected by guardrails, if any. */
  rejected_reasons: string[];
  eval_error?: string | null;
}

export interface FailureMode {
  name: string;
  kind: "FP" | "FN" | "PARSE";
  count: number;
  example_evidence: string[];
}

export interface SelectionResult {
  selected: CandidateResult | null;
  baseline: CoreMetrics;
  reasons: string[];
  goal_met: boolean;
}

/** Per-round outcome, saved so each iteration's prompt + run is inspectable. */
export interface RoundSummary {
  round: number;
  prompt_version_id: string | null;
  run_id: string | null;
  label: string;
  precision: number;
  recall: number;
  f1: number;
  complexity: number;
  parse_errors: number;
  promoted: boolean;
  is_best: boolean;
  candidates_evaluated: number;
  /** Estimated size of the compiled prompt (approximate tokens). */
  prompt_tokens?: number;
  /** Short human-readable blurb: what this prompt optimizes for / changes. */
  blurb?: string;
}

export interface IterationLogEntry {
  ts: string;
  phase: IterationPhase;
  message: string;
}

export interface IterationJob {
  job_id: string;
  run_id: string;
  detection_id: string;
  source_prompt_version_id: string;
  status: JobStatus;
  phase: IterationPhase | null;
  progress: number;
  goal_f1: number | null;
  max_rounds: number;
  precision_floor: number | null;
  /** Max F1 (fraction) the operator will trade for a leaner prompt in selection. */
  lean_preference: number | null;
  /** Optional per-run override for the pinned fixed guidance block. */
  fixed_guidance: string | null;
  /** Optimization objective as raw JSON (parsed by the orchestrator). */
  objective: unknown | null;
  current_round: number;
  rounds: RoundSummary[];
  candidates_generated: number;
  candidates_evaluated: number;
  best_f1: number | null;
  best_precision: number | null;
  best_recall: number | null;
  logs: IterationLogEntry[];
  baseline_metrics: MetricsSummary | null;
  candidates: CandidateResult[];
  report: string | null;
  result_prompt_version_id: string | null;
  result_run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
