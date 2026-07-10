import type { PromptVersion, GeminiDetectionResponse } from "@/types";
import { fetchImageAsBase64, getReferenceImageUri } from "./shared";

const STRICT_JSON_CONTRACT = [
  'Return ONLY this JSON object and nothing else.',
  '{',
  '  "detection_code": "{{DETECTION_CODE}}",',
  '  "decision": "DETECTED" or "NOT_DETECTED",',
  '  "confidence": <float 0-1>,',
  '  "evidence": "<short phrase describing visual basis>"',
  '}',
  'Do not wrap the JSON in markdown code fences.',
  'Do not add any prose, comments, headings, or extra keys.',
].join("\n");

export async function runAnthropicInference(
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
  const startedAt = Date.now();
  const maxRetries = 3;

  const userPrompt = prompt.user_prompt_template.replace(
    /\{\{DETECTION_CODE\}\}/g,
    detectionCode
  );
  const compiledUserPrompt = buildCompiledPrompt(prompt, userPrompt, detectionCode);

  try {
    const { base64, mimeType } = await fetchImageAsBase64(imageUri);

    // Optional reference sheet (labeled examples) sent before the target image.
    const referenceUri = getReferenceImageUri(prompt);
    let ref: { base64: string; mimeType: string } | null = null;
    if (referenceUri) {
      try {
        ref = await fetchImageAsBase64(referenceUri);
      } catch {
        /* ignore unresolvable reference */
      }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const body: Record<string, unknown> = {
        model: prompt.model,
        max_tokens: prompt.max_output_tokens,
        temperature: prompt.temperature,
        system: prompt.system_prompt,
        messages: [
          {
            role: "user",
            content: [
              ...(ref
                ? [
                    { type: "text", text: "REFERENCE — labeled calibration examples; use to judge severity:" },
                    { type: "image", source: { type: "base64", media_type: ref.mimeType, data: ref.base64 } },
                  ]
                : []),
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: attempt === 0 ? compiledUserPrompt : buildRetryText(compiledUserPrompt, attempt, detectionCode) },
            ],
          },
        ],
      };

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        if (resp.status === 429 || resp.status >= 500) {
          const wait = resp.status === 429 ? 15000 : 5000;
          await new Promise((r) => setTimeout(r, wait * (attempt + 1)));
          continue;
        }
        throw new Error(`Anthropic API ${resp.status}: ${errBody.slice(0, 200)}`);
      }

      const json = await resp.json();
      const rawText: string = String(json.content?.[0]?.text || "").trim();

      const parseResult = parseResponse(rawText, detectionCode);
      if (parseResult.ok) {
        return {
          parsed: parseResult.result,
          raw: rawText,
          parseOk: true,
          parseErrorReason: null,
          parseFixSuggestion: null,
          runtimeMs: Date.now() - startedAt,
          retryCount: attempt,
        };
      }

      if (attempt >= maxRetries) {
        return {
          parsed: null,
          raw: rawText,
          parseOk: false,
          parseErrorReason: parseResult.reason,
          parseFixSuggestion: parseResult.fix,
          runtimeMs: Date.now() - startedAt,
          retryCount: attempt,
        };
      }
    }

    return { parsed: null, raw: "", parseOk: false, parseErrorReason: "Exhausted retries", parseFixSuggestion: null, runtimeMs: Date.now() - startedAt, retryCount: maxRetries };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      parsed: null,
      raw: `ERROR: ${msg}`,
      parseOk: false,
      parseErrorReason: `Model/API error: ${msg}`,
      parseFixSuggestion: "Verify API key and model availability, reduce concurrency, and retry.",
      runtimeMs: Date.now() - startedAt,
      retryCount: 0,
    };
  }
}

function buildCompiledPrompt(prompt: PromptVersion, baseUserPrompt: string, detectionCode: string): string {
  const structure = (prompt.prompt_structure || {}) as any;
  const fixedGuidance = typeof structure.fixed_guidance === "string" ? structure.fixed_guidance.trim() : "";
  const labelPolicy = typeof structure.label_policy === "string" ? structure.label_policy.trim() : "";
  const decisionRubric = typeof structure.decision_rubric === "string" ? structure.decision_rubric.trim() : "";
  const schemaContract = STRICT_JSON_CONTRACT.replace(/\{\{DETECTION_CODE\}\}/g, detectionCode);
  const sections = [
    baseUserPrompt.trim(),
    fixedGuidance ? `Detection Guidelines (fixed):\n${fixedGuidance}` : "",
    labelPolicy ? `Decision Policy:\n${labelPolicy}` : "",
    decisionRubric ? `Decision Rubric:\n${decisionRubric}` : "",
    schemaContract,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function buildRetryText(base: string, attempt: number, detectionCode: string): string {
  return `${base}\n\nRetry attempt ${attempt}: previous response failed schema validation.\n${STRICT_JSON_CONTRACT.replace(/\{\{DETECTION_CODE\}\}/g, detectionCode)}`;
}

function parseResponse(raw: string, detectionCode: string): { ok: true; result: GeminiDetectionResponse } | { ok: false; reason: string; fix: string | null } {
  try {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return { ok: false, reason: "Response is not a raw JSON object", fix: "Return only the raw JSON object. No markdown or extra text." };
    }
    const parsed = JSON.parse(trimmed);
    if (parsed.decision !== "DETECTED" && parsed.decision !== "NOT_DETECTED") {
      return { ok: false, reason: "Invalid decision value", fix: "decision must be DETECTED or NOT_DETECTED" };
    }
    return {
      ok: true,
      result: {
        detection_code: parsed.detection_code || detectionCode,
        decision: parsed.decision,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        evidence: parsed.evidence || "",
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `JSON parse error: ${msg}`, fix: "Return valid JSON only." };
  }
}
