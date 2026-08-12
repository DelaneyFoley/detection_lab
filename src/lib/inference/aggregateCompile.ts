// Pure aggregate-prompt compilation shared by the server inference path and the
// client authoring UI. Kept free of the Google SDK so it is safe to import in
// browser components.

// Production numbers the first detection as "1. When you see this description:".
export const AGG_MARKER = "\n\n1. When you see this description:";

/**
 * Recover the shared preamble from a frozen snapshot's built prompt so the
 * aggregate can be recompiled after editing. Uses the frozen preamble (not a
 * hardcoded copy) to avoid drift from production.
 */
export function extractPreamble(builtPrompt: string): string {
  const idx = builtPrompt.indexOf(AGG_MARKER);
  return idx >= 0 ? builtPrompt.slice(0, idx) : builtPrompt;
}

/**
 * Reproduce production's `Context.build_prompt()` from ordered members: the
 * shared preamble followed by numbered "When you see … apply this label" blocks.
 */
export function compileAggregatePrompt(
  preamble: string,
  members: Array<{ label: string; description: string }>
): string {
  if (members.length === 0) return preamble;
  const detectionText = members
    .map((m, i) => `${i + 1}. When you see this description:\n${m.description}\n\napply this label: ${m.label}`)
    .join("\n\n");
  return `${preamble}\n\n${detectionText}`;
}
