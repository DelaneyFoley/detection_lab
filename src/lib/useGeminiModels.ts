import { useEffect, useState } from "react";
import { GEMINI_MODELS } from "@/lib/geminiModels";

// Excludes non-text models (image/tts/embedding/etc.), matching the main model picker.
function isDetectionModel(name: string): boolean {
  return typeof name === "string" && !/image|tts|embedding|computer-use|\blive\b|\baqa\b/i.test(name);
}

/**
 * Live Gemini model list from Google (same `/api/gemini/models` source as the main
 * model picker), with the static GEMINI_MODELS list as the fallback until the fetch
 * resolves or on any failure.
 */
export function useGeminiModels(): string[] {
  const [models, setModels] = useState<string[]>(GEMINI_MODELS as unknown as string[]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/gemini/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) return;
        const data = await res.json();
        const live: string[] = Array.isArray(data?.models)
          ? data.models.filter((m: unknown): m is string => typeof m === "string" && m.startsWith("gemini") && isDetectionModel(m))
          : [];
        if (!cancelled && live.length > 0) setModels(live);
      } catch {
        /* keep the static fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}
