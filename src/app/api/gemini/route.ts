import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Prompt improvement assistant
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { api_key, predictions, prompt, detection, model_override } = body;

  if (!api_key) {
    return NextResponse.json({ error: "API key required" }, { status: 400 });
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

  const analysisPrompt = `You are a prompt engineering expert. Analyze the following detection evaluation results and suggest targeted improvements to the prompt.

DETECTION: ${detection.detection_code} — ${detection.display_name}

CURRENT SYSTEM PROMPT:
${prompt.system_prompt}

CURRENT USER PROMPT TEMPLATE:
${prompt.user_prompt_template}

FALSE POSITIVES (${falsePositives.length} total, showing up to 5):
${falsePositives.slice(0, 5).map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}`).join("\n")}

FALSE NEGATIVES (${falseNegatives.length} total, showing up to 5):
${falseNegatives.slice(0, 5).map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}", Confidence: ${p.confidence}`).join("\n")}

REPRESENTATIVE TRUE POSITIVES:
${truePositives.map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}"`).join("\n")}

REPRESENTATIVE TRUE NEGATIVES:
${trueNegatives.map((p: any) => `- Image: ${p.image_id}, Evidence: "${p.evidence}"`).join("\n")}

REVIEWER ERROR TAGS:
${errorTags.length > 0 ? errorTags.map((t: any) => `- ${t.image_id}: ${t.error_tag} ${t.note ? "— " + t.note : ""}`).join("\n") : "None"}

RULES:
- Propose at most 5 targeted edits
- Each edit should be mapped to a specific failure cluster
- Do NOT rewrite the entire prompt
- Do NOT change the detection_code or output schema
- Do NOT change label policy unless it's clearly the root cause
- Present each as: OLD text → NEW text

Return ONLY valid JSON array:
[
  {
    "section": "system_prompt | user_prompt_template",
    "old_text": "exact text to replace",
    "new_text": "replacement text",
    "rationale": "why this helps",
    "failure_cluster": "FP_cluster_description | FN_cluster_description"
  }
]`;

  try {
    const genAI = new GoogleGenerativeAI(api_key);
    const model = genAI.getGenerativeModel({ model: model_override || "gemini-2.5-flash" });
    const result = await model.generateContent(analysisPrompt);
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
