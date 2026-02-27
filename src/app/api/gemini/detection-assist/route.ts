import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "@/lib/db";
import {
  DEFAULT_PROMPT_ASSIST_TEMPLATE,
  REQUIRED_USER_PROMPT_JSON_BLOCK,
  renderPromptAssistTemplate,
} from "@/lib/adminPrompts";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = body?.api_key as string | undefined;
    const requestText = body?.request as string | undefined;
    const modelOverride = body?.model_override as string | undefined;

    if (!apiKey) {
      return NextResponse.json({ error: "API key required" }, { status: 400 });
    }
    if (!requestText || !requestText.trim()) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }

    const db = getDb();
    const stored = db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get("prompt_assist_template") as { value?: string } | undefined;
    const template = stored?.value || DEFAULT_PROMPT_ASSIST_TEMPLATE;
    const prompt = renderPromptAssistTemplate(template, requestText.trim());

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelOverride || "gemini-2.5-pro" });
    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);
    const decisionRubric = Array.isArray(parsed.decision_rubric) ? parsed.decision_rubric : [];
    const detectionCode = String(parsed.detection_code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");

    const generatedUserPromptTemplate = String(parsed.user_prompt_template || "").trim();
    const userPromptTemplate = generatedUserPromptTemplate.includes(REQUIRED_USER_PROMPT_JSON_BLOCK)
      ? generatedUserPromptTemplate
      : `${generatedUserPromptTemplate ? `${generatedUserPromptTemplate}\n\n` : ""}${REQUIRED_USER_PROMPT_JSON_BLOCK}`;

    return NextResponse.json({
      display_name: String(parsed.display_name || ""),
      detection_code: detectionCode,
      description: String(parsed.description || ""),
      system_prompt: String(parsed.system_prompt || ""),
      user_prompt_template: userPromptTemplate,
      label_policy_detected: String(parsed.label_policy_detected || ""),
      label_policy_not_detected: String(parsed.label_policy_not_detected || ""),
      decision_rubric: decisionRubric.map((r: unknown) => String(r || "")).filter(Boolean),
      version_label: String(parsed.version_label || "Detection baseline"),
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
