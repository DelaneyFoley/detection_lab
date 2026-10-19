// Includes the production ai-services GoogleModelEnum values (first group) so
// production-replication runs can select the exact models production uses.
export const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash",
  "gemini-3.1-pro",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
] as const;

// The `thinkingLevel` enum (minimal/low/medium/high) is a Gemini 3.x feature.
// 2.5/2.0 models reject it with a 400 (they use a numeric thinking budget instead),
// even though the models API reports `thinking: true` for them. Verified empirically.
export function modelSupportsThinkingLevel(model: string): boolean {
  const m = /gemini-(\d+)/i.exec(model || "");
  return !!m && parseInt(m[1], 10) >= 3;
}
