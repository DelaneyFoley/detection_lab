import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_PROMPT_FEEDBACK_TEMPLATE, renderPromptFeedbackTemplate } from "@/lib/adminPrompts";
import { buildImagePart } from "@/lib/gemini";
import { applyRateLimit, parseJsonWithSchema } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { GeminiAssistSchema } from "@/lib/schemas";
import { settingsRepository } from "@/lib/repositories";

// Prompt improvement assistant
export async function POST(req: NextRequest) {
  const rateLimited = applyRateLimit(req, { key: "gemini:analysis", maxRequests: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;
  const parsedBody = await parseJsonWithSchema(req, GeminiAssistSchema);
  if (!parsedBody.success) return parsedBody.response;
  const { predictions, prompt, detection, model_override, api_key } = parsedBody.data;
  const apiKey = String(api_key || process.env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
  }

  // Cluster errors
  const falsePositives = predictions.filter(
    (p: any) => p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
  );
  const falseNegatives = predictions.filter(
    (p: any) => p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED"
  );
  const truePositives = predictions.filter(
    (p: any) => p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED"
  ).slice(0, 3);
  const trueNegatives = predictions.filter(
    (p: any) => p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
  ).slice(0, 3);

  const errorTags = predictions
    .filter((p: any) => p.error_tag)
    .map((p: any) => ({ image_id: p.image_id, error_tag: p.error_tag, note: p.reviewer_note }));
  const trueParseFailures = predictions.filter((p: any) => !p.parse_ok && !isInferenceCallFailure(p));

  const falsePositiveList =
    falsePositives
      .slice(0, 5)
      .map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}`)
      .join("\n") || "None";
  const falseNegativeList =
    falseNegatives
      .slice(0, 5)
      .map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}`)
      .join("\n") || "None";
  const truePositiveList =
    truePositives.map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}"`).join("\n") || "None";
  const trueNegativeList =
    trueNegatives.map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}"`).join("\n") || "None";
  const errorTagList =
    errorTags.length > 0
      ? errorTags.map((t: any) => `- ${t.image_id}: ${t.error_tag} ${t.note ? "— " + t.note : ""}`).join("\n")
      : "None";
  const parseFailList =
    trueParseFailures
      .slice(0, 5)
      .map(
        (p: any) =>
          `- Image: ${p.image_id}, Reason: ${p.parse_error_reason || "parse failure"}, Fix: ${p.parse_fix_suggestion || "tighten output JSON contract"}`
      )
      .join("\n") || "None";

  const stored = settingsRepository.getByKey("prompt_feedback_template");
  const template = stored?.value || DEFAULT_PROMPT_FEEDBACK_TEMPLATE;
  const analysisPrompt = renderPromptFeedbackTemplate(template, {
    detectionCode: detection.detection_code,
    detectionDisplayName: detection.display_name,
    currentSystemPrompt: prompt.system_prompt,
    currentUserPromptTemplate: prompt.user_prompt_template,
    falsePositivesTotal: falsePositives.length,
    falsePositivesList: falsePositiveList,
    falseNegativesTotal: falseNegatives.length,
    falseNegativesList: falseNegativeList,
    truePositivesList: truePositiveList,
    trueNegativesList: trueNegativeList,
    errorTagsList: errorTagList,
    parseFailTotal: trueParseFailures.length,
    parseFailList,
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: model_override || "gemini-2.5-flash" });
    const multimodalParts: any[] = [analysisPrompt];
    const sampledForVision = samplePredictionsForVision(predictions);
    for (const p of sampledForVision) {
      multimodalParts.push(
        `\nImage Context: ${p.cluster} | image_id=${p.image_id} | predicted=${p.predicted_decision || "PARSE_FAIL"} | gt=${
          p.corrected_label || p.ground_truth_label || "UNSET"
        } | parse_ok=${Boolean(p.parse_ok)}`
      );
      const imageParts = await buildImagePart(String(p.image_uri || ""));
      if (imageParts.length > 0) {
        multimodalParts.push(...imageParts);
      }
    }

    const result = await model.generateContent(multimodalParts);
    const raw = result.response.text();

    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const suggestions = JSON.parse(cleaned);
    return NextResponse.json({ suggestions });
  } catch (error: unknown) {
    const context = getRequestContext(req, "/api/gemini");
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Prompt improvement analysis failed", { ...context, error: errMsg });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function samplePredictionsForVision(predictions: any[]): any[] {
  const parseFails = predictions
    .filter((p) => !p.parse_ok && !isInferenceCallFailure(p))
    .slice(0, 4)
    .map((p) => ({ ...p, cluster: "parse_fail" }));
  const fps = predictions
    .filter((p) => p.parse_ok && p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED")
    .slice(0, 3)
    .map((p) => ({ ...p, cluster: "false_positive" }));
  const fns = predictions
    .filter((p) => p.parse_ok && p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED")
    .slice(0, 3)
    .map((p) => ({ ...p, cluster: "false_negative" }));
  return [...parseFails, ...fps, ...fns].filter((p) => !!p.image_uri);
}

function isInferenceCallFailure(prediction: any): boolean {
  if (prediction?.error_tag === "INFERENCE_CALL_FAILED") return true;
  const reason = String(prediction?.parse_error_reason || "");
  const raw = String(prediction?.raw_response || "");
  return reason.startsWith("Model/API error:") || raw.startsWith("ERROR:");
}
