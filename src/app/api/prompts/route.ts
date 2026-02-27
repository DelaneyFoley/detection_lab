import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function GET(req: NextRequest) {
  try {
    const detectionId = req.nextUrl.searchParams.get("detection_id");
    const db = getDb();

    let rows;
    if (detectionId) {
      rows = db
        .prepare("SELECT * FROM prompt_versions WHERE detection_id = ? ORDER BY created_at DESC")
        .all(detectionId);
    } else {
      rows = db.prepare("SELECT * FROM prompt_versions ORDER BY created_at DESC").all();
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
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO prompt_versions (prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template, prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    body.detection_id,
    body.version_label,
    body.system_prompt,
    body.user_prompt_template,
    JSON.stringify(body.prompt_structure || {}),
    body.model || "gemini-2.5-flash",
    body.temperature ?? 0,
    body.top_p ?? 1,
    body.max_output_tokens ?? 1024,
    body.change_notes || "",
    body.created_by || "user",
    now
  );

  return NextResponse.json({ prompt_version_id: id });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  if (body.golden_set_regression_result !== undefined) {
    db.prepare(
      "UPDATE prompt_versions SET golden_set_regression_result = ? WHERE prompt_version_id = ?"
    ).run(
      JSON.stringify(body.golden_set_regression_result),
      body.prompt_version_id
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

    const db = getDb();
    const prompt = db
      .prepare("SELECT prompt_version_id, detection_id FROM prompt_versions WHERE prompt_version_id = ?")
      .get(promptVersionId) as any;
    if (!prompt) {
      return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
    }

    const tx = db.transaction((targetPromptId: string, detectionId: string) => {
      const runIds = db
        .prepare("SELECT run_id FROM runs WHERE prompt_version_id = ?")
        .all(targetPromptId) as Array<{ run_id: string }>;
      for (const r of runIds) {
        db.prepare("DELETE FROM predictions WHERE run_id = ?").run(r.run_id);
      }
      db.prepare("DELETE FROM runs WHERE prompt_version_id = ?").run(targetPromptId);
      db.prepare("DELETE FROM prompt_versions WHERE prompt_version_id = ?").run(targetPromptId);
      db.prepare(`
        UPDATE detections
        SET approved_prompt_version = CASE WHEN approved_prompt_version = ? THEN NULL ELSE approved_prompt_version END
        WHERE detection_id = ?
      `).run(targetPromptId, detectionId);
    });

    tx(promptVersionId, prompt.detection_id);
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
