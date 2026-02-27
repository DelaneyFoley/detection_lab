import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DEFAULT_PROMPT_ASSIST_TEMPLATE, DEFAULT_PROMPT_FEEDBACK_TEMPLATE } from "@/lib/adminPrompts";

const KEY_PROMPT_ASSIST = "prompt_assist_template";
const KEY_PROMPT_FEEDBACK = "prompt_feedback_template";

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT key, value FROM app_settings WHERE key IN (?, ?)")
      .all(KEY_PROMPT_ASSIST, KEY_PROMPT_FEEDBACK) as Array<{ key: string; value: string }>;
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

    const db = getDb();
    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      upsert.run(KEY_PROMPT_ASSIST, promptAssist, now);
      upsert.run(KEY_PROMPT_FEEDBACK, promptFeedback, now);
    });
    tx();

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
