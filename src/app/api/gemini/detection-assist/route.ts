import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const REQUIRED_USER_PROMPT_JSON_BLOCK = `Return ONLY this JSON:
{
  "detection_code": "{{DETECTION_CODE}}",
  "decision": "DETECTED" or "NOT_DETECTED",
  "confidence": <float 0-1>,
  "evidence": "<short phrase describing visual basis>"
}`;

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

    const prompt = `You are a senior property insurance underwriting and computer-vision policy expert.

Create a production-ready binary detection specification for home-inspection imagery.
The detection should follow strict underwriting standards for safety, hazard, and loss prevention.

User request:
${requestText}

Return ONLY valid JSON with this exact shape:
{
  "display_name": "human readable title",
  "detection_code": "UPPER_SNAKE_CASE_CODE",
  "description": "one concise paragraph",
  "system_prompt": "system prompt text",
  "user_prompt_template": "user prompt template text containing {{DETECTION_CODE}}",
  "label_policy_detected": "criteria for DETECTED",
  "label_policy_not_detected": "criteria for NOT_DETECTED",
  "decision_rubric": ["criterion 1", "criterion 2", "criterion 3", "criterion 4"],
  "version_label": "Detection baseline"
}

Rules:
- detection_code must be uppercase letters, numbers, underscore only.
- decision_rubric must contain 4-7 actionable checks.
- label policies must be strict and auditable.
- user_prompt_template must require JSON-only response with:
  detection_code, decision, confidence (0-1), evidence.
- user_prompt_template must include exactly this block:
${REQUIRED_USER_PROMPT_JSON_BLOCK}
- Use clear, concise, professional language.
- Do not add markdown, commentary, or extra keys.`;

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
