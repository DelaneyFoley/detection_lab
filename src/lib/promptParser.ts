export interface ParsedPrompt {
  user_prompt_addendum: string;
  label_policy_detected: string;
  label_policy_not_detected: string;
  decision_rubric: string[];
  segment_taxonomy: string[];
}

const SECTION_HEADERS = [
  "Detection-Specific Addendum:",
  "Decision Policy:",
  "Decision Rubric:",
  "Attributes:",
] as const;

function findSectionIndices(text: string): { header: string; index: number }[] {
  const indices: { header: string; index: number }[] = [];
  for (const header of SECTION_HEADERS) {
    const idx = text.indexOf(header);
    if (idx !== -1) {
      indices.push({ header, index: idx });
    }
  }
  return indices.sort((a, b) => a.index - b.index);
}

function extractBetween(text: string, startAfterHeader: string, startIdx: number, nextIdx: number | undefined): string {
  const contentStart = startIdx + startAfterHeader.length;
  const content = nextIdx !== undefined ? text.slice(contentStart, nextIdx) : text.slice(contentStart);
  return content.trim();
}

function parseDecisionPolicy(content: string): { detected: string; notDetected: string } {
  const detected: string[] = [];
  const notDetected: string[] = [];
  let current: "detected" | "notDetected" | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (/^DETECTED\s*[:\-–—]/i.test(trimmed)) {
      current = "detected";
      const after = trimmed.replace(/^DETECTED\s*[:\-–—]\s*/i, "").trim();
      if (after) detected.push(after);
    } else if (/^NOT[_\s]?DETECTED\s*[:\-–—]/i.test(trimmed)) {
      current = "notDetected";
      const after = trimmed.replace(/^NOT[_\s]?DETECTED\s*[:\-–—]\s*/i, "").trim();
      if (after) notDetected.push(after);
    } else if (trimmed && current) {
      if (current === "detected") detected.push(trimmed);
      else notDetected.push(trimmed);
    }
  }

  return {
    detected: detected.join("\n"),
    notDetected: notDetected.join("\n"),
  };
}

function parseRubricItems(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim().replace(/^\d+\.\s*/, ""))
    .filter(Boolean);
}

function parseAttributes(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
}

export function parseCompiledPrompt(text: string): ParsedPrompt {
  const sections = findSectionIndices(text);

  let addendum = "";
  let policyContent = "";
  let rubricContent = "";
  let attributesContent = "";

  for (let i = 0; i < sections.length; i++) {
    const { header, index } = sections[i];
    const nextIndex = i + 1 < sections.length ? sections[i + 1].index : undefined;
    const content = extractBetween(text, header, index, nextIndex);

    switch (header) {
      case "Detection-Specific Addendum:":
        addendum = content;
        break;
      case "Decision Policy:":
        policyContent = content;
        break;
      case "Decision Rubric:":
        rubricContent = content;
        break;
      case "Attributes:":
        attributesContent = content;
        break;
    }
  }

  const policy = parseDecisionPolicy(policyContent);

  return {
    user_prompt_addendum: addendum,
    label_policy_detected: policy.detected,
    label_policy_not_detected: policy.notDetected,
    decision_rubric: parseRubricItems(rubricContent),
    segment_taxonomy: parseAttributes(attributesContent),
  };
}
