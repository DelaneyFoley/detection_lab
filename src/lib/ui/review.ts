import type { Prediction } from "@/types";

export function getResolvedGroundTruth(prediction: Pick<Prediction, "corrected_label" | "ground_truth_label">): string | null {
  return prediction.corrected_label || prediction.ground_truth_label || null;
}

export function formatModelOutput(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "—";
  let cleaned = text;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cleaned;
  }
}

export function fmtPercent(value: number): string {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export async function safeJsonArray<T>(res: Response, label: string): Promise<T[]> {
  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed to load ${label}:`, res.status, text.slice(0, 200));
    return [];
  }
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) return data as T[];
    if (data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items)) {
      return (data as { items: T[] }).items;
    }
    return [];
  } catch {
    console.error(`Invalid JSON for ${label}:`, text.slice(0, 200));
    return [];
  }
}

export async function pollRunToTerminalState(
  runId: string,
  onProgress?: (run: any) => void,
  intervalMs = 1200,
  timeoutMs = 10 * 60 * 1000
): Promise<any> {
  const started = Date.now();

  while (true) {
    const res = await fetch(`/api/runs?run_id=${runId}`);
    const run = await res.json();

    if (!res.ok) {
      throw new Error(run?.error || "Failed to poll run status");
    }

    onProgress?.(run);
    if (run?.status === "completed" || run?.status === "failed" || run?.status === "cancelled") {
      return run;
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error("Run polling timed out");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
