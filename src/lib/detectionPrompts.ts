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

export const DEFAULT_CATEGORY_PROMPT_TEMPLATES: Record<
  DetectionCategory,
  { system_prompt: string; user_prompt_template: string }
> = {
  INCORRECT_CAPTURE: {
    system_prompt:
      "You are a property underwriting image validation system. Determine whether the image is an incorrect capture for the requested inspection objective. Return only valid JSON that matches the required schema.",
    user_prompt_template:
      'Determine whether this image is an incorrect capture for detection code {{DETECTION_CODE}}.\n\nDETECTED means the image fails the required capture context and should be rejected.\nNOT_DETECTED means the image is a usable, in-context capture.\n\nReturn ONLY this JSON:\n{\n  "detection_code": "{{DETECTION_CODE}}",\n  "decision": "DETECTED" or "NOT_DETECTED",\n  "confidence": <float 0-1>,\n  "evidence": "<short phrase describing visual basis>"\n}',
  },
  HAZARD_IDENTIFICATION: {
    system_prompt:
      "You are a property underwriting hazard detection system. Analyze one image for the requested hazard or condition and return only valid JSON that matches the required schema.",
    user_prompt_template:
      'Analyze this image for detection code {{DETECTION_CODE}}.\n\nDETECTED means the target hazard or condition is present or visually confirmed.\nNOT_DETECTED means it is absent or not visually confirmed.\n\nReturn ONLY this JSON:\n{\n  "detection_code": "{{DETECTION_CODE}}",\n  "decision": "DETECTED" or "NOT_DETECTED",\n  "confidence": <float 0-1>,\n  "evidence": "<short phrase describing visual basis>"\n}',
  },
};

export function normalizeDetectionCategory(value: unknown): DetectionCategory {
  return value === "INCORRECT_CAPTURE" ? "INCORRECT_CAPTURE" : DEFAULT_DETECTION_CATEGORY;
}

export function buildUserPromptTemplate(baseTemplate: string, addendum?: string | null): string {
  const base = String(baseTemplate || "").trim();
  const extra = String(addendum || "").trim();
  if (!extra) return base;
  return [base, `Detection-Specific Addendum:\n${extra}`].filter(Boolean).join("\n\n");
}

