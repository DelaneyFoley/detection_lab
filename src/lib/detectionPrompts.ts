export type DetectionCategory = "INCORRECT_CAPTURE" | "HAZARD_IDENTIFICATION";

export const DETECTION_CATEGORY_LABELS: Record<DetectionCategory, string> = {
  INCORRECT_CAPTURE: "Incorrect Capture",
  HAZARD_IDENTIFICATION: "Hazard Identification",
};

export const DETECTION_CATEGORY_OPTIONS = [
  { value: "INCORRECT_CAPTURE", label: DETECTION_CATEGORY_LABELS.INCORRECT_CAPTURE },
  { value: "HAZARD_IDENTIFICATION", label: DETECTION_CATEGORY_LABELS.HAZARD_IDENTIFICATION },
] as const;

export const DEFAULT_DETECTION_CATEGORY: DetectionCategory = "HAZARD_IDENTIFICATION";

export const CATEGORY_PROMPT_SETTING_KEYS: Record<
  DetectionCategory,
  { system: string; user: string }
> = {
  INCORRECT_CAPTURE: {
    system: "incorrect_capture_system_prompt",
    user: "incorrect_capture_user_prompt",
  },
  HAZARD_IDENTIFICATION: {
    system: "hazard_identification_system_prompt",
    user: "hazard_identification_user_prompt",
  },
};

/**
 * The strict JSON output contract. This lives inside the admin-editable
 * user_prompt_template so nothing about the runtime prompt is hidden from the
 * UI. Retry logic in the inference providers also references this constant to
 * reinforce the schema on parse-failure retries.
 */
export const STRICT_JSON_CONTRACT = [
  "Return ONLY this JSON object and nothing else.",
  "{",
  '  "detection_code": "{{DETECTION_CODE}}",',
  '  "decision": "DETECTED" or "NOT_DETECTED",',
  '  "confidence": <float 0-1>,',
  '  "evidence": "<short phrase describing visual basis>"',
  "}",
  "Do not wrap the JSON in markdown code fences.",
  "Do not add any prose, comments, headings, or extra keys.",
].join("\n");

/** Render the strict JSON contract for a specific detection code. */
export function buildSchemaContract(detectionCode: string): string {
  return STRICT_JSON_CONTRACT.replace(/\{\{DETECTION_CODE\}\}/g, detectionCode);
}

export const DEFAULT_CATEGORY_PROMPT_TEMPLATES: Record<
  DetectionCategory,
  { system_prompt: string; user_prompt_template: string }
> = {
  INCORRECT_CAPTURE: {
    system_prompt:
      "You are a property underwriting image validation system. Determine whether the image is an incorrect capture for the requested inspection objective. Return only valid JSON that matches the required schema.",
    user_prompt_template: [
      "Determine whether this image is an incorrect capture for detection code {{DETECTION_CODE}}.",
      "",
      "DETECTED means the image fails the required capture context and should be rejected.",
      "NOT_DETECTED means the image is a usable, in-context capture.",
      "",
      STRICT_JSON_CONTRACT,
    ].join("\n"),
  },
  HAZARD_IDENTIFICATION: {
    system_prompt:
      "You are a property underwriting hazard detection system. Analyze one image for the requested hazard or condition and return only valid JSON that matches the required schema.",
    user_prompt_template: [
      "Analyze this image for detection code {{DETECTION_CODE}}.",
      "",
      "DETECTED means the target hazard or condition is present or visually confirmed.",
      "NOT_DETECTED means it is absent or not visually confirmed.",
      "",
      STRICT_JSON_CONTRACT,
    ].join("\n"),
  },
};

export function normalizeDetectionCategory(value: unknown): DetectionCategory {
  return value === "INCORRECT_CAPTURE" ? "INCORRECT_CAPTURE" : DEFAULT_DETECTION_CATEGORY;
}

const VERSION_SUFFIX_RE = /_V(\d+)$/i;
const DOT_SUFFIX_RE = /^(.+)\.(\d+)$/;
const TRAILING_INT_RE = /^(.+?)(\d+)$/;

/**
 * Split a stored version_label into its editable base name and numeric suffix.
 * Modern labels use `Detection Baseline_V3`. Legacy labels commonly use a
 * trailing `.n` (e.g. `BASELINE_DETECTION-Revised30.2`) or a plain trailing
 * integer (e.g. `BASELINE_DETECTION-Revised16`). Priority: `_V{n}` > `.{n}` >
 * trailing digits. Labels with none return num=null.
 */
export function parseVersionLabel(label: string): { base: string; num: number | null } {
  const s = String(label || "").trim();
  const v = s.match(VERSION_SUFFIX_RE);
  if (v && v.index !== undefined) {
    return { base: s.slice(0, v.index).trim(), num: parseInt(v[1], 10) };
  }
  const d = s.match(DOT_SUFFIX_RE);
  if (d) {
    return { base: d[1].trim(), num: parseInt(d[2], 10) };
  }
  const t = s.match(TRAILING_INT_RE);
  if (t) {
    return { base: t[1].trim(), num: parseInt(t[2], 10) };
  }
  return { base: s, num: null };
}

/**
 * Highest V-number already in use for a given base name across the provided
 * labels (case-insensitive match on base). Returns 0 when no prior V-numbered
 * label matches.
 */
export function nextVersionNumber(baseName: string, existingLabels: string[]): number {
  const target = String(baseName || "").trim().toLowerCase();
  if (!target) return 1;
  let max = 0;
  for (const label of existingLabels) {
    const { base, num } = parseVersionLabel(label);
    if (num != null && base.toLowerCase() === target && num > max) max = num;
  }
  return max + 1;
}

/**
 * Compose the final stored version_label from a user-supplied base name and
 * the set of existing labels on the same detection.
 */
export function buildVersionLabel(baseName: string, existingLabels: string[]): string {
  const base = String(baseName || "").trim() || "Detection baseline";
  return `${base}_V${nextVersionNumber(base, existingLabels)}`;
}

export function buildUserPromptTemplate(baseTemplate: string, addendum?: string | null): string {
  const base = String(baseTemplate || "").trim();
  const extra = String(addendum || "").trim();
  if (!extra) return base;
  return [base, `Detection-Specific Addendum:\n${extra}`].filter(Boolean).join("\n\n");
}

const ADDENDUM_MARKER = "Detection-Specific Addendum:";

/**
 * Mandatory evidence directive. This must always be present in the addendum so
 * the model always emits a populated `evidence` field, even for the leanest
 * tuned prompts.
 */
export const EVIDENCE_REQUIREMENT =
  "Evidence: Always populate the evidence field with a short phrase citing the specific visual basis for the decision — the component, its location, and the visible morphology. For NOT_DETECTED, cite the strongest contrary or excluded cue.";

/** True if an addendum already contains an evidence directive. */
function hasEvidenceDirective(addendum: string): boolean {
  return /\bevidence\b/i.test(addendum || "");
}

/**
 * Guarantee the addendum contains the evidence requirement. Never returns an
 * empty string — an empty/whitespace addendum becomes the evidence requirement
 * alone, and an addendum lacking an evidence directive gets it appended.
 */
export function ensureEvidenceRequirement(addendum?: string | null): string {
  const trimmed = String(addendum || "").trim();
  if (!trimmed) return EVIDENCE_REQUIREMENT;
  if (hasEvidenceDirective(trimmed)) return trimmed;
  return `${trimmed}\n\n${EVIDENCE_REQUIREMENT}`;
}

/**
 * Split a compiled user prompt template into its fixed base (task + schema block)
 * and the editable detection-specific addendum. Inverse of
 * `buildUserPromptTemplate`. If no addendum marker is present, the whole string
 * is treated as the base with an empty addendum.
 */
export function splitUserPromptTemplate(template: string): { base: string; addendum: string } {
  const full = String(template || "");
  const idx = full.indexOf(ADDENDUM_MARKER);
  if (idx < 0) return { base: full.trim(), addendum: "" };
  const base = full.slice(0, idx).trim();
  const addendum = full.slice(idx + ADDENDUM_MARKER.length).trim();
  return { base, addendum };
}

/**
 * Assemble the full compiled USER message sent to the model. The strict JSON
 * schema contract lives inside the admin-managed user_prompt_template (so what
 * runs at inference is exactly what shows up in the admin UI) — this function
 * only substitutes {{DETECTION_CODE}} and appends the addendum, fixed guidance,
 * decision policy, and decision rubric. Used by BOTH the inference providers and
 * the compiled-prompt preview so what the user sees always matches what runs.
 */
export function compileUserPrompt(params: {
  userTemplate: string;
  detectionCode: string;
  fixedGuidance?: string | null;
  labelPolicy?: string | null;
  decisionRubric?: string | null;
}): string {
  const code = params.detectionCode;
  const sub = (s: string) => s.replace(/\{\{DETECTION_CODE\}\}/g, code);
  const { base, addendum } = splitUserPromptTemplate(params.userTemplate);
  const fixedGuidance = String(params.fixedGuidance || "").trim();
  const labelPolicy = String(params.labelPolicy || "").trim();
  const decisionRubric = String(params.decisionRubric || "").trim();

  return [
    sub(base).trim(),
    addendum ? `${ADDENDUM_MARKER}\n${sub(addendum)}` : "",
    fixedGuidance ? `Detection Guidelines (fixed):\n${fixedGuidance}` : "",
    labelPolicy ? `Decision Policy:\n${labelPolicy}` : "",
    decisionRubric ? `Decision Rubric:\n${decisionRubric}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

