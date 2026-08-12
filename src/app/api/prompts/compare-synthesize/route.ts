import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import {
  promptCompareJobRepository,
  promptRepository,
  runRepository,
  versionNoteEntryRepository,
} from "@/lib/repositories";
import { compareJobQueue } from "@/lib/services";
import { runPromptCompareSynthesisJob } from "@/lib/promptCompare/synthesize";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_IMAGE_CAP = 40;
const MAX_IMAGE_CAP = 80;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("job_id");
    const promptVersionId = searchParams.get("prompt_version_id");

    if (promptVersionId) {
      const prompt = promptRepository.getFullPromptById(promptVersionId);
      if (!prompt) return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
      let structure: Record<string, unknown> = {};
      try {
        structure =
          prompt.prompt_structure && typeof prompt.prompt_structure === "object"
            ? (prompt.prompt_structure as Record<string, unknown>)
            : JSON.parse(String(prompt.prompt_structure || "{}"));
      } catch {
        structure = {};
      }
      return NextResponse.json({
        prompt: {
          prompt_version_id: prompt.prompt_version_id,
          version_label: prompt.version_label,
          system_prompt: prompt.system_prompt,
          user_prompt_template: prompt.user_prompt_template,
          label_policy: structure.label_policy ?? "",
          decision_rubric: structure.decision_rubric ?? "",
          fixed_guidance: structure.fixed_guidance ?? "",
          user_prompt_addendum: structure.user_prompt_addendum ?? "",
          version_notes: prompt.version_notes,
          model: prompt.model,
        },
      });
    }

    if (jobId) {
      const job = promptCompareJobRepository.getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }

    return NextResponse.json({ error: "job_id or prompt_version_id required" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts/compare-synthesize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch compare-synthesize job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, {
      key: "prompts:compare-synthesize:start",
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const detectionId = String(body.detection_id || "").trim();
    if (!detectionId) return NextResponse.json({ error: "detection_id is required" }, { status: 400 });

    const rawIds = Array.isArray(body.prompt_version_ids) ? body.prompt_version_ids : [];
    const promptVersionIds = Array.from(
      new Set(rawIds.map((v: unknown) => String(v || "").trim()).filter(Boolean))
    ) as string[];
    if (promptVersionIds.length < 2) {
      return NextResponse.json(
        { error: "At least 2 prompt_version_ids are required" },
        { status: 400 }
      );
    }
    if (promptVersionIds.length > 6) {
      return NextResponse.json({ error: "At most 6 prompts may be merged" }, { status: 400 });
    }

    // Validate every prompt belongs to the given detection.
    for (const id of promptVersionIds) {
      const prompt = promptRepository.getFullPromptById(id);
      if (!prompt) {
        return NextResponse.json({ error: `Prompt version not found: ${id}` }, { status: 404 });
      }
      if (prompt.detection_id !== detectionId) {
        return NextResponse.json(
          { error: `Prompt ${prompt.version_label} does not belong to the requested detection` },
          { status: 400 }
        );
      }
    }

    const analyzerModel = typeof body.analyzer_model === "string" && body.analyzer_model.trim()
      ? body.analyzer_model.trim()
      : DEFAULT_MODEL;

    let analyzerTemperature = DEFAULT_TEMPERATURE;
    if (body.analyzer_temperature != null && body.analyzer_temperature !== "") {
      const t = Number(body.analyzer_temperature);
      if (!Number.isFinite(t) || t < 0 || t > 1.5) {
        return NextResponse.json(
          { error: "analyzer_temperature must be between 0 and 1.5" },
          { status: 400 }
        );
      }
      analyzerTemperature = t;
    }

    let imageCap = DEFAULT_IMAGE_CAP;
    if (body.image_cap != null && body.image_cap !== "") {
      const n = Math.floor(Number(body.image_cap));
      if (!Number.isFinite(n) || n < 4 || n > MAX_IMAGE_CAP) {
        return NextResponse.json(
          { error: `image_cap must be an integer between 4 and ${MAX_IMAGE_CAP}` },
          { status: 400 }
        );
      }
      imageCap = n;
    }

    const includeAgreementSamples = body.include_agreement_samples !== false;
    const evaluate = body.evaluate !== false;

    const jobId = uuid();
    promptCompareJobRepository.createJob({
      jobId,
      detectionId,
      sourcePromptVersionIds: promptVersionIds,
      analyzerModel,
      analyzerTemperature,
      imageCap,
      includeAgreementSamples,
      evaluate,
    });
    compareJobQueue.create(jobId);

    const apiKey = typeof body.api_key === "string" ? body.api_key : null;
    void runPromptCompareSynthesisJob(jobId, apiKey);

    const job = promptCompareJobRepository.getJob(jobId);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts/compare-synthesize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start compare-synthesize job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    if (body.action === "cancel") {
      const jobId = String(body.job_id || "").trim();
      if (!jobId) return NextResponse.json({ error: "job_id is required" }, { status: 400 });
      const job = promptCompareJobRepository.getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status !== "queued" && job.status !== "running") {
        return NextResponse.json({ ok: true, status: job.status });
      }
      compareJobQueue.requestCancel(jobId);
      promptCompareJobRepository.updateJob(jobId, {
        status: "canceled",
        finished_at: new Date().toISOString(),
      });
      promptCompareJobRepository.appendLog(jobId, "done", "Cancel requested by user");
      return NextResponse.json({ ok: true, status: "canceled" });
    }

    if (body.action === "trash") {
      const jobId = String(body.job_id || "").trim();
      const promptVersionId = String(body.prompt_version_id || "").trim();
      if (!jobId || !promptVersionId) {
        return NextResponse.json(
          { error: "job_id and prompt_version_id are required" },
          { status: 400 }
        );
      }
      const job = promptCompareJobRepository.getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status === "queued" || job.status === "running") {
        return NextResponse.json(
          { error: "Cannot trash while the job is still running." },
          { status: 409 }
        );
      }
      if (job.result_prompt_version_id !== promptVersionId) {
        return NextResponse.json(
          { error: "prompt_version_id does not match this job's synthesized prompt" },
          { status: 400 }
        );
      }
      promptRepository.deletePromptCascade(promptVersionId, job.detection_id);
      versionNoteEntryRepository.deleteEntriesForPromptVersion(promptVersionId);
      promptCompareJobRepository.updateJob(jobId, {
        result_prompt_version_id: null,
        result_run_id: null,
        result_dataset_id: null,
      });
      promptCompareJobRepository.appendLog(jobId, "done", "Synthesized prompt trashed by user");
      const updated = promptCompareJobRepository.getJob(jobId);
      return NextResponse.json({ ok: true, job: updated });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts/compare-synthesize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update compare-synthesize job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// Delegate DELETE for symmetry with other job endpoints — mirrors cancel + trash via PUT.
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = String(searchParams.get("job_id") || "").trim();
    if (!jobId) return NextResponse.json({ error: "job_id is required" }, { status: 400 });
    const job = promptCompareJobRepository.getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.status === "queued" || job.status === "running") {
      compareJobQueue.requestCancel(jobId);
    }
    if (job.result_prompt_version_id) {
      promptRepository.deletePromptCascade(job.result_prompt_version_id, job.detection_id);
      versionNoteEntryRepository.deleteEntriesForPromptVersion(job.result_prompt_version_id);
    }
    // The job row itself stays for history; caller can render "deleted" state via updates.
    promptCompareJobRepository.updateJob(jobId, {
      result_prompt_version_id: null,
      result_run_id: null,
      result_dataset_id: null,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts/compare-synthesize");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete compare-synthesize job", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
