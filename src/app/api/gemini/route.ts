import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_PROMPT_FEEDBACK_TEMPLATE, DEFAULT_FEEDBACK_IMAGE_LIMITS, FEEDBACK_IMAGE_LIMIT_KEYS, renderPromptFeedbackTemplate } from "@/lib/adminPrompts";
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

  // Load image limits from settings
  const limitRows = settingsRepository.getByKeys(FEEDBACK_IMAGE_LIMIT_KEYS);
  const limitMap = new Map(limitRows.map((r) => [r.key, r.value]));
  const imageLimits = {
    fp: parseInt(limitMap.get("feedback_fp_image_limit") || "", 10) || DEFAULT_FEEDBACK_IMAGE_LIMITS.feedback_fp_image_limit,
    fn: parseInt(limitMap.get("feedback_fn_image_limit") || "", 10) || DEFAULT_FEEDBACK_IMAGE_LIMITS.feedback_fn_image_limit,
    tp: limitMap.has("feedback_tp_image_limit") ? parseInt(limitMap.get("feedback_tp_image_limit")!, 10) : DEFAULT_FEEDBACK_IMAGE_LIMITS.feedback_tp_image_limit,
    tn: limitMap.has("feedback_tn_image_limit") ? parseInt(limitMap.get("feedback_tn_image_limit")!, 10) : DEFAULT_FEEDBACK_IMAGE_LIMITS.feedback_tn_image_limit,
    parseFail: parseInt(limitMap.get("feedback_parse_fail_image_limit") || "", 10) || DEFAULT_FEEDBACK_IMAGE_LIMITS.feedback_parse_fail_image_limit,
  };

  // Cluster predictions
  const falsePositives = predictions.filter(
    (p: any) => p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
  );
  const falseNegatives = predictions.filter(
    (p: any) => p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED"
  );
  const truePositives = predictions.filter(
    (p: any) => p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED"
  );
  const trueNegatives = predictions.filter(
    (p: any) => p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED"
  );

  const errorTags = predictions
    .filter((p: any) => p.error_tag)
    .map((p: any) => ({ image_id: p.image_id, error_tag: p.error_tag, note: p.reviewer_note }));
  const trueParseFailures = predictions.filter((p: any) => !p.parse_ok && !isInferenceCallFailure(p));

  // Text lists — send ALL FP/FN (no cap), no text-only for TP/TN
  const falsePositiveList =
    falsePositives
      .map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}${p.error_tag ? `, Tag: ${p.error_tag}` : ""}${p.reviewer_note ? `, Note: ${p.reviewer_note}` : ""}`)
      .join("\n") || "None";
  const falseNegativeList =
    falseNegatives
      .map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}${p.error_tag ? `, Tag: ${p.error_tag}` : ""}${p.reviewer_note ? `, Note: ${p.reviewer_note}` : ""}`)
      .join("\n") || "None";
  const truePositiveList = "See attached images below (if any).";
  const trueNegativeList = "See attached images below (if any).";
  const errorTagList =
    errorTags.length > 0
      ? errorTags.map((t: any) => `- ${t.image_id}: ${t.error_tag} ${t.note ? "— " + t.note : ""}`).join("\n")
      : "None";
  const parseFailList =
    trueParseFailures
      .map(
        (p: any) =>
          `- Image: ${p.image_id}, Reason: ${p.parse_error_reason || "parse failure"}, Fix: ${p.parse_fix_suggestion || "tighten output JSON contract"}`
      )
      .join("\n") || "None";

  const stored = settingsRepository.getByKey("prompt_feedback_template");
  const template = stored?.value || DEFAULT_PROMPT_FEEDBACK_TEMPLATE;
  const promptStructure = (prompt.prompt_structure || {}) as Record<string, unknown>;
  const currentDecisionPolicy =
    typeof promptStructure.label_policy === "string" ? promptStructure.label_policy : "";
  const currentDecisionRubric =
    typeof promptStructure.decision_rubric === "string"
      ? promptStructure.decision_rubric
      : Array.isArray(detection.decision_rubric)
      ? detection.decision_rubric.join("\n")
      : "";
  const currentUserPromptAddendum =
    typeof promptStructure.user_prompt_addendum === "string"
      ? promptStructure.user_prompt_addendum
      : typeof detection.user_prompt_addendum === "string"
      ? detection.user_prompt_addendum
      : "";
  const analysisPrompt = renderPromptFeedbackTemplate(template, {
    detectionCode: detection.detection_code,
    detectionDisplayName: detection.display_name,
    detectionCategory: detection.detection_category,
    currentDecisionPolicy,
    currentDecisionRubric,
    currentUserPromptAddendum,
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
    const sampledForVision = samplePredictionsForVision(predictions, imageLimits);
    for (const p of sampledForVision) {
      multimodalParts.push(
        `\nImage Context: ${p.cluster} | image_id=${p.image_id} | predicted=${p.predicted_decision || "PARSE_FAIL"} | gt=${
          p.corrected_label || p.ground_truth_label || "UNSET"
        } | evidence=${p.evidence || "none"} | parse_ok=${Boolean(p.parse_ok)}${p.error_tag ? ` | error_tag=${p.error_tag}` : ""}${p.reviewer_note ? ` | reviewer_note=${p.reviewer_note}` : ""}`
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

function prioritizeByReviewerNote(items: any[]): any[] {
  const withNotes = items.filter((p) => p.reviewer_note || p.error_tag);
  const withoutNotes = items.filter((p) => !p.reviewer_note && !p.error_tag);
  return [...withNotes, ...withoutNotes];
}

function samplePredictionsForVision(
  predictions: any[],
  limits: { fp: number; fn: number; tp: number; tn: number; parseFail: number }
): any[] {
  const parseFails = predictions
    .filter((p) => !p.parse_ok && !isInferenceCallFailure(p))
    .slice(0, limits.parseFail)
    .map((p) => ({ ...p, cluster: "parse_fail" }));

  const fpCandidates = prioritizeByReviewerNote(
    predictions.filter((p) => p.parse_ok && p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED")
  );
  const fps = fpCandidates
    .slice(0, limits.fp)
    .map((p) => ({ ...p, cluster: "false_positive" }));

  const fnCandidates = prioritizeByReviewerNote(
    predictions.filter((p) => p.parse_ok && p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED")
  );
  const fns = fnCandidates
    .slice(0, limits.fn)
    .map((p) => ({ ...p, cluster: "false_negative" }));

  const tpCandidates = prioritizeByReviewerNote(
    predictions.filter((p) => p.parse_ok && p.predicted_decision === "DETECTED" && (p.corrected_label || p.ground_truth_label) === "DETECTED")
  );
  const tps = tpCandidates
    .slice(0, limits.tp)
    .map((p) => ({ ...p, cluster: "true_positive" }));

  const tnCandidates = prioritizeByReviewerNote(
    predictions.filter((p) => p.parse_ok && p.predicted_decision === "NOT_DETECTED" && (p.corrected_label || p.ground_truth_label) === "NOT_DETECTED")
  );
  const tns = tnCandidates
    .slice(0, limits.tn)
    .map((p) => ({ ...p, cluster: "true_negative" }));

  return [...parseFails, ...fps, ...fns, ...tps, ...tns].filter((p) => !!p.image_uri);
}

function isInferenceCallFailure(prediction: any): boolean {
  if (prediction?.error_tag === "INFERENCE_CALL_FAILED") return true;
  const reason = String(prediction?.parse_error_reason || "");
  const raw = String(prediction?.raw_response || "");
  return reason.startsWith("Model/API error:") || raw.startsWith("ERROR:");
}
