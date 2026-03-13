import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_HAZARD_IDENTIFICATION_SYSTEM_PROMPT,
  DEFAULT_HAZARD_IDENTIFICATION_USER_PROMPT,
  DEFAULT_INCORRECT_CAPTURE_SYSTEM_PROMPT,
  DEFAULT_INCORRECT_CAPTURE_USER_PROMPT,
  DEFAULT_PROMPT_ASSIST_TEMPLATE,
  DEFAULT_PROMPT_FEEDBACK_TEMPLATE,
} from "@/lib/adminPrompts";
import { settingsRepository } from "@/lib/repositories";

const KEY_PROMPT_ASSIST = "prompt_assist_template";
const KEY_PROMPT_FEEDBACK = "prompt_feedback_template";
const KEY_INCORRECT_CAPTURE_SYSTEM = "incorrect_capture_system_prompt";
const KEY_INCORRECT_CAPTURE_USER = "incorrect_capture_user_prompt";
const KEY_HAZARD_IDENTIFICATION_SYSTEM = "hazard_identification_system_prompt";
const KEY_HAZARD_IDENTIFICATION_USER = "hazard_identification_user_prompt";

export async function GET() {
  try {
    const rows = settingsRepository.getByKeys([
      KEY_PROMPT_ASSIST,
      KEY_PROMPT_FEEDBACK,
      KEY_INCORRECT_CAPTURE_SYSTEM,
      KEY_INCORRECT_CAPTURE_USER,
      KEY_HAZARD_IDENTIFICATION_SYSTEM,
      KEY_HAZARD_IDENTIFICATION_USER,
    ]);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return NextResponse.json({
      prompt_assist_template: byKey.get(KEY_PROMPT_ASSIST) || DEFAULT_PROMPT_ASSIST_TEMPLATE,
      prompt_feedback_template: byKey.get(KEY_PROMPT_FEEDBACK) || DEFAULT_PROMPT_FEEDBACK_TEMPLATE,
      incorrect_capture_system_prompt:
        byKey.get(KEY_INCORRECT_CAPTURE_SYSTEM) || DEFAULT_INCORRECT_CAPTURE_SYSTEM_PROMPT,
      incorrect_capture_user_prompt:
        byKey.get(KEY_INCORRECT_CAPTURE_USER) || DEFAULT_INCORRECT_CAPTURE_USER_PROMPT,
      hazard_identification_system_prompt:
        byKey.get(KEY_HAZARD_IDENTIFICATION_SYSTEM) || DEFAULT_HAZARD_IDENTIFICATION_SYSTEM_PROMPT,
      hazard_identification_user_prompt:
        byKey.get(KEY_HAZARD_IDENTIFICATION_USER) || DEFAULT_HAZARD_IDENTIFICATION_USER_PROMPT,
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
    const incorrectCaptureSystem = String(body?.incorrect_capture_system_prompt ?? "").trim();
    const incorrectCaptureUser = String(body?.incorrect_capture_user_prompt ?? "").trim();
    const hazardIdentificationSystem = String(body?.hazard_identification_system_prompt ?? "").trim();
    const hazardIdentificationUser = String(body?.hazard_identification_user_prompt ?? "").trim();
    if (
      !promptAssist ||
      !promptFeedback ||
      !incorrectCaptureSystem ||
      !incorrectCaptureUser ||
      !hazardIdentificationSystem ||
      !hazardIdentificationUser
    ) {
      return NextResponse.json({ error: "All prompt templates are required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    settingsRepository.upsertMany([
      { key: KEY_PROMPT_ASSIST, value: promptAssist, updatedAt: now },
      { key: KEY_PROMPT_FEEDBACK, value: promptFeedback, updatedAt: now },
      { key: KEY_INCORRECT_CAPTURE_SYSTEM, value: incorrectCaptureSystem, updatedAt: now },
      { key: KEY_INCORRECT_CAPTURE_USER, value: incorrectCaptureUser, updatedAt: now },
      { key: KEY_HAZARD_IDENTIFICATION_SYSTEM, value: hazardIdentificationSystem, updatedAt: now },
      { key: KEY_HAZARD_IDENTIFICATION_USER, value: hazardIdentificationUser, updatedAt: now },
    ]);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
