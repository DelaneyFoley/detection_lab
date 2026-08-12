import type { Decision, MetricsSummary } from "@/types";
import type { CoreMetrics, RowOutcome } from "@/lib/promptIteration/types";

export type CompareJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type ComparePhase =
  | "preparing"
  | "loading"
  | "analyzing"
  | "saving"
  | "evaluating"
  | "reporting"
  | "done";

export type DisagreementKind =
  | "PARTIAL_ERROR"
  | "UNANIMOUS_ERROR"
  | "PROMPT_DISAGREEMENT"
  | "AGREE_CORRECT"
  | "UNLABELED";

export interface CompareLogEntry {
  ts: string;
  phase: ComparePhase;
  message: string;
}

export interface PerPromptOutcome {
  prompt_version_id: string;
  predicted: Decision | null;
  evidence: string | null;
  parse_ok: boolean;
  outcome: RowOutcome;
}

export interface ClassifiedRow {
  dataset_id: string;
  image_id: string;
  image_uri: string;
  ground_truth: Decision | null;
  reviewer_note: string | null;
  per_prompt: PerPromptOutcome[];
  kind: DisagreementKind;
}

export interface PromptDisagreementMetrics {
  prompt_version_id: string;
  label: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  parse_fail: number;
  metrics: CoreMetrics;
}

export interface PerPromptAnalysis {
  prompt_version_id: string;
  label: string;
  strengths: string[];
  weaknesses: string[];
}

export interface SynthesisDraft {
  label: string;
  rationale: string;
  label_policy: string;
  decision_rubric: string;
  detection_guidance: string;
}

export interface SynthesisAnalysis {
  per_prompt: PerPromptAnalysis[];
  synthesis: SynthesisDraft;
}

export interface EvalPromptComparison {
  prompt_version_id: string;
  label: string;
  source_metrics: CoreMetrics;
  synthesized_metrics: CoreMetrics;
}

export interface CompareJob {
  job_id: string;
  detection_id: string;
  source_prompt_version_ids: string[];
  status: CompareJobStatus;
  phase: ComparePhase | null;
  progress: number;
  disagreement_image_count: number;
  evaluate: boolean;
  analyzer_model: string;
  analyzer_temperature: number;
  image_cap: number;
  include_agreement_samples: boolean;
  per_prompt_metrics: PromptDisagreementMetrics[] | null;
  synthesis_analysis: SynthesisAnalysis | null;
  report: string | null;
  result_prompt_version_id: string | null;
  result_run_id: string | null;
  result_dataset_id: string | null;
  eval_summary: MetricsSummary | null;
  eval_comparisons: EvalPromptComparison[] | null;
  logs: CompareLogEntry[];
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
