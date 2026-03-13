import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_PROMPT_ASSIST_TEMPLATE, renderPromptAssistTemplate } from "@/lib/adminPrompts";
import { normalizeDetectionCategory } from "@/lib/detectionPrompts";
import { settingsRepository } from "@/lib/repositories";

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toSingleSentence(value: string): string {
  const compact = normalizeSpaces(value);
  if (!compact) return "";
  const firstSentence = compact.match(/^.*?[.!?](?=\s|$)/)?.[0] || compact;
  return firstSentence.replace(/[.!?]*$/, "").trim() + ".";
}

function cleanRubricItem(value: string): string {
  return normalizeSpaces(value)
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "");
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
    const requestedCategory = normalizeDetectionCategory(body?.detection_category);

    if (!apiKey) {
      return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
    }
    if (!requestText || !requestText.trim()) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }

    const stored = settingsRepository.getByKey("prompt_assist_template");
    const template = stored?.value || DEFAULT_PROMPT_ASSIST_TEMPLATE;
    const prompt = [
      renderPromptAssistTemplate(template, requestText.trim(), requestedCategory),
      "",
      "Runtime enforcement:",
      `- The selected detection category is ${requestedCategory}. You must return that exact value in detection_category.`,
      "- Do not include system_prompt.",
      "- Do not include user_prompt_template.",
      "- Include image_attributes as the suggested evaluation/image-condition tags to track for this detection.",
      "- Suggested image_attributes should focus on conditions most likely to create confusion, blind spots, or performance variation.",
      '- Return only these keys: display_name, detection_code, description, detection_category, label_policy_detected, label_policy_not_detected, decision_rubric, user_prompt_addendum, image_attributes, version_label.',
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
    const decisionRubric = Array.isArray(parsed.decision_rubric) ? parsed.decision_rubric : [];
    const imageAttributes = Array.isArray(parsed.image_attributes) ? parsed.image_attributes : [];
    const detectionCode = String(parsed.detection_code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");

    return NextResponse.json({
      display_name: normalizeSpaces(String(parsed.display_name || "")),
      detection_code: detectionCode,
      description: normalizeSpaces(String(parsed.description || "")),
      detection_category: requestedCategory,
      label_policy_detected: toSingleSentence(String(parsed.label_policy_detected || "")),
      label_policy_not_detected: toSingleSentence(String(parsed.label_policy_not_detected || "")),
      decision_rubric: decisionRubric
        .map((r: unknown) => cleanRubricItem(String(r || "")))
        .filter(Boolean)
        .slice(0, 6),
      user_prompt_addendum: normalizeSpaces(String(parsed.user_prompt_addendum || "")),
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
