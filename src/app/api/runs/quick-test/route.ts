import { NextRequest, NextResponse } from "next/server";
import { runDetectionInference } from "@/lib/gemini";
import { runRepository } from "@/lib/repositories";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const promptVersionId = String(formData.get("prompt_version_id") || "").trim();
    const detectionId = String(formData.get("detection_id") || "").trim();
    const apiKey = String(formData.get("api_key") || process.env.GEMINI_API_KEY || "").trim();
    const modelOverride = String(formData.get("model_override") || "").trim();
    const files = formData.getAll("files") as File[];

    if (!apiKey) {
      return NextResponse.json({ error: "API key required (request api_key or GEMINI_API_KEY env)" }, { status: 400 });
    }
    if (!promptVersionId || !detectionId) {
      return NextResponse.json({ error: "prompt_version_id and detection_id are required" }, { status: 400 });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "At least one image file is required" }, { status: 400 });
    }
    if (files.length > 10) {
      return NextResponse.json({ error: "Quick Test supports up to 10 images" }, { status: 400 });
    }

    const prompt = runRepository.getPromptVersionById(promptVersionId);
    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }
    const detection = runRepository.getDetectionById(detectionId);
    if (!detection) {
      return NextResponse.json({ error: "Detection not found" }, { status: 404 });
    }

    const parsedPrompt = {
      ...prompt,
      prompt_structure: JSON.parse(prompt.prompt_structure || "{}"),
      model: modelOverride || prompt.model,
    };

    const results = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const mimeType = file.type || inferMimeTypeFromFilename(file.name);
        const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
        const result = await runDetectionInference(apiKey, parsedPrompt, detection.detection_code, dataUri);

        return {
          image_name: file.name || "image",
          predicted_decision: result.parsed?.decision || null,
          confidence: result.parsed?.confidence ?? null,
          evidence: result.parsed?.evidence || null,
          parse_ok: result.parseOk,
          raw_response: result.raw,
          parse_error_reason: result.parseErrorReason,
          parse_fix_suggestion: result.parseFixSuggestion,
          inference_runtime_ms: result.runtimeMs ?? null,
          parse_retry_count: result.retryCount ?? 0,
        };
      })
    );

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

function inferMimeTypeFromFilename(filename: string): string {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}
