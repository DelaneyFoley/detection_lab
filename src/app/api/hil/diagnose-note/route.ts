import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { applyRateLimit } from "@/lib/api";
import { getRequestContext, logger } from "@/lib/logger";
import { reviewRepository, detectionRepository } from "@/lib/repositories";
import { fetchImageAsBase64 } from "@/lib/inference/shared";

const DEFAULT_NOTE_MODEL = process.env.GEMINI_NOTE_MODEL || "gemini-2.5-pro";

/**
 * Auto-generate a diagnostic reviewer note for a single prediction. Feeds the
 * image, the AI's decision + evidence, the confirmed ground-truth label, the
 * detection definition, and any existing note to a vision model, and asks it to
 * explain — specifically and grounded in the image — why the AI decision does
 * (or does not) match the ground truth.
 */
export async function POST(req: NextRequest) {
  try {
    const rateLimited = applyRateLimit(req, { key: "hil:diagnose-note", maxRequests: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const body = await req.json().catch(() => null);
    const predictionId = body?.prediction_id ? String(body.prediction_id) : "";
    if (!predictionId) {
      return NextResponse.json({ error: "prediction_id is required" }, { status: 400 });
    }

    const apiKey = String(body?.api_key || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Gemini API key configured. Add GEMINI_API_KEY or pass api_key." },
        { status: 400 }
      );
    }

    const pred = reviewRepository.getPredictionById(predictionId);
    if (!pred) {
      return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
    }

    const groundTruth = (pred.corrected_label || pred.ground_truth_label || null) as string | null;
    if (!groundTruth) {
      return NextResponse.json(
        { error: "This image has no confirmed ground-truth label yet. Set the ground truth first." },
        { status: 400 }
      );
    }

    const run = reviewRepository.getRunById(pred.run_id);
    const detection = run ? detectionRepository.getDetectionById(run.detection_id) : null;

    let image: { base64: string; mimeType: string };
    try {
      image = await fetchImageAsBase64(String(pred.image_uri));
    } catch (e) {
      return NextResponse.json(
        { error: `Could not load the image: ${e instanceof Error ? e.message : "unknown error"}` },
        { status: 400 }
      );
    }

    const detectionContext = detection
      ? [
          `Detection: ${detection.display_name || detection.detection_code || "unknown"}`,
          detection.label_policy ? `Label policy:\n${detection.label_policy}` : "",
          detection.decision_rubric
            ? `Decision rubric:\n${
                typeof detection.decision_rubric === "string"
                  ? detection.decision_rubric
                  : JSON.stringify(detection.decision_rubric)
              }`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "Detection definition unavailable.";

    const aiDecision = pred.predicted_decision || "(none)";
    const aiEvidence = pred.evidence || "(none)";
    const currentNote = String(pred.reviewer_note || pred.image_description || "").trim();
    const agrees = String(aiDecision).toUpperCase() === String(groundTruth).toUpperCase();

    const promptText = [
      "You are a senior QA reviewer for a computer-vision hazard-detection system.",
      "You are given an inspection image, the detection's definition, the AI model's decision with its stated evidence, and the human-confirmed ground-truth label (which is authoritative).",
      "",
      detectionContext,
      "",
      `AI model decision: ${aiDecision}`,
      `AI model evidence: "${aiEvidence}"`,
      `Human ground-truth label (authoritative): ${groundTruth}`,
      currentNote ? `Existing reviewer note (refine or replace it): "${currentNote}"` : "There is no reviewer note yet.",
      "",
      agrees
        ? "The AI decision AGREES with the ground truth. Look at the image and write a reviewer note that pinpoints the specific visual evidence confirming this label: name the component, its location, and the visible morphology."
        : "The AI decision DISAGREES with the ground truth. Look at the image and write a reviewer note that explicitly diagnoses WHY the AI was wrong: name the exact component and location it misjudged, describe the visual morphology it should have used, and state what it wrongly relied on (a confuser it over-called, or real evidence it missed).",
      "",
      "Requirements for the note:",
      "- 1 to 3 sentences, specific and grounded in what is actually visible in THIS image.",
      "- Reference concrete components, locations, and visual morphology; do not just restate the policy.",
      "- Output ONLY the note text: no preamble, no label names, no quotes, no markdown.",
    ].join("\n");

    const modelName = String(body?.model || DEFAULT_NOTE_MODEL);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([
      { text: promptText },
      { inlineData: { mimeType: image.mimeType, data: image.base64 } },
    ]);

    const note = String(result.response.text() || "")
      .trim()
      .replace(/^```(?:\w+)?\s*/, "")
      .replace(/\s*```$/, "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim();

    if (!note) {
      return NextResponse.json({ error: "The model returned an empty note." }, { status: 502 });
    }

    return NextResponse.json({ note });
  } catch (e) {
    logger.error("Failed to generate diagnostic reviewer note", {
      ...getRequestContext(req),
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate note" },
      { status: 500 }
    );
  }
}
