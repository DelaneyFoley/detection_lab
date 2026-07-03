import type { PromptVersion, GeminiDetectionResponse } from "@/types";
import { getProvider } from "@/lib/models";
import { runAnthropicInference } from "./anthropic";
import { runOpenAIInference } from "./openai";
import { runDetectionInference as runGeminiInference } from "@/lib/gemini";

export type InferenceResult = {
  parsed: GeminiDetectionResponse | null;
  raw: string;
  parseOk: boolean;
  parseErrorReason: string | null;
  parseFixSuggestion: string | null;
  runtimeMs: number;
  retryCount: number;
};

export async function runDetectionInference(
  apiKey: string,
  prompt: PromptVersion,
  detectionCode: string,
  imageUri: string
): Promise<InferenceResult> {
  const provider = getProvider(prompt.model);

  switch (provider) {
    case "anthropic":
      return runAnthropicInference(apiKey, prompt, detectionCode, imageUri);
    case "openai":
      return runOpenAIInference(apiKey, prompt, detectionCode, imageUri);
    case "gemini":
    default:
      return runGeminiInference(apiKey, prompt, detectionCode, imageUri);
  }
}
