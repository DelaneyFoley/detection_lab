export const REQUIRED_USER_PROMPT_JSON_BLOCK = `Return ONLY this JSON:
{
  "detection_code": "{{DETECTION_CODE}}",
  "decision": "DETECTED" or "NOT_DETECTED",
  "confidence": <float 0-1>,
  "evidence": "<short phrase describing visual basis>"
}`;

export const DEFAULT_PROMPT_ASSIST_TEMPLATE = `You are a principal staff-level prompt engineer and property insurance underwriting SME.

Goal:
Generate a production-grade binary detection spec for VLM evaluation in underwriting workflows.
Optimize for:
- high precision under ambiguity
- auditability
- reproducibility
- strict JSON-output compliance in downstream inference

User request:
{{USER_REQUEST}}

Return ONLY valid JSON with this exact shape:
{
  "display_name": "human readable title",
  "detection_code": "UPPER_SNAKE_CASE_CODE",
  "description": "one concise paragraph",
  "system_prompt": "system prompt text",
  "user_prompt_template": "user prompt template text containing {{DETECTION_CODE}}",
  "label_policy_detected": "criteria for DETECTED",
  "label_policy_not_detected": "criteria for NOT_DETECTED",
  "decision_rubric": ["criterion 1", "criterion 2", "criterion 3", "criterion 4"],
  "version_label": "Detection baseline"
}

Hard requirements:
- detection_code: uppercase letters/numbers/underscores only; stable and specific.
- decision_rubric: 4-7 atomic, observable checks in decision order.
- Policies must be mutually exclusive and collectively exhaustive for DETECTED vs NOT_DETECTED.
- Include explicit anti-confusion guidance (common lookalikes, occlusion, blur, glare, shadows, artifacts).
- Default behavior under uncertainty must be conservative and deterministic.
- Language must be concise, auditable, and testable (no vague words like "maybe", "appears" without criteria).
- user_prompt_template must require strict JSON-only output and include exactly this block:

{{REQUIRED_USER_PROMPT_JSON_BLOCK}}

System prompt quality requirements:
- Enforce: no markdown, no commentary, no extra keys.
- Enforce exact schema and allowed decision values.
- Enforce confidence range 0..1 numeric.
- Instruct model to choose one decision even under uncertainty (no null/unknown).
- Keep instructions short, unambiguous, and operational.

Before finalizing internally, run this checklist:
1) Is DETECTED threshold visually explicit and strict?
2) Is NOT_DETECTED default clear for ambiguous/insufficient evidence?
3) Are lookalikes explicitly excluded?
4) Does rubric map directly to policy and final decision?
5) Is downstream JSON parse success highly likely?

Output only the final JSON object. No markdown. No extra keys.`;

export const DEFAULT_PROMPT_FEEDBACK_TEMPLATE = `You are a prompt engineering expert. Analyze the following detection evaluation results and suggest targeted improvements to the prompt.

DETECTION: {{DETECTION_CODE}} — {{DETECTION_DISPLAY_NAME}}

CURRENT SYSTEM PROMPT:
{{CURRENT_SYSTEM_PROMPT}}

CURRENT USER PROMPT TEMPLATE:
{{CURRENT_USER_PROMPT_TEMPLATE}}

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
- Do NOT change decision policy unless it's clearly the root cause
- Include at least 1 parse-failure mitigation edit if parse failures exist
- Allow section values: system_prompt | user_prompt_template | decision_policy | decision_rubric
- Present each as exact OLD text -> NEW text replacement

Return ONLY valid JSON array:
[
  {
    "section": "system_prompt | user_prompt_template | decision_policy | decision_rubric",
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

export function renderPromptAssistTemplate(template: string, requestText: string): string {
  return template
    .replaceAll("{{USER_REQUEST}}", requestText)
    .replaceAll("{{REQUIRED_USER_PROMPT_JSON_BLOCK}}", REQUIRED_USER_PROMPT_JSON_BLOCK);
}

export function renderPromptFeedbackTemplate(
  template: string,
  context: {
    detectionCode: string;
    detectionDisplayName: string;
    currentSystemPrompt: string;
    currentUserPromptTemplate: string;
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
    .replaceAll("{{CURRENT_SYSTEM_PROMPT}}", context.currentSystemPrompt)
    .replaceAll("{{CURRENT_USER_PROMPT_TEMPLATE}}", context.currentUserPromptTemplate)
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
