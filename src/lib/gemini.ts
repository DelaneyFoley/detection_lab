import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeminiDetectionResponse, PromptVersion } from "@/types";
import fs from "fs";
import path from "path";

export function getGeminiClient(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

export async function runDetectionInference(
  apiKey: string,
  prompt: PromptVersion,
  detectionCode: string,
  imageUri: string
): Promise<{
  parsed: GeminiDetectionResponse | null;
  raw: string;
  parseOk: boolean;
}> {
  const genAI = getGeminiClient(apiKey);
  const model = genAI.getGenerativeModel({
    model: prompt.model || "gemini-2.5-flash",
    generationConfig: {
      temperature: prompt.temperature,
      topP: prompt.top_p,
      maxOutputTokens: prompt.max_output_tokens,
    },
    systemInstruction: prompt.system_prompt,
  });

  // Build image part
  const imageParts = await buildImagePart(imageUri);

  const userPrompt = prompt.user_prompt_template.replace(
    "{{DETECTION_CODE}}",
    detectionCode
  );
  const compiledUserPrompt = buildCompiledUserPrompt(prompt, userPrompt);

  try {
    const result = await model.generateContent([compiledUserPrompt, ...imageParts]);
    const raw = result.response.text();

    // Try to parse JSON
    const parsed = parseGeminiResponse(raw, detectionCode);
    return {
      parsed: parsed.result,
      raw,
      parseOk: parsed.ok,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      parsed: null,
      raw: `ERROR: ${errMsg}`,
      parseOk: false,
    };
  }
}

function buildCompiledUserPrompt(prompt: PromptVersion, baseUserPrompt: string): string {
  const structure = (prompt.prompt_structure || {}) as any;
  const labelPolicy = typeof structure.label_policy === "string" ? structure.label_policy.trim() : "";
  const decisionRubric = typeof structure.decision_rubric === "string" ? structure.decision_rubric.trim() : "";

  const sections = [
    baseUserPrompt.trim(),
    labelPolicy ? `Label Policy:\n${labelPolicy}` : "",
    decisionRubric ? `Decision Rubric:\n${decisionRubric}` : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

async function buildImagePart(imageUri: string) {
  // Support local file paths and base64 data URIs
  if (imageUri.startsWith("data:")) {
    const match = imageUri.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return [
        {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        },
      ];
    }
  }

  // Local file path
  if (imageUri.startsWith("/") || imageUri.startsWith("./")) {
    const resolvedPath = resolveLocalImagePath(imageUri);
    const data = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    return [
      {
        inlineData: {
          mimeType: mimeMap[ext] || "image/jpeg",
          data: data.toString("base64"),
        },
      },
    ];
  }

  // HTTP URL - fetch and convert
  if (imageUri.startsWith("http")) {
    const response = await fetch(imageUri);
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return [
      {
        inlineData: {
          mimeType: contentType,
          data: Buffer.from(buffer).toString("base64"),
        },
      },
    ];
  }

  // Fallback: treat as relative path under data/uploads
  const resolvedPath = path.join(process.cwd(), "data", "uploads", imageUri);
  if (fs.existsSync(resolvedPath)) {
    const data = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    return [
      {
        inlineData: {
          mimeType: ext === ".png" ? "image/png" : "image/jpeg",
          data: data.toString("base64"),
        },
      },
    ];
  }

  return [];
}

function resolveLocalImagePath(imageUri: string): string {
  // Browser-style app paths (e.g. /sample-data/foo.svg) should resolve from /public.
  if (path.isAbsolute(imageUri)) {
    if (fs.existsSync(imageUri)) {
      return imageUri;
    }
    const publicPath = path.join(process.cwd(), "public", imageUri.replace(/^\//, ""));
    if (fs.existsSync(publicPath)) {
      return publicPath;
    }
    return imageUri;
  }

  return path.join(process.cwd(), imageUri);
}

function parseGeminiResponse(
  raw: string,
  expectedCode: string
): { result: GeminiDetectionResponse | null; ok: boolean } {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    // Validate schema
    if (
      typeof parsed.detection_code !== "string" ||
      !["DETECTED", "NOT_DETECTED"].includes(parsed.decision) ||
      typeof parsed.confidence !== "number" ||
      typeof parsed.evidence !== "string"
    ) {
      return { result: null, ok: false };
    }

    // Check for extra keys
    const allowedKeys = ["detection_code", "decision", "confidence", "evidence"];
    const extraKeys = Object.keys(parsed).filter((k) => !allowedKeys.includes(k));
    if (extraKeys.length > 0) {
      return { result: null, ok: false };
    }

    return { result: parsed as GeminiDetectionResponse, ok: true };
  } catch {
    return { result: null, ok: false };
  }
}
