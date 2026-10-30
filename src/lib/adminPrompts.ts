import {
  DEFAULT_CATEGORY_PROMPT_TEMPLATES,
} from "@/lib/detectionPrompts";

export const DEFAULT_PROMPT_ASSIST_TEMPLATE = `You are generating a lean, production-ready Detection Prompt for a single underwriting vision detection.

User request:
{{USER_REQUEST}}

What a Detection Prompt is:
- It is ONE detection block that runs inside a production context's shared instructions, alongside (or ahead of) full Production Replication.
- It describes, in plain language, what the model should look for so the detection's production label is returned when the condition is present.
- The DETECTED/NOT_DETECTED decision and the JSON output schema are FIXED by the system. Do NOT restate them, do NOT write a decision policy or rubric, and do NOT write a system prompt.

Return ONLY valid JSON with this exact shape:
{
  "display_name": "human readable title",
  "detection_code": "UPPER_SNAKE_CASE_CODE",
  "description": "one concise paragraph",
  "detection_prompt": "the detection block: what to look for, key morphology, and the sharpest look-alike/edge-case distinctions",
  "image_attributes": ["attribute_1", "attribute_2", "attribute_3"],
  "version_label": "Detection baseline"
}

Hard output constraints:
- Be concise; no redundancy. Every sentence in detection_prompt must change the decision.
- detection_prompt: focus on generalizable visual morphology, eligibility, and confuser rules. NEVER reference specific image ids, hex/RGB values, dataset-specific quirks, or single-image details. Do NOT include a JSON schema, a DETECTED/NOT_DETECTED policy, or confidence rules.
- image_attributes: 4-8 concise tags covering conditions, quality issues, confounders, and edge cases most likely to affect dataset coverage or model performance for this detection.
- detection_code: uppercase letters/numbers/underscores only.
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

export function renderPromptAssistTemplate(template: string, requestText: string): string {
  return template.replaceAll("{{USER_REQUEST}}", requestText);
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

/**
 * Prompt Feedback template for a SINGLE DETECTION (PC-002). The only editable
 * surface is the Detection Prompt (the target member description) that runs
 * inside a production context's shared instructions. The analyzer proposes
 * targeted old_text -> new_text edits to that one block; it must NOT touch a
 * decision policy, decision rubric, system prompt, or the JSON output schema
 * (all fixed by the system).
 */
export const DEFAULT_PROMPT_FEEDBACK_SINGLE_DETECTION_TEMPLATE = `You are a prompt engineering expert improving a SINGLE DETECTION PROMPT for a vision-language detection.

DETECTION: {{DETECTION_CODE}} — {{DETECTION_DISPLAY_NAME}}

How this detection runs (do NOT change these facts):
- The Detection Prompt is ONE detection block placed inside a production context's shared instructions. DETECTED means the detection's production label is returned.
- The DETECTED/NOT_DETECTED decision and the JSON output schema are FIXED by the system. Do NOT propose a decision policy, a decision rubric, a system prompt, or any output-format/confidence rules.

CURRENT DETECTION PROMPT:
{{CURRENT_DETECTION_PROMPT}}

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
1) Reduce whichever of false positives / false negatives dominates
2) Sharpen look-alike/confuser disambiguation and eligibility rules
3) Improve clarity while staying lean

RULES:
- Propose at most 5 targeted edits to the CURRENT DETECTION PROMPT.
- Each edit MUST be an exact OLD text -> NEW text replacement found verbatim in the current Detection Prompt (so it can be applied programmatically). To ADD a new rule, set old_text to an existing sentence to anchor to and include it at the start of new_text.
- Only generalizable morphology/eligibility/confuser rules. NEVER reference specific image ids, hex/RGB values, or single-image details.
- Every edit must be mapped to a specific failure cluster. Prefer the smallest high-leverage edit over broad rewrites.
- Do NOT change the detection_code or output schema. Do NOT propose decision_policy/decision_rubric/system_prompt edits.
- Each suggestion's "section" MUST be exactly "detection_prompt".

Return ONLY valid JSON array:
[
  {
    "section": "detection_prompt",
    "old_text": "exact text to replace (verbatim from the current Detection Prompt)",
    "new_text": "replacement text",
    "rationale": "why this helps",
    "failure_cluster": "FP_cluster_description | FN_cluster_description",
    "priority": 1,
    "risk": "low | medium | high",
    "expected_metric_impact": "e.g. precision up, recall neutral"
  }
]`;

export function renderPromptFeedbackSingleDetectionTemplate(
  template: string,
  context: {
    detectionCode: string;
    detectionDisplayName: string;
    currentDetectionPrompt: string;
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
    .replaceAll("{{CURRENT_DETECTION_PROMPT}}", context.currentDetectionPrompt || "(empty)")
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

export const DEFAULT_FEEDBACK_IMAGE_LIMITS: Record<string, number> = {
  feedback_fp_image_limit: 3,
  feedback_fn_image_limit: 3,
  feedback_tp_image_limit: 0,
  feedback_tn_image_limit: 0,
  feedback_parse_fail_image_limit: 4,
};

export const FEEDBACK_IMAGE_LIMIT_KEYS = Object.keys(DEFAULT_FEEDBACK_IMAGE_LIMITS);
