import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { promptIterationRepository, promptRepository, runRepository, versionNoteEntryRepository } from "@/lib/repositories";
import { iterationJobQueue } from "@/lib/services";
import { runPromptIterationJob } from "@/lib/promptIteration/orchestrator";
import { parseGoalF1, parseLeanPreference } from "@/lib/promptIteration/saving";
import { parseObjective } from "@/lib/promptIteration/metrics";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("job_id");
    const runId = searchParams.get("run_id");
    const promptVersionId = searchParams.get("prompt_version_id");
    if (promptVersionId) {
      const prompt = promptRepository.getFullPromptById(promptVersionId);
      if (!prompt) return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
      let structure: Record<string, unknown> = {};
      try {
        structure =
          prompt.prompt_structure && typeof prompt.prompt_structure === "object"
            ? prompt.prompt_structure
            : JSON.parse(String(prompt.prompt_structure || "{}"));
      } catch {
        structure = {};
      }
      const reviewRunId = searchParams.get("review_run_id");
      const predictions = reviewRunId ? runRepository.getRunPredictions(reviewRunId) : [];
      return NextResponse.json({
        prompt: {
          prompt_version_id: prompt.prompt_version_id,
          version_label: prompt.version_label,
          system_prompt: prompt.system_prompt,
          user_prompt_template: prompt.user_prompt_template,
          label_policy: structure.label_policy ?? "",
          decision_rubric: structure.decision_rubric ?? "",
          fixed_guidance: structure.fixed_guidance ?? "",
          version_notes: prompt.version_notes,
          model: prompt.model,
        },
        predictions,
      });
    }
    if (jobId) {
      const job = promptIterationRepository.getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }
    if (runId) {
      const job = promptIterationRepository.getLatestJobForRun(runId);
      return NextResponse.json({ job: job ?? null });
    }
    return NextResponse.json({ error: "job_id, run_id, or prompt_version_id required" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/prompt-iteration");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch prompt-iteration job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "hil:prompt-iteration:start", maxRequests: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const runId = String(body.run_id || "").trim();
    if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });

    const goalParsed = parseGoalF1(body.goal_f1);
    if (!goalParsed.ok) {
      return NextResponse.json({ error: goalParsed.error }, { status: 400 });
    }
    const goalF1 = goalParsed.value;

    let maxRounds = 3;
    if (body.max_rounds != null && body.max_rounds !== "") {
      const n = Math.floor(Number(body.max_rounds));
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return NextResponse.json({ error: "max_rounds must be an integer between 1 and 10" }, { status: 400 });
      }
      maxRounds = n;
    }

    const floorParsed = parseGoalF1(body.precision_floor);
    if (!floorParsed.ok) {
      return NextResponse.json({ error: "precision_floor must be between 0 and 1 (or 0 and 100)" }, { status: 400 });
    }
    const precisionFloor = floorParsed.value;

    const leanParsed = parseLeanPreference(body.lean_preference);
    if (!leanParsed.ok) {
      return NextResponse.json({ error: leanParsed.error }, { status: 400 });
    }
    const leanPreference = leanParsed.value;

    const fixedGuidance =
      typeof body.fixed_guidance === "string" ? body.fixed_guidance.trim() || null : null;

    // Optimization objective — validated/normalized by parseObjective; stored as JSON.
    const objective = body.objective != null ? JSON.stringify(parseObjective(body.objective)) : null;

    const run = runRepository.getRunById(runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.status !== "completed") {
      return NextResponse.json({ error: `Run must be completed (current: ${run.status})` }, { status: 409 });
    }
    if (!versionNoteEntryRepository.hasHilEntryForRun(runId)) {
      return NextResponse.json({ error: "Finalize the HIL review before running prompt iteration." }, { status: 409 });
    }

    // Guard against duplicate in-flight jobs for the same run.
    const existing = promptIterationRepository.getLatestJobForRun(runId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return NextResponse.json({ job: existing, alreadyRunning: true });
    }

    const jobId = uuid();
    promptIterationRepository.createJob({
      jobId,
      runId,
      detectionId: run.detection_id,
      sourcePromptVersionId: run.prompt_version_id,
      goalF1,
      maxRounds,
      precisionFloor,
      leanPreference,
      fixedGuidance,
      objective,
    });
    iterationJobQueue.create(jobId);

    const apiKey = typeof body.api_key === "string" ? body.api_key : null;
    // Fire-and-forget: do not block the request while the job runs.
    void runPromptIterationJob(jobId, apiKey);

    const job = promptIterationRepository.getJob(jobId);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/prompt-iteration");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start prompt-iteration job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    if (body.action === "discard_round") {
      const jobId = String(body.job_id || "").trim();
      const promptVersionId = String(body.prompt_version_id || "").trim();
      if (!jobId || !promptVersionId) {
        return NextResponse.json({ error: "job_id and prompt_version_id are required" }, { status: 400 });
      }
      const job = promptIterationRepository.getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status === "queued" || job.status === "running") {
        return NextResponse.json({ error: "Cannot trash a prompt while the job is still running." }, { status: 409 });
      }
      const round = job.rounds.find((r) => r.prompt_version_id === promptVersionId);
      if (!round) return NextResponse.json({ error: "Round not found for this prompt version" }, { status: 404 });

      // Delete the prompt version, its runs/predictions, and any note entries.
      promptRepository.deletePromptCascade(promptVersionId, job.detection_id);
      versionNoteEntryRepository.deleteEntriesForPromptVersion(promptVersionId);

      // Drop the round and recompute the best remaining eligible round.
      const remaining = job.rounds.filter((r) => r.prompt_version_id !== promptVersionId);
      let bestId: string | null = null;
      let bestRunId: string | null = null;
      let bestF1 = -1;
      for (const r of remaining) {
        r.is_best = false;
        if (r.parse_errors === 0 && r.f1 > bestF1) {
          bestF1 = r.f1;
          bestId = r.prompt_version_id;
          bestRunId = r.run_id;
        }
      }
      for (const r of remaining) {
        if (r.prompt_version_id === bestId) r.is_best = true;
      }

      promptIterationRepository.updateJob(jobId, {
        rounds: remaining,
        result_prompt_version_id: bestId,
        result_run_id: bestRunId,
        best_f1: bestId ? bestF1 : null,
      });
      promptIterationRepository.appendLog(jobId, "done", `Trashed prompt ${round.label}.`);
      const updated = promptIterationRepository.getJob(jobId);
      return NextResponse.json({ ok: true, job: updated });
    }

    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    const jobId = String(body.job_id || "").trim();
    if (!jobId) return NextResponse.json({ error: "job_id is required" }, { status: 400 });
    const job = promptIterationRepository.getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.status !== "queued" && job.status !== "running") {
      return NextResponse.json({ ok: true, status: job.status });
    }
    iterationJobQueue.requestCancel(jobId);
    promptIterationRepository.updateJob(jobId, { status: "canceled", finished_at: new Date().toISOString() });
    promptIterationRepository.appendLog(jobId, "done", "Cancel requested by user");
    return NextResponse.json({ ok: true, status: "canceled" });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/hil/prompt-iteration");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update prompt-iteration job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
