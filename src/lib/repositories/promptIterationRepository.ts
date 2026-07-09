import { dataStore } from "@/lib/services";
import type {
  CandidateResult,
  IterationJob,
  IterationLogEntry,
  IterationPhase,
  JobStatus,
  RoundSummary,
} from "@/lib/promptIteration/types";
import type { MetricsSummary } from "@/types";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToJob(row: any): IterationJob {
  return {
    job_id: row.job_id,
    run_id: row.run_id,
    detection_id: row.detection_id,
    source_prompt_version_id: row.source_prompt_version_id,
    status: row.status as JobStatus,
    phase: (row.phase ?? null) as IterationPhase | null,
    progress: Number(row.progress ?? 0),
    goal_f1: row.goal_f1 == null ? null : Number(row.goal_f1),
    max_rounds: Number(row.max_rounds ?? 1),
    precision_floor: row.precision_floor == null ? null : Number(row.precision_floor),
    lean_preference: row.lean_preference == null ? null : Number(row.lean_preference),
    fixed_guidance: row.fixed_guidance ?? null,
    objective: parseJson<unknown>(row.objective, null),
    current_round: Number(row.current_round ?? 0),
    rounds: parseJson<RoundSummary[]>(row.rounds, []),
    candidates_generated: Number(row.candidates_generated ?? 0),
    candidates_evaluated: Number(row.candidates_evaluated ?? 0),
    best_f1: row.best_f1 == null ? null : Number(row.best_f1),
    best_precision: row.best_precision == null ? null : Number(row.best_precision),
    best_recall: row.best_recall == null ? null : Number(row.best_recall),
    logs: parseJson<IterationLogEntry[]>(row.logs, []),
    baseline_metrics: parseJson<MetricsSummary | null>(row.baseline_metrics, null),
    candidates: parseJson<CandidateResult[]>(row.candidates, []),
    report: row.report ?? null,
    result_prompt_version_id: row.result_prompt_version_id ?? null,
    result_run_id: row.result_run_id ?? null,
    error: row.error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
  };
}

export interface JobPatch {
  status?: JobStatus;
  phase?: IterationPhase | null;
  progress?: number;
  goal_f1?: number | null;
  current_round?: number;
  rounds?: RoundSummary[];
  candidates_generated?: number;
  candidates_evaluated?: number;
  best_f1?: number | null;
  best_precision?: number | null;
  best_recall?: number | null;
  baseline_metrics?: MetricsSummary | null;
  candidates?: CandidateResult[];
  report?: string | null;
  result_prompt_version_id?: string | null;
  result_run_id?: string | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

const COLUMN_BY_KEY: Record<keyof JobPatch, string> = {
  status: "status",
  phase: "phase",
  progress: "progress",
  goal_f1: "goal_f1",
  current_round: "current_round",
  rounds: "rounds",
  candidates_generated: "candidates_generated",
  candidates_evaluated: "candidates_evaluated",
  best_f1: "best_f1",
  best_precision: "best_precision",
  best_recall: "best_recall",
  baseline_metrics: "baseline_metrics",
  candidates: "candidates",
  report: "report",
  result_prompt_version_id: "result_prompt_version_id",
  result_run_id: "result_run_id",
  error: "error",
  started_at: "started_at",
  finished_at: "finished_at",
};

const JSON_KEYS = new Set<keyof JobPatch>(["baseline_metrics", "candidates", "rounds"]);

export class PromptIterationRepository {
  createJob(input: {
    jobId: string;
    runId: string;
    detectionId: string;
    sourcePromptVersionId: string;
    goalF1: number | null;
    maxRounds: number;
    precisionFloor: number | null;
    leanPreference: number | null;
    fixedGuidance: string | null;
    objective: string | null;
  }): void {
    const now = new Date().toISOString();
    dataStore.run(
      `INSERT INTO prompt_iteration_jobs
        (job_id, run_id, detection_id, source_prompt_version_id, status, phase, progress, goal_f1, max_rounds, precision_floor, lean_preference, fixed_guidance, objective, current_round, rounds, logs, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 'preparing', 0, ?, ?, ?, ?, ?, ?, 0, '[]', '[]', ?, ?)`,
      input.jobId,
      input.runId,
      input.detectionId,
      input.sourcePromptVersionId,
      input.goalF1,
      input.maxRounds,
      input.precisionFloor,
      input.leanPreference,
      input.fixedGuidance,
      input.objective,
      now,
      now
    );
  }

  getJob(jobId: string): IterationJob | undefined {
    const row = dataStore.get<any>("SELECT * FROM prompt_iteration_jobs WHERE job_id = ?", jobId);
    return row ? rowToJob(row) : undefined;
  }

  getLatestJobForRun(runId: string): IterationJob | undefined {
    const row = dataStore.get<any>(
      "SELECT * FROM prompt_iteration_jobs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
      runId
    );
    return row ? rowToJob(row) : undefined;
  }

  /**
   * How many prior iteration jobs already ran against the same source prompt
   * version (excluding the current job). Used to give each re-run a distinct
   * "batch" so version labels never collide across iteration runs.
   */
  countPriorJobsForSource(sourcePromptVersionId: string, excludeJobId: string): number {
    const row = dataStore.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM prompt_iteration_jobs
       WHERE source_prompt_version_id = ? AND job_id != ?`,
      sourcePromptVersionId,
      excludeJobId
    );
    return row?.c ?? 0;
  }

  updateJob(jobId: string, patch: JobPatch): void {
    const setClauses: string[] = [];
    const params: Array<string | number | null> = [];
    (Object.keys(patch) as Array<keyof JobPatch>).forEach((key) => {
      const value = patch[key];
      if (value === undefined) return;
      setClauses.push(`${COLUMN_BY_KEY[key]} = ?`);
      if (JSON_KEYS.has(key)) {
        params.push(value == null ? null : JSON.stringify(value));
      } else {
        params.push(value as string | number | null);
      }
    });
    setClauses.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(jobId);
    dataStore.run(`UPDATE prompt_iteration_jobs SET ${setClauses.join(", ")} WHERE job_id = ?`, ...params);
  }

  appendLog(jobId: string, phase: IterationPhase, message: string): void {
    const job = this.getJob(jobId);
    if (!job) return;
    const logs = [...job.logs, { ts: new Date().toISOString(), phase, message }].slice(-200);
    dataStore.run(
      "UPDATE prompt_iteration_jobs SET logs = ?, updated_at = ? WHERE job_id = ?",
      JSON.stringify(logs),
      new Date().toISOString(),
      jobId
    );
  }
}

export const promptIterationRepository = new PromptIterationRepository();
