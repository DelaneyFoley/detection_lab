import { dataStore } from "@/lib/services";
import type {
  CompareJob,
  CompareJobStatus,
  ComparePhase,
  CompareLogEntry,
  EvalPromptComparison,
  PromptDisagreementMetrics,
  SynthesisAnalysis,
} from "@/lib/promptCompare/types";
import type { MetricsSummary } from "@/types";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface EvalResultsBlob {
  eval_summary: MetricsSummary | null;
  eval_comparisons: EvalPromptComparison[] | null;
}

function rowToJob(row: any): CompareJob {
  const evalBlob = parseJson<EvalResultsBlob | null>(row.eval_results, null);
  return {
    job_id: row.job_id,
    detection_id: row.detection_id,
    source_prompt_version_ids: parseJson<string[]>(row.source_prompt_version_ids, []),
    status: row.status as CompareJobStatus,
    phase: (row.phase ?? null) as ComparePhase | null,
    progress: Number(row.progress ?? 0),
    disagreement_image_count: Number(row.disagreement_image_count ?? 0),
    evaluate: Number(row.evaluate ?? 0) === 1,
    analyzer_model: row.analyzer_model ?? "",
    analyzer_temperature: Number(row.analyzer_temperature ?? 0.4),
    image_cap: Number(row.image_cap ?? 40),
    include_agreement_samples: Number(row.include_agreement_samples ?? 0) === 1,
    per_prompt_metrics: parseJson<PromptDisagreementMetrics[] | null>(row.per_prompt_metrics, null),
    synthesis_analysis: parseJson<SynthesisAnalysis | null>(row.synthesis_analysis, null),
    report: row.report ?? null,
    result_prompt_version_id: row.result_prompt_version_id ?? null,
    result_run_id: row.result_run_id ?? null,
    result_dataset_id: row.result_dataset_id ?? null,
    eval_summary: evalBlob?.eval_summary ?? null,
    eval_comparisons: evalBlob?.eval_comparisons ?? null,
    logs: parseJson<CompareLogEntry[]>(row.logs, []),
    error: row.error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
  };
}

export interface CompareJobPatch {
  status?: CompareJobStatus;
  phase?: ComparePhase | null;
  progress?: number;
  disagreement_image_count?: number;
  per_prompt_metrics?: PromptDisagreementMetrics[] | null;
  synthesis_analysis?: SynthesisAnalysis | null;
  eval_summary?: MetricsSummary | null;
  eval_comparisons?: EvalPromptComparison[] | null;
  report?: string | null;
  result_prompt_version_id?: string | null;
  result_run_id?: string | null;
  result_dataset_id?: string | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export class PromptCompareJobRepository {
  createJob(input: {
    jobId: string;
    detectionId: string;
    sourcePromptVersionIds: string[];
    analyzerModel: string;
    analyzerTemperature: number;
    imageCap: number;
    includeAgreementSamples: boolean;
    evaluate: boolean;
  }): void {
    const now = new Date().toISOString();
    dataStore.run(
      `INSERT INTO prompt_compare_jobs
        (job_id, detection_id, source_prompt_version_ids, status, phase, progress,
         disagreement_image_count, evaluate, analyzer_model, analyzer_temperature,
         image_cap, include_agreement_samples, logs, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', 'preparing', 0, 0, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      input.jobId,
      input.detectionId,
      JSON.stringify(input.sourcePromptVersionIds),
      input.evaluate ? 1 : 0,
      input.analyzerModel,
      input.analyzerTemperature,
      input.imageCap,
      input.includeAgreementSamples ? 1 : 0,
      now,
      now
    );
  }

  getJob(jobId: string): CompareJob | undefined {
    const row = dataStore.get<any>("SELECT * FROM prompt_compare_jobs WHERE job_id = ?", jobId);
    return row ? rowToJob(row) : undefined;
  }

  updateJob(jobId: string, patch: CompareJobPatch): void {
    const setClauses: string[] = [];
    const params: Array<string | number | null> = [];
    const existingEval = (): EvalResultsBlob => {
      const row = dataStore.get<{ eval_results: string | null }>(
        "SELECT eval_results FROM prompt_compare_jobs WHERE job_id = ?",
        jobId
      );
      return parseJson<EvalResultsBlob>(row?.eval_results, { eval_summary: null, eval_comparisons: null });
    };

    const push = (col: string, val: string | number | null) => {
      setClauses.push(`${col} = ?`);
      params.push(val);
    };

    if (patch.status !== undefined) push("status", patch.status);
    if (patch.phase !== undefined) push("phase", patch.phase);
    if (patch.progress !== undefined) push("progress", patch.progress);
    if (patch.disagreement_image_count !== undefined) push("disagreement_image_count", patch.disagreement_image_count);
    if (patch.per_prompt_metrics !== undefined) push("per_prompt_metrics", patch.per_prompt_metrics == null ? null : JSON.stringify(patch.per_prompt_metrics));
    if (patch.synthesis_analysis !== undefined) push("synthesis_analysis", patch.synthesis_analysis == null ? null : JSON.stringify(patch.synthesis_analysis));
    if (patch.report !== undefined) push("report", patch.report);
    if (patch.result_prompt_version_id !== undefined) push("result_prompt_version_id", patch.result_prompt_version_id);
    if (patch.result_run_id !== undefined) push("result_run_id", patch.result_run_id);
    if (patch.result_dataset_id !== undefined) push("result_dataset_id", patch.result_dataset_id);
    if (patch.error !== undefined) push("error", patch.error);
    if (patch.started_at !== undefined) push("started_at", patch.started_at);
    if (patch.finished_at !== undefined) push("finished_at", patch.finished_at);

    if (patch.eval_summary !== undefined || patch.eval_comparisons !== undefined) {
      const cur = existingEval();
      const merged: EvalResultsBlob = {
        eval_summary: patch.eval_summary !== undefined ? patch.eval_summary : cur.eval_summary,
        eval_comparisons: patch.eval_comparisons !== undefined ? patch.eval_comparisons : cur.eval_comparisons,
      };
      push("eval_results", JSON.stringify(merged));
    }

    if (setClauses.length === 0) return;
    setClauses.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(jobId);
    dataStore.run(`UPDATE prompt_compare_jobs SET ${setClauses.join(", ")} WHERE job_id = ?`, ...params);
  }

  appendLog(jobId: string, phase: ComparePhase, message: string): void {
    const job = this.getJob(jobId);
    if (!job) return;
    const logs = [...job.logs, { ts: new Date().toISOString(), phase, message }].slice(-200);
    dataStore.run(
      "UPDATE prompt_compare_jobs SET logs = ?, updated_at = ? WHERE job_id = ?",
      JSON.stringify(logs),
      new Date().toISOString(),
      jobId
    );
  }
}

export const promptCompareJobRepository = new PromptCompareJobRepository();
