import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_PROMPT_ASSIST_TEMPLATE, DEFAULT_PROMPT_FEEDBACK_TEMPLATE } from "@/lib/adminPrompts";
import { settingsRepository } from "@/lib/repositories";

const KEY_PROMPT_ASSIST = "prompt_assist_template";
const KEY_PROMPT_FEEDBACK = "prompt_feedback_template";

export async function GET() {
  try {
    const rows = settingsRepository.getByKeys([KEY_PROMPT_ASSIST, KEY_PROMPT_FEEDBACK]);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return NextResponse.json({
      prompt_assist_template: byKey.get(KEY_PROMPT_ASSIST) || DEFAULT_PROMPT_ASSIST_TEMPLATE,
      prompt_feedback_template: byKey.get(KEY_PROMPT_FEEDBACK) || DEFAULT_PROMPT_FEEDBACK_TEMPLATE,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const promptAssist = String(body?.prompt_assist_template ?? "").trim();
    const promptFeedback = String(body?.prompt_feedback_template ?? "").trim();
    if (!promptAssist || !promptFeedback) {
      return NextResponse.json({ error: "Both prompt templates are required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    settingsRepository.upsertMany([
      { key: KEY_PROMPT_ASSIST, value: promptAssist, updatedAt: now },
      { key: KEY_PROMPT_FEEDBACK, value: promptFeedback, updatedAt: now },
    ]);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
