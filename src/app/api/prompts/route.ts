import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { promptRepository } from "@/lib/repositories";

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
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = uuid();
  const now = new Date().toISOString();

  promptRepository.createPromptVersion({
    promptVersionId: id,
    detectionId: body.detection_id,
    versionLabel: body.version_label,
    systemPrompt: body.system_prompt,
    userPromptTemplate: body.user_prompt_template,
    promptStructure: JSON.stringify(body.prompt_structure || {}),
    model: body.model || "gemini-2.5-flash",
    temperature: body.temperature ?? 0,
    topP: body.top_p ?? 1,
    maxOutputTokens: body.max_output_tokens ?? 1024,
    changeNotes: body.change_notes || "",
    createdBy: body.created_by || "user",
    createdAt: now,
  });

  return NextResponse.json({ prompt_version_id: id });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();

  if (body.golden_set_regression_result !== undefined) {
    promptRepository.setGoldenRegressionResult(
      body.prompt_version_id,
      JSON.stringify(body.golden_set_regression_result)
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const promptVersionId = body.prompt_version_id as string;
    if (!promptVersionId) {
      return NextResponse.json({ error: "prompt_version_id is required" }, { status: 400 });
    }

    const prompt = promptRepository.getPromptById(promptVersionId);
    if (!prompt) {
      return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
    }

    promptRepository.deletePromptCascade(promptVersionId, prompt.detection_id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
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
