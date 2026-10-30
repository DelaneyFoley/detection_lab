import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_PROMPT_ASSIST_TEMPLATE,
  DEFAULT_PROMPT_FEEDBACK_TEMPLATE,
  DEFAULT_FEEDBACK_IMAGE_LIMITS,
  FEEDBACK_IMAGE_LIMIT_KEYS,
} from "@/lib/adminPrompts";
import { settingsRepository } from "@/lib/repositories";

const KEY_PROMPT_ASSIST = "prompt_assist_template";
const KEY_PROMPT_FEEDBACK = "prompt_feedback_template";

export async function GET() {
  try {
    const rows = settingsRepository.getByKeys([
      KEY_PROMPT_ASSIST,
      KEY_PROMPT_FEEDBACK,
      ...FEEDBACK_IMAGE_LIMIT_KEYS,
    ]);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const imageLimits: Record<string, number> = {};
    for (const key of FEEDBACK_IMAGE_LIMIT_KEYS) {
      const stored = byKey.get(key);
      imageLimits[key] = stored != null ? parseInt(stored, 10) : DEFAULT_FEEDBACK_IMAGE_LIMITS[key];
    }

    return NextResponse.json({
      prompt_assist_template: byKey.get(KEY_PROMPT_ASSIST) || DEFAULT_PROMPT_ASSIST_TEMPLATE,
      prompt_feedback_template: byKey.get(KEY_PROMPT_FEEDBACK) || DEFAULT_PROMPT_FEEDBACK_TEMPLATE,
      ...imageLimits,
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
      return NextResponse.json({ error: "All prompt templates are required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const entries = [
      { key: KEY_PROMPT_ASSIST, value: promptAssist, updatedAt: now },
      { key: KEY_PROMPT_FEEDBACK, value: promptFeedback, updatedAt: now },
    ];

    for (const key of FEEDBACK_IMAGE_LIMIT_KEYS) {
      const raw = body?.[key];
      if (raw != null) {
        const val = Math.max(0, Math.min(20, Math.floor(Number(raw))));
        entries.push({ key, value: String(val), updatedAt: now });
      }
    }

    settingsRepository.upsertMany(entries);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
