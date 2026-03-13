import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { buildUserPromptTemplate, CATEGORY_PROMPT_SETTING_KEYS, DEFAULT_CATEGORY_PROMPT_TEMPLATES, normalizeDetectionCategory } from "@/lib/detectionPrompts";
import { applyRateLimit, parseJsonWithSchema } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { detectionRepository, promptRepository, settingsRepository } from "@/lib/repositories";
import { PromptCreateSchema, PromptDeleteSchema, PromptUpdateSchema } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");

    let rows;
    if (detectionId) {
      rows = promptRepository.listPromptVersions(detectionId);
    } else {
      rows = promptRepository.listPromptVersions();
    }

    const prompts = rows.map((r: any) => ({
      ...r,
      prompt_structure: safeParseJson(r.prompt_structure, {}),
      golden_set_regression_result: safeParseJson(r.golden_set_regression_result, null),
    }));

    return NextResponse.json(prompts);
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to fetch prompts", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "prompts:write", maxRequests: 40, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, PromptCreateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;
    const id = uuid();
    const now = new Date().toISOString();
    const detection = detectionRepository.getDetectionById(body.detection_id);
    if (!detection) {
      return NextResponse.json({ error: "Detection not found" }, { status: 404 });
    }

    const category = normalizeDetectionCategory(detection.detection_category);
    const keys = CATEGORY_PROMPT_SETTING_KEYS[category];
    const rows = settingsRepository.getByKeys([keys.system, keys.user]);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const defaults = DEFAULT_CATEGORY_PROMPT_TEMPLATES[category];
    const systemPrompt = byKey.get(keys.system) || defaults.system_prompt;
    const userPromptTemplate = buildUserPromptTemplate(
      byKey.get(keys.user) || defaults.user_prompt_template,
      detection.user_prompt_addendum
    );
    const promptStructure = {
      ...(body.prompt_structure || {}),
      user_prompt_addendum: String(detection.user_prompt_addendum || ""),
    };

    promptRepository.createPromptVersion({
      promptVersionId: id,
      detectionId: body.detection_id,
      versionLabel: body.version_label,
      systemPrompt,
      userPromptTemplate,
      promptStructure: JSON.stringify(promptStructure),
      model: body.model || "gemini-2.5-flash",
      temperature: body.temperature ?? 0,
      topP: body.top_p ?? 1,
      maxOutputTokens: body.max_output_tokens ?? 1024,
      changeNotes: body.change_notes || "",
      createdBy: body.created_by || "user",
      createdAt: now,
    });

    return NextResponse.json({ prompt_version_id: id });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to create prompt", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "prompts:update", maxRequests: 40, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, PromptUpdateSchema);
    if (!parsedBody.success) return parsedBody.response;
    const body = parsedBody.data;

    if (body.golden_set_regression_result !== undefined) {
      promptRepository.setGoldenRegressionResult(
        body.prompt_version_id,
        JSON.stringify(body.golden_set_regression_result)
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to update prompt", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "prompts:delete", maxRequests: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;
    const parsedBody = await parseJsonWithSchema(req, PromptDeleteSchema);
    if (!parsedBody.success) return parsedBody.response;
    const promptVersionId = parsedBody.data.prompt_version_id;

    const prompt = promptRepository.getPromptById(promptVersionId);
    if (!prompt) {
      return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
    }

    promptRepository.deletePromptCascade(promptVersionId, prompt.detection_id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/prompts");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to delete prompt", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
