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

Important mode handling:
- If the request is "incorrect capture"/context-match style, DETECTED means the image fails the required context and NOT_DETECTED means the image matches context.
- If the request is object/condition detection style, DETECTED means the target condition is present and NOT_DETECTED means absent/not confirmable.
- Infer mode from the request and write policies/rubric accordingly.

Return ONLY valid JSON with this exact shape:
{
  "display_name": "human readable title",
  "detection_code": "UPPER_SNAKE_CASE_CODE",
  "description": "one concise paragraph",
  "system_prompt": "system prompt text",
  "user_prompt_template": "user prompt template text containing {{DETECTION_CODE}}",
  "label_policy_detected": "one sentence",
  "label_policy_not_detected": "one sentence",
  "decision_rubric": ["criterion 1", "criterion 2", "criterion 3", "criterion 4"],
  "version_label": "Detection baseline"
}

Hard output constraints:
- Be concise; no redundancy.
- system_prompt: 2-4 short lines, <= 320 chars total.
- user_prompt_template (excluding the required JSON block): <= 700 chars.
- label_policy_detected: exactly 1 sentence.
- label_policy_not_detected: exactly 1 sentence.
- decision_rubric: 4-6 short, atomic checks in decision order; no numbering prefixes.
- detection_code: uppercase letters/numbers/underscores only.
- Policies must be mutually exclusive and collectively exhaustive.
- Under uncertainty/insufficient evidence use a deterministic conservative default aligned to the chosen mode.
- Explicitly handle lookalikes and image-quality limits in rubric (not by bloating policies).

The user_prompt_template must include exactly this block:

{{REQUIRED_USER_PROMPT_JSON_BLOCK}}

System prompt must enforce:
- JSON only, no markdown/commentary/extra keys.
- Allowed decision values only: DETECTED or NOT_DETECTED.
- confidence must be numeric 0..1.
- Must choose one decision (no null/unknown).

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
