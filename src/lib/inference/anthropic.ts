import type { PromptVersion, GeminiDetectionResponse } from "@/types";
import { fetchImageAsBase64 } from "./shared";

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
  const compiledUserPrompt = buildCompiledPrompt(prompt, userPrompt);

  try {
    const { base64, mimeType } = await fetchImageAsBase64(imageUri);

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
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              { type: "text", text: attempt === 0 ? compiledUserPrompt : buildRetryText(compiledUserPrompt, attempt) },
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
      const rawText: string = json.content?.[0]?.text || "";

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

function buildCompiledPrompt(prompt: PromptVersion, baseUserPrompt: string): string {
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

function buildRetryText(base: string, attempt: number): string {
  return `${base}\n\nRetry attempt ${attempt}: previous response failed schema validation. Return only valid JSON with keys: detection_code, decision, confidence, evidence. No markdown or backticks.`;
}

function parseResponse(raw: string, detectionCode: string): { ok: true; result: GeminiDetectionResponse } | { ok: false; reason: string; fix: string | null } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, reason: "No JSON object found in response", fix: "Respond with only a JSON object." };
    const parsed = JSON.parse(jsonMatch[0]);
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
