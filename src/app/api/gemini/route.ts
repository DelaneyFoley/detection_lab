import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "@/lib/db";
import { DEFAULT_PROMPT_FEEDBACK_TEMPLATE, renderPromptFeedbackTemplate } from "@/lib/adminPrompts";
import fs from "fs";
import path from "path";

// Prompt improvement assistant
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { predictions, prompt, detection, model_override } = body;
  const apiKey = String(body.api_key || process.env.GEMINI_API_KEY || "").trim();

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
  const parseFailures = predictions.filter((p: any) => !p.parse_ok);

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
    parseFailures
      .slice(0, 5)
      .map(
        (p: any) =>
          `- Image: ${p.image_id}, Reason: ${p.parse_error_reason || "parse failure"}, Fix: ${p.parse_fix_suggestion || "tighten output JSON contract"}`
      )
      .join("\n") || "None";

  const db = getDb();
  const stored = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("prompt_feedback_template") as { value?: string } | undefined;
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
    parseFailTotal: parseFailures.length,
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
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function samplePredictionsForVision(predictions: any[]): any[] {
  const parseFails = predictions.filter((p) => !p.parse_ok).slice(0, 4).map((p) => ({ ...p, cluster: "parse_fail" }));
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

async function buildImagePart(imageUri: string) {
  if (imageUri.startsWith("data:")) {
    const match = imageUri.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return [{ inlineData: { mimeType: match[1], data: match[2] } }];
    }
  }

  if (imageUri.startsWith("/") || imageUri.startsWith("./")) {
    const resolvedPath = resolveLocalImagePath(imageUri);
    if (!fs.existsSync(resolvedPath)) return [];
    const data = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
    };
    return [{ inlineData: { mimeType: mimeMap[ext] || "image/jpeg", data: data.toString("base64") } }];
  }

  if (imageUri.startsWith("http")) {
    const response = await fetch(imageUri);
    if (!response.ok) return [];
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return [{ inlineData: { mimeType: contentType, data: Buffer.from(buffer).toString("base64") } }];
  }

  return [];
}

function resolveLocalImagePath(imageUri: string): string {
  if (path.isAbsolute(imageUri)) {
    if (fs.existsSync(imageUri)) return imageUri;
    const publicPath = path.join(process.cwd(), "public", imageUri.replace(/^\//, ""));
    if (fs.existsSync(publicPath)) return publicPath;
  }
  return path.join(process.cwd(), imageUri);
}
