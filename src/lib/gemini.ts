import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GeminiDetectionResponse, PromptVersion } from "@/types";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

function stripMimeParams(mimeType: string | null | undefined): string {
  return String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function inferImageMimeTypeFromPath(sourcePath: string): string | null {
  const ext = path.extname(sourcePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || null;
}

function resolveImageMimeType({
  headerMimeType,
  sourcePath,
}: {
  headerMimeType?: string | null;
  sourcePath: string;
}): string {
  const normalizedHeader = stripMimeParams(headerMimeType);
  if (normalizedHeader.startsWith("image/")) {
    return normalizedHeader;
  }

  const inferred = inferImageMimeTypeFromPath(sourcePath);
  if (inferred) {
    return inferred;
  }

  if (normalizedHeader === "application/octet-stream") {
    throw new Error(
      `Unsupported MIME type: application/octet-stream for ${sourcePath}. Set a valid image content-type or use an image file extension.`
    );
  }

  if (normalizedHeader) {
    throw new Error(`Unsupported MIME type: ${normalizedHeader} for ${sourcePath}.`);
  }

  throw new Error(`Unable to determine image MIME type for ${sourcePath}.`);
}

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
  parseErrorReason: string | null;
  parseFixSuggestion: string | null;
  runtimeMs: number;
  retryCount: number;
}> {
  const genAI = getGeminiClient(apiKey);
  const responseSchema = {
    type: "OBJECT",
    required: ["detection_code", "decision", "confidence", "evidence"],
    properties: {
      detection_code: { type: "STRING" },
      decision: { type: "STRING", enum: ["DETECTED", "NOT_DETECTED"] },
      confidence: { type: "NUMBER" },
      evidence: { type: "STRING" },
    },
  } as const;

  const model = genAI.getGenerativeModel({
    model: prompt.model || "gemini-2.5-flash",
    generationConfig: {
      temperature: prompt.temperature,
      topP: prompt.top_p,
      maxOutputTokens: prompt.max_output_tokens,
      responseMimeType: "application/json",
      responseSchema,
    },
    systemInstruction: prompt.system_prompt,
  } as any);

  // Build image part
  const imageParts = await buildImagePart(imageUri);

  const userPrompt = prompt.user_prompt_template.replace(
    "{{DETECTION_CODE}}",
    detectionCode
  );
  const compiledUserPrompt = buildCompiledUserPrompt(prompt, userPrompt);
  const maxParseRetries = 3;
  let currentPrompt = compiledUserPrompt;
  let lastRaw = "";
  let lastParseReason: string | null = null;
  let lastParseFix: string | null = null;
  const startedAt = Date.now();

  try {
    for (let attempt = 0; attempt <= maxParseRetries; attempt += 1) {
      const result = await model.generateContent([currentPrompt, ...imageParts]);
      const raw = result.response.text();
      lastRaw = raw;

      const parsed = parseGeminiResponse(raw, detectionCode);
      if (parsed.ok) {
        return {
          parsed: parsed.result,
          raw,
          parseOk: true,
          parseErrorReason: null,
          parseFixSuggestion: null,
          runtimeMs: Date.now() - startedAt,
          retryCount: attempt,
        };
      }

      lastParseReason = parsed.reason;
      lastParseFix = parsed.fix;

      if (attempt >= maxParseRetries) {
        break;
      }

      currentPrompt = buildRetryPrompt({
        basePrompt: compiledUserPrompt,
        attempt: attempt + 1,
        reason: parsed.reason,
        fix: parsed.fix,
      });
    }

    return {
      parsed: null,
      raw: lastRaw,
      parseOk: false,
      parseErrorReason: lastParseReason
        ? `${lastParseReason} (after ${maxParseRetries} retries)`
        : `Parse failed after ${maxParseRetries} retries.`,
      parseFixSuggestion: lastParseFix,
      runtimeMs: Date.now() - startedAt,
      retryCount: maxParseRetries,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      parsed: null,
      raw: `ERROR: ${errMsg}`,
      parseOk: false,
      parseErrorReason: `Model/API error: ${errMsg}`,
      parseFixSuggestion:
        "Verify API key/model availability, reduce concurrency, and retry. If this persists, inspect network/API quota errors.",
      runtimeMs: Date.now() - startedAt,
      retryCount: 0,
    };
  }
}

function buildRetryPrompt({
  basePrompt,
  attempt,
  reason,
  fix,
}: {
  basePrompt: string;
  attempt: number;
  reason: string | null;
  fix: string | null;
}): string {
  const retryHeader = [
    `Retry attempt ${attempt}: previous response failed schema validation.`,
    reason ? `Issue: ${reason}` : "",
    fix ? `Required fix: ${fix}` : "",
    "Return only valid JSON with exactly these keys: detection_code, decision, confidence, evidence.",
    "No markdown. No backticks. No explanation text.",
  ]
    .filter(Boolean)
    .join("\n");

  return `${basePrompt}\n\n${retryHeader}`;
}

function buildCompiledUserPrompt(prompt: PromptVersion, baseUserPrompt: string): string {
  const structure = (prompt.prompt_structure || {}) as any;
  const labelPolicy = typeof structure.label_policy === "string" ? structure.label_policy.trim() : "";
  const decisionRubric = typeof structure.decision_rubric === "string" ? structure.decision_rubric.trim() : "";

  const sections = [
    baseUserPrompt.trim(),
    labelPolicy ? `Decision Policy:\n${labelPolicy}` : "",
    decisionRubric ? `Decision Rubric:\n${decisionRubric}` : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

export async function buildImagePart(imageUri: string) {
  // Support local file paths and base64 data URIs
  if (imageUri.startsWith("data:")) {
    const match = imageUri.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mimeType = resolveImageMimeType({ headerMimeType: match[1], sourcePath: "data-uri" });
      return [
        {
          inlineData: {
            mimeType,
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
    const mimeType = resolveImageMimeType({ sourcePath: resolvedPath });
    return [
      {
        inlineData: {
          mimeType,
          data: data.toString("base64"),
        },
      },
    ];
  }

  if (imageUri.startsWith("gs://")) {
    const gcs = await fetchGcsImage(imageUri);
    return [
      {
        inlineData: {
          mimeType: gcs.mimeType,
          data: gcs.data.toString("base64"),
        },
      },
    ];
  }

  // HTTP URL - fetch and convert
  if (imageUri.startsWith("http")) {
    const response = await fetch(imageUri);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to fetch image URL ${imageUri}: ${response.status} ${response.statusText} ${text}`.trim());
    }
    const buffer = await response.arrayBuffer();
    const urlPath = (() => {
      try {
        return new URL(imageUri).pathname;
      } catch {
        return imageUri;
      }
    })();
    const mimeType = resolveImageMimeType({
      headerMimeType: response.headers.get("content-type"),
      sourcePath: urlPath,
    });
    return [
      {
        inlineData: {
          mimeType,
          data: Buffer.from(buffer).toString("base64"),
        },
      },
    ];
  }

  // Fallback: treat as relative path under data/uploads
  const resolvedPath = path.join(process.cwd(), "data", "uploads", imageUri);
  if (fs.existsSync(resolvedPath)) {
    const data = fs.readFileSync(resolvedPath);
    const mimeType = resolveImageMimeType({ sourcePath: resolvedPath });
    return [
      {
        inlineData: {
          mimeType,
          data: data.toString("base64"),
        },
      },
    ];
  }

  return [];
}

let gcsTokenCache: { token: string; expiresAtMs: number } | null = null;

async function fetchGcsImage(gsUri: string): Promise<{ data: Buffer; mimeType: string }> {
  const { bucket, objectPath } = parseGsUri(gsUri);
  const token = await getGcsAccessToken();
  const objectName = encodeURIComponent(objectPath);
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${objectName}?alt=media`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch GCS object ${gsUri}: ${response.status} ${response.statusText} ${text}`.trim());
  }
  const mimeType = resolveImageMimeType({
    headerMimeType: response.headers.get("content-type"),
    sourcePath: objectPath,
  });
  const data = Buffer.from(await response.arrayBuffer());
  return { data, mimeType };
}

function parseGsUri(gsUri: string): { bucket: string; objectPath: string } {
  const withoutScheme = gsUri.replace(/^gs:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx <= 0 || slashIdx === withoutScheme.length - 1) {
    throw new Error(`Invalid gs:// URI: ${gsUri}`);
  }
  return {
    bucket: withoutScheme.slice(0, slashIdx),
    objectPath: withoutScheme.slice(slashIdx + 1),
  };
}

async function getGcsAccessToken(): Promise<string> {
  const now = Date.now();
  if (gcsTokenCache && gcsTokenCache.expiresAtMs > now + 30_000) {
    return gcsTokenCache.token;
  }

  const creds = loadServiceAccountCredentials();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;

  const assertion = signJwtAssertion(
    {
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.read_only",
      aud: "https://oauth2.googleapis.com/token",
      exp,
      iat,
    },
    creds.private_key
  );

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Failed to obtain GCS access token: ${tokenRes.status} ${tokenRes.statusText} ${text}`.trim());
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error("OAuth token response missing access_token.");
  }
  const expiresInSec = Number(tokenJson.expires_in || 3600);
  gcsTokenCache = {
    token: tokenJson.access_token,
    expiresAtMs: now + Math.max(60, expiresInSec - 60) * 1000,
  };
  return tokenJson.access_token;
}

function loadServiceAccountCredentials(): { client_email: string; private_key: string } {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let raw = "";

  if (inlineJson?.trim()) {
    raw = inlineJson;
  } else if (credentialPath?.trim()) {
    raw = fs.readFileSync(credentialPath, "utf8");
  } else {
    throw new Error(
      "Missing service account credentials. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON."
    );
  }

  const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Invalid service account JSON. Expected client_email and private_key.");
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
  };
}

function signJwtAssertion(payload: Record<string, unknown>, privateKey: string): string {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");
  return `${unsigned}.${signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
): { result: GeminiDetectionResponse | null; ok: boolean; reason: string | null; fix: string | null } {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    // Validate schema
    if (typeof parsed.detection_code !== "string") {
      return {
        result: null,
        ok: false,
        reason: "Missing or invalid `detection_code` (must be string).",
        fix: "Return valid JSON with `detection_code` as a string.",
      };
    }
    if (parsed.detection_code !== expectedCode) {
      return {
        result: null,
        ok: false,
        reason: `detection_code mismatch. Expected ${expectedCode}, got ${parsed.detection_code}.`,
        fix: "Ensure the response uses the exact detection code from the prompt.",
      };
    }
    if (!["DETECTED", "NOT_DETECTED"].includes(parsed.decision)) {
      return {
        result: null,
        ok: false,
        reason: "Invalid `decision` value (must be DETECTED or NOT_DETECTED).",
        fix: "Set `decision` to exactly DETECTED or NOT_DETECTED.",
      };
    }
    if (typeof parsed.confidence !== "number" || Number.isNaN(parsed.confidence)) {
      return {
        result: null,
        ok: false,
        reason: "Missing or invalid `confidence` (must be numeric 0-1).",
        fix: "Return `confidence` as a number between 0 and 1.",
      };
    }
    if (parsed.confidence < 0 || parsed.confidence > 1) {
      return {
        result: null,
        ok: false,
        reason: "Confidence out of range (must be between 0 and 1).",
        fix: "Clamp confidence to a float between 0 and 1.",
      };
    }
    if (typeof parsed.evidence !== "string") {
      return {
        result: null,
        ok: false,
        reason: "Missing or invalid `evidence` (must be string).",
        fix: "Return a short evidence string describing the visual basis.",
      };
    }

    // Check for extra keys
    const allowedKeys = ["detection_code", "decision", "confidence", "evidence"];
    const extraKeys = Object.keys(parsed).filter((k) => !allowedKeys.includes(k));
    if (extraKeys.length > 0) {
      return {
        result: null,
        ok: false,
        reason: `Unexpected keys in response: ${extraKeys.join(", ")}.`,
        fix: "Return only the required keys: detection_code, decision, confidence, evidence.",
      };
    }

    return { result: parsed as GeminiDetectionResponse, ok: true, reason: null, fix: null };
  } catch {
    return {
      result: null,
      ok: false,
      reason: "Response was not valid JSON.",
      fix: "Return raw JSON only (no markdown/code fences/explanations) matching the required schema exactly.",
    };
  }
}
