export const AVAILABLE_MODELS = [
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "o3",
  "o4-mini",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gemini-3.1-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash",
  "gemini-3.1-pro",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number];

export type Provider = "gemini" | "anthropic" | "openai";

export function getProvider(model: string): Provider {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "gemini";
  return "openai";
}

export const PROVIDER_ENV_KEY: Record<Provider, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};
