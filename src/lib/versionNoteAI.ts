import { GoogleGenerativeAI } from "@google/generative-ai";
import type { PromptVersion, MetricsSummary, Run } from "@/types";

const MODEL_NAME = "gemini-3.1-pro-preview";

function getApiKey(): string {
  return String(process.env.GEMINI_API_KEY || "").trim();
}

interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

interface PromptDiffInputRow {
  system_prompt?: string;
  user_prompt_template?: string;
  prompt_structure?: string | Record<string, unknown>;
  model?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  version_label?: string;
}

function parseStructure(value: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function computeDiff(source: PromptDiffInputRow, next: PromptDiffInputRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const scalarFields: Array<[string, unknown, unknown]> = [
    ["system_prompt", source.system_prompt || "", next.system_prompt || ""],
    ["user_prompt_template", source.user_prompt_template || "", next.user_prompt_template || ""],
    ["model", source.model || "", next.model || ""],
    ["temperature", source.temperature ?? null, next.temperature ?? null],
    ["top_p", source.top_p ?? null, next.top_p ?? null],
    ["max_output_tokens", source.max_output_tokens ?? null, next.max_output_tokens ?? null],
  ];
  for (const [field, a, b] of scalarFields) {
    if (String(a) !== String(b)) {
      diffs.push({ field, before: String(a), after: String(b) });
    }
  }

  const srcStruct = parseStructure(source.prompt_structure);
  const nextStruct = parseStructure(next.prompt_structure);
  const keys = new Set([...Object.keys(srcStruct), ...Object.keys(nextStruct)]);
  for (const key of keys) {
    const a = srcStruct[key];
    const b = nextStruct[key];
    const aStr = typeof a === "string" ? a : JSON.stringify(a ?? "");
    const bStr = typeof b === "string" ? b : JSON.stringify(b ?? "");
    if (aStr !== bStr) {
      diffs.push({ field: `prompt_structure.${key}`, before: aStr, after: bStr });
    }
  }
  return diffs;
}

function formatDiffForPrompt(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "(no field-level changes detected)";
  return diffs
    .map((d) => {
      const before = d.before.length > 400 ? d.before.slice(0, 400) + "…" : d.before;
      const after = d.after.length > 400 ? d.after.slice(0, 400) + "…" : d.after;
      return `- ${d.field}\n  BEFORE: ${before || "(empty)"}\n  AFTER:  ${after || "(empty)"}`;
    })
    .join("\n");
}

function fallbackDiffSummary(
  source: PromptDiffInputRow,
  next: PromptDiffInputRow,
  diffs: FieldDiff[],
  changeNotes: string
): string {
  const fieldList = diffs.length
    ? diffs.map((d) => d.field).join(", ")
    : "no field-level changes detected";
  const parts = [
    `Edited from ${source.version_label || "prior version"} to create ${next.version_label || "this version"}.`,
    `Changes: ${fieldList}.`,
  ];
  if (changeNotes && changeNotes.trim()) {
    parts.push(`Author's notes: ${changeNotes.trim()}`);
  }
  return parts.join(" ");
}

export async function summarizePromptDiff(input: {
  source: PromptDiffInputRow;
  next: PromptDiffInputRow;
  changeNotes: string;
}): Promise<string> {
  const diffs = computeDiff(input.source, input.next);
  const apiKey = getApiKey();
  if (!apiKey) {
    return fallbackDiffSummary(input.source, input.next, diffs, input.changeNotes);
  }

  const prompt = [
    "You are annotating a change to a VLM detection prompt.",
    "",
    `Source version: ${input.source.version_label || "(unlabeled)"}`,
    `New version: ${input.next.version_label || "(unlabeled)"}`,
    `Author's change notes: ${input.changeNotes || "(none)"}`,
    "",
    "Structured diff:",
    formatDiffForPrompt(diffs),
    "",
    "Write a 2-4 sentence entry for the version notes log. Cover:",
    "- What actually changed (the substantive edits, not \"system_prompt was edited\")",
    "- The likely goal / hypothesis behind the changes",
    "- Anything the reviewer should watch for once this version runs",
    "",
    "Plain prose. No headers. No markdown.",
  ].join("\n");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) {
      return fallbackDiffSummary(input.source, input.next, diffs, input.changeNotes);
    }
    return text;
  } catch {
    return fallbackDiffSummary(input.source, input.next, diffs, input.changeNotes);
  }
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function fallbackHilSummary(
  promptVersion: Pick<PromptVersion, "version_label" | "change_notes">,
  metrics: MetricsSummary
): string {
  const parts = [
    `HIL review finalized for ${promptVersion.version_label}.`,
    `Overall: precision ${pct(metrics.precision)}, recall ${pct(metrics.recall)}, F1 ${pct(metrics.f1)}, accuracy ${pct(metrics.accuracy)} across ${metrics.total} items (TP ${metrics.tp}, FP ${metrics.fp}, FN ${metrics.fn}, TN ${metrics.tn}).`,
    `Parse failure rate: ${pct(metrics.parse_failure_rate)}.`,
  ];
  return parts.join(" ");
}

export async function summarizeHilPerformance(input: {
  promptVersion: Pick<PromptVersion, "version_label" | "change_notes">;
  run: Pick<Run, "run_id" | "created_at">;
  metrics: MetricsSummary;
}): Promise<string> {
  const { promptVersion, metrics } = input;
  const apiKey = getApiKey();
  if (!apiKey) {
    return fallbackHilSummary(promptVersion, metrics);
  }

  const segmentLines: string[] = [];
  if (metrics.segment_metrics) {
    const sorted = Object.entries(metrics.segment_metrics)
      .filter(([, m]) => (m?.total ?? 0) > 0)
      .sort((a, b) => (a[1].f1 ?? 0) - (b[1].f1 ?? 0));
    for (const [segment, m] of sorted) {
      segmentLines.push(
        `  - ${segment}: F1 ${pct(m.f1)}, P ${pct(m.precision)}, R ${pct(m.recall)}, total ${m.total}`
      );
    }
  }

  const prompt = [
    "A HIL review pass just finalized. You are writing a performance summary entry",
    `for the version notes of prompt "${promptVersion.version_label}".`,
    "",
    "Overall metrics:",
    `- Accuracy ${pct(metrics.accuracy)}, Precision ${pct(metrics.precision)}, Recall ${pct(metrics.recall)}, F1 ${pct(metrics.f1)}`,
    `- Confusion: TP ${metrics.tp}, FP ${metrics.fp}, FN ${metrics.fn}, TN ${metrics.tn}`,
    `- Parse failure rate: ${pct(metrics.parse_failure_rate)}`,
    `- Total items reviewed: ${metrics.total}`,
    "",
    segmentLines.length ? "Per-segment breakdown (sorted by F1 asc):" : "",
    ...segmentLines,
    "",
    `Author's context on this version (change_notes): ${promptVersion.change_notes || "(none)"}`,
    "",
    "Write 3-5 sentences covering:",
    "- Overall performance in plain language (not \"F1 = 0.82\" but \"solid overall, with…\")",
    "- The 1-2 clearest weak points, tied to numbers or segments if available",
    "- The 1-2 clearest strengths",
    "- A concrete suggestion for what the next version might change, only if the data supports one",
    "",
    "Plain prose. No headers. No markdown lists.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) {
      return fallbackHilSummary(promptVersion, metrics);
    }
    return text;
  } catch {
    return fallbackHilSummary(promptVersion, metrics);
  }
}
