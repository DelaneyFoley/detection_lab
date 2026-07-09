import type { PromptCandidate } from "@/lib/promptIteration/types";
import { buildUserPromptTemplate, splitUserPromptTemplate, ensureEvidenceRequirement } from "@/lib/detectionPrompts";

export interface PromptVersionSaveInput {
  promptVersionId: string;
  detectionId: string;
  versionLabel: string;
  systemPrompt: string;
  userPromptTemplate: string;
  promptStructure: string;
  model: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  changeNotes: string;
  versionNotes: string;
  createdBy: string;
  createdAt: string;
  sourcePromptVersionId: string | null;
}

function parseStructure(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

/**
 * Resolve the user prompt template for a candidate. When the candidate proposes
 * a new detection-specific addendum, rebuild the template from the source's
 * fixed base (task description + JSON schema block) plus the new addendum;
 * otherwise keep the source addendum. The addendum ALWAYS retains the evidence
 * requirement so the model always emits a populated evidence field.
 */
export function applyCandidateUserTemplate(sourceTemplate: string, candidate: PromptCandidate): string {
  const source = String(sourceTemplate || "");
  const { base, addendum: sourceAddendum } = splitUserPromptTemplate(source);
  const chosen = candidate.user_prompt_addendum != null ? candidate.user_prompt_addendum : sourceAddendum;
  return buildUserPromptTemplate(base, ensureEvidenceRequirement(chosen));
}

/**
 * Deterministic label for an AI-tuned version derived from its source.
 * `batch` distinguishes separate iteration runs against the same source so
 * labels never collide across re-runs (batch 1 stays clean, e.g. `V1-ai-r1`;
 * batch 2+ becomes `V1-ai-b2-r1`).
 */
export function aiVersionLabel(sourceVersionLabel: string, round?: number, batch?: number): string {
  const base = String(sourceVersionLabel || "prompt").trim() || "prompt";
  // Strip any prior "-ai" / "-ai-bN" / "-ai-rN" suffix so labels stay clean.
  const root = base.replace(/-ai(?:-b\d+)?(?:-r\d+)?$/i, "");
  const batchTag = batch && batch > 1 ? `-b${batch}` : "";
  return round && round > 0 ? `${root}-ai${batchTag}-r${round}` : `${root}-ai${batchTag}`;
}

/**
 * Build the `createPromptVersion` input for a winning candidate. Pure and
 * DB-free so it can be unit-tested. Only the tuned prompt_structure fields
 * (label_policy, decision_rubric) and optional system prompt are overridden;
 * every other field is inherited from the source version.
 */
export function buildPromptVersionInput(params: {
  promptVersionId: string;
  detectionId: string;
  sourcePrompt: any;
  candidate: PromptCandidate;
  newVersionLabel: string;
  changeNotes: string;
  versionNotes: string;
  createdAt: string;
  sourcePromptVersionId: string;
}): PromptVersionSaveInput {
  const structure = parseStructure(params.sourcePrompt?.prompt_structure);
  const newStructure = {
    ...structure,
    label_policy: params.candidate.label_policy,
    decision_rubric: params.candidate.decision_rubric,
  };
  return {
    promptVersionId: params.promptVersionId,
    detectionId: params.detectionId,
    versionLabel: params.newVersionLabel,
    systemPrompt: params.candidate.system_prompt || params.sourcePrompt.system_prompt || "",
    userPromptTemplate: applyCandidateUserTemplate(params.sourcePrompt.user_prompt_template || "", params.candidate),
    promptStructure: JSON.stringify(newStructure),
    model: params.sourcePrompt.model || "gemini-2.5-flash",
    temperature: Number(params.sourcePrompt.temperature ?? 0),
    topP: Number(params.sourcePrompt.top_p ?? 1),
    maxOutputTokens: Number(params.sourcePrompt.max_output_tokens ?? 1024),
    changeNotes: params.changeNotes,
    versionNotes: params.versionNotes,
    createdBy: "system",
    createdAt: params.createdAt,
    sourcePromptVersionId: params.sourcePromptVersionId,
  };
}

/** Parse/validate a goal-F1 input (accepts 0–1 fractions or 0–100 percents). */
export function parseGoalF1(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: "goal_f1 must be a number" };
  const frac = n > 1 ? n / 100 : n;
  if (frac < 0 || frac > 1) return { ok: false, error: "goal_f1 must be between 0 and 1 (or 0 and 100)" };
  return { ok: true, value: frac };
}

/**
 * Parse/validate a lean-preference input: the maximum F1 (as a fraction) the
 * operator is willing to trade for a leaner prompt. Accepts 0–1 fractions or
 * 0–100 percents; clamped to a sane [0, 0.5] range. Empty => null (use default).
 */
export function parseLeanPreference(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: "lean_preference must be a number" };
  const frac = n > 1 ? n / 100 : n;
  if (frac < 0 || frac > 0.5) return { ok: false, error: "lean_preference must be between 0 and 0.5 (or 0 and 50)" };
  return { ok: true, value: frac };
}
