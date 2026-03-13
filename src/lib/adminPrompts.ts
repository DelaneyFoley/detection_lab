import {
  DEFAULT_CATEGORY_PROMPT_TEMPLATES,
} from "@/lib/detectionPrompts";

export const REQUIRED_USER_PROMPT_JSON_BLOCK = `Return ONLY this JSON:
{
  "detection_code": "{{DETECTION_CODE}}",
  "decision": "DETECTED" or "NOT_DETECTED",
  "confidence": <float 0-1>,
  "evidence": "<short phrase describing visual basis>"
}`;

export const DEFAULT_PROMPT_ASSIST_TEMPLATE = `You are generating a lean, production-ready binary vision detection spec for underwriting.

User request:
{{USER_REQUEST}}

Selected detection category:
{{DETECTION_CATEGORY}}

Important mode handling:
- Respect the selected detection category. Do not infer or change it.
- If the category is INCORRECT_CAPTURE, DETECTED means the image fails the required capture/context standard and NOT_DETECTED means the image is a usable in-context capture.
- If the category is HAZARD_IDENTIFICATION, DETECTED means the target hazard/condition is present and NOT_DETECTED means absent or not visually confirmable.
- Write policies, rubric, and addendum to match the selected category.
- Do not propose or return system prompt text.
- Do not propose or return user prompt template text.

Return ONLY valid JSON with this exact shape:
{
  "display_name": "human readable title",
  "detection_code": "UPPER_SNAKE_CASE_CODE",
  "description": "one concise paragraph",
  "detection_category": "INCORRECT_CAPTURE | HAZARD_IDENTIFICATION",
  "label_policy_detected": "one sentence",
  "label_policy_not_detected": "one sentence",
  "decision_rubric": ["criterion 1", "criterion 2", "criterion 3", "criterion 4"],
  "user_prompt_addendum": "optional detection-specific addendum, may be empty",
  "image_attributes": ["attribute_1", "attribute_2", "attribute_3"],
  "version_label": "Detection baseline"
}

Hard output constraints:
- Be concise; no redundancy.
- detection_category must be exactly INCORRECT_CAPTURE or HAZARD_IDENTIFICATION.
- detection_category must match the selected category exactly.
- label_policy_detected: exactly 1 sentence.
- label_policy_not_detected: exactly 1 sentence.
- decision_rubric: 4-6 short, atomic checks in decision order; no numbering prefixes.
- user_prompt_addendum: optional, concise, detection-specific only. Leave empty if not needed.
- image_attributes: 4-8 concise tags covering conditions, quality issues, confounders, and edge cases most likely to affect dataset coverage or model performance for this detection.
- detection_code: uppercase letters/numbers/underscores only.
- Policies must be mutually exclusive and collectively exhaustive.
- Under uncertainty/insufficient evidence use a deterministic conservative default aligned to the chosen mode.
- Explicitly handle lookalikes and image-quality limits in rubric (not by bloating policies).
- Prefer reusable attribute tags such as snow_on_ground, dark_image, blurry_image, occluded_view, glare, partial_view, far_distance when relevant.

Output only the final JSON object. No markdown. No extra keys.`;

export const DEFAULT_PROMPT_FEEDBACK_TEMPLATE = `You are a prompt engineering expert. Analyze the following detection evaluation results and suggest targeted improvements to the prompt.

DETECTION: {{DETECTION_CODE}} — {{DETECTION_DISPLAY_NAME}}

DETECTION CATEGORY:
{{DETECTION_CATEGORY}}

ADMIN-MANAGED PROMPTS:
- The system prompt and user prompt template are fixed by detection category and cannot be edited here.
- Do not propose changes to the system prompt or user prompt template.

CURRENT DECISION POLICY:
{{CURRENT_DECISION_POLICY}}

CURRENT DECISION RUBRIC:
{{CURRENT_DECISION_RUBRIC}}

CURRENT USER PROMPT ADDENDUM:
{{CURRENT_USER_PROMPT_ADDENDUM}}

FALSE POSITIVES ({{FALSE_POSITIVES_TOTAL}} total, showing up to 5):
{{FALSE_POSITIVES_LIST}}

FALSE NEGATIVES ({{FALSE_NEGATIVES_TOTAL}} total, showing up to 5):
{{FALSE_NEGATIVES_LIST}}

REPRESENTATIVE TRUE POSITIVES:
{{TRUE_POSITIVES_LIST}}

REPRESENTATIVE TRUE NEGATIVES:
{{TRUE_NEGATIVES_LIST}}

REVIEWER ERROR TAGS:
{{ERROR_TAGS_LIST}}

PARSE FAILURES ({{PARSE_FAIL_TOTAL}} total, showing up to 5):
{{PARSE_FAIL_LIST}}

PRIORITY ORDER:
1) Eliminate parse failures first (critical reliability objective)
2) Reduce high-confidence false positives/false negatives
3) Improve clarity/calibration while preserving schema compliance

RULES:
- Propose at most 5 targeted edits
- Each edit should be mapped to a specific failure cluster
- Do NOT rewrite the entire prompt
- Do NOT change the detection_code or output schema
- Do NOT propose or imply edits to the system prompt or user prompt template
- Only use these editable sections: decision_policy | decision_rubric | user_prompt_addendum
- Choose the section where the edit would be most impactful and makes the most sense for the observed failure pattern
- Prefer the smallest high-leverage edit over broad rewrites
- Use decision_policy for boundary/label-definition problems
- Use decision_rubric for operational decision logic, ordering, and lookalike disambiguation
- Use user_prompt_addendum for narrow detection-specific clarifications that do not belong in the shared category template
- Do NOT change decision policy unless it's clearly the root cause
- Include at least 1 parse-failure mitigation edit if parse failures exist
- Present each as exact OLD text -> NEW text replacement

Return ONLY valid JSON array:
[
  {
    "section": "decision_policy | decision_rubric | user_prompt_addendum",
    "old_text": "exact text to replace",
    "new_text": "replacement text",
    "rationale": "why this helps",
    "failure_cluster": "parse_fail | FP_cluster_description | FN_cluster_description",
    "priority": 1,
    "risk": "low | medium | high",
    "expected_metric_impact": "e.g. precision up, recall neutral",
    "expected_parse_fail_impact": "e.g. reduce parse failures by tightening output contract"
  }
]`;

export const DEFAULT_INCORRECT_CAPTURE_SYSTEM_PROMPT =
  DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.system_prompt;
export const DEFAULT_INCORRECT_CAPTURE_USER_PROMPT =
  DEFAULT_CATEGORY_PROMPT_TEMPLATES.INCORRECT_CAPTURE.user_prompt_template;
export const DEFAULT_HAZARD_IDENTIFICATION_SYSTEM_PROMPT =
  DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.system_prompt;
export const DEFAULT_HAZARD_IDENTIFICATION_USER_PROMPT =
  DEFAULT_CATEGORY_PROMPT_TEMPLATES.HAZARD_IDENTIFICATION.user_prompt_template;

export function renderPromptAssistTemplate(template: string, requestText: string, detectionCategory: string): string {
  return template
    .replaceAll("{{USER_REQUEST}}", requestText)
    .replaceAll("{{DETECTION_CATEGORY}}", detectionCategory)
    .replaceAll("{{REQUIRED_USER_PROMPT_JSON_BLOCK}}", REQUIRED_USER_PROMPT_JSON_BLOCK);
}

export function renderPromptFeedbackTemplate(
  template: string,
  context: {
    detectionCode: string;
    detectionDisplayName: string;
    detectionCategory: string;
    currentDecisionPolicy: string;
    currentDecisionRubric: string;
    currentUserPromptAddendum: string;
    falsePositivesTotal: number;
    falsePositivesList: string;
    falseNegativesTotal: number;
    falseNegativesList: string;
    truePositivesList: string;
    trueNegativesList: string;
    errorTagsList: string;
    parseFailTotal: number;
    parseFailList: string;
  }
): string {
  return template
    .replaceAll("{{DETECTION_CODE}}", context.detectionCode)
    .replaceAll("{{DETECTION_DISPLAY_NAME}}", context.detectionDisplayName)
    .replaceAll("{{DETECTION_CATEGORY}}", context.detectionCategory)
    .replaceAll("{{CURRENT_DECISION_POLICY}}", context.currentDecisionPolicy)
    .replaceAll("{{CURRENT_DECISION_RUBRIC}}", context.currentDecisionRubric)
    .replaceAll("{{CURRENT_USER_PROMPT_ADDENDUM}}", context.currentUserPromptAddendum)
    .replaceAll("{{FALSE_POSITIVES_TOTAL}}", String(context.falsePositivesTotal))
    .replaceAll("{{FALSE_POSITIVES_LIST}}", context.falsePositivesList)
    .replaceAll("{{FALSE_NEGATIVES_TOTAL}}", String(context.falseNegativesTotal))
    .replaceAll("{{FALSE_NEGATIVES_LIST}}", context.falseNegativesList)
    .replaceAll("{{TRUE_POSITIVES_LIST}}", context.truePositivesList)
    .replaceAll("{{TRUE_NEGATIVES_LIST}}", context.trueNegativesList)
    .replaceAll("{{ERROR_TAGS_LIST}}", context.errorTagsList)
    .replaceAll("{{PARSE_FAIL_TOTAL}}", String(context.parseFailTotal))
    .replaceAll("{{PARSE_FAIL_LIST}}", context.parseFailList);
}
