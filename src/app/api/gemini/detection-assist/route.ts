import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_PROMPT_ASSIST_TEMPLATE, renderPromptAssistTemplate } from "@/lib/adminPrompts";
import { settingsRepository } from "@/lib/repositories";

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanImageAttribute(value: string): string {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]/g, "")
    .replace(/[\s/-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = String(body?.api_key || process.env.GEMINI_API_KEY || "").trim();
    const requestText = body?.request as string | undefined;
    const modelOverride = body?.model_override as string | undefined;

    if (!apiKey) {
      return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
    }
    if (!requestText || !requestText.trim()) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }

    const stored = settingsRepository.getByKey("prompt_assist_template");
    const template = stored?.value || DEFAULT_PROMPT_ASSIST_TEMPLATE;
    const prompt = [
      renderPromptAssistTemplate(template, requestText.trim()),
      "",
      "Runtime enforcement:",
      "- Do not include system_prompt.",
      "- Do not include user_prompt_template.",
      "- detection_prompt is the single detection block that will run inside a production context's shared instructions. It describes what the model should look for. Do NOT restate the JSON output schema or a DETECTED/NOT_DETECTED policy — those are fixed by the system.",
      "- Include image_attributes as the suggested evaluation/image-condition tags to track for this detection.",
      '- Return only these keys: display_name, detection_code, description, detection_prompt, image_attributes, version_label.',
    ].join("\n");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelOverride || "gemini-2.5-pro" });
    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);
    const imageAttributes = Array.isArray(parsed.image_attributes) ? parsed.image_attributes : [];
    const detectionCode = String(parsed.detection_code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");
    const detectionPrompt = String(parsed.detection_prompt || parsed.user_prompt_addendum || "").trim();

    return NextResponse.json({
      display_name: normalizeSpaces(String(parsed.display_name || "")),
      detection_code: detectionCode,
      description: normalizeSpaces(String(parsed.description || "")),
      detection_prompt: detectionPrompt,
      image_attributes: imageAttributes
        .map((attribute: unknown) => cleanImageAttribute(String(attribute || "")))
        .filter(Boolean)
        .filter((value: string, index: number, list: string[]) => list.indexOf(value) === index)
        .slice(0, 8),
      version_label: normalizeSpaces(String(parsed.version_label || "Detection baseline")),
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
