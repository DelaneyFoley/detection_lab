import type {
  EvalPromptComparison,
  PromptDisagreementMetrics,
  SynthesisAnalysis,
} from "@/lib/promptCompare/types";

const pct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "n/a" : `${(n * 100).toFixed(1)}%`;

export interface CompareReportInput {
  detectionCode: string;
  sourcePrompts: Array<{ prompt_version_id: string; label: string }>;
  sharedDatasetCount: number;
  totalDisagreementCount: number;
  imagesAnalyzed: number;
  counterexamplesAnalyzed: number;
  perPromptMetrics: PromptDisagreementMetrics[];
  analysis: SynthesisAnalysis;
  evaluate: boolean;
  evalDatasetSize: number | null;
  evalComparisons: EvalPromptComparison[] | null;
  synthesizedLabel: string | null;
}

/**
 * Markdown report for a prompt-compare synthesis job. Written into the resulting
 * PromptVersion's version_notes so the reader always sees WHERE the merged
 * prompt came from and how it fared vs each source on the disagreement set.
 */
export function generateCompareReport(input: CompareReportInput): string {
  const lines: string[] = [];
  lines.push(`# Prompt synthesis — ${input.detectionCode}`);
  lines.push("");
  lines.push(
    `Merged **${input.sourcePrompts.length}** source prompts using the union of their prompt-vs-prompt and prompt-vs-ground-truth disagreements across **${input.sharedDatasetCount}** shared dataset(s) (${input.totalDisagreementCount} disagreement rows total).`
  );
  lines.push(
    `Analyzer saw ${input.imagesAnalyzed} disagreement image(s) + ${input.counterexamplesAnalyzed} agreement counterexample(s).`
  );
  lines.push("");
  lines.push("## Source prompts");
  for (const sp of input.sourcePrompts) {
    lines.push(`- \`${sp.label}\` (id \`${sp.prompt_version_id}\`)`);
  }
  lines.push("");
  lines.push("## Per-prompt performance on the disagreement set");
  lines.push("| Prompt | P | R | F1 | TP | FP | FN | TN | parse_fail |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const m of input.perPromptMetrics) {
    lines.push(
      `| ${m.label} | ${pct(m.metrics.precision)} | ${pct(m.metrics.recall)} | ${pct(m.metrics.f1)} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${m.parse_fail} |`
    );
  }
  lines.push("");
  lines.push("## Per-prompt strengths & weaknesses (analyzer)");
  for (const a of input.analysis.per_prompt) {
    lines.push(`### ${a.label}`);
    if (a.strengths.length) {
      lines.push("Strengths:");
      for (const s of a.strengths) lines.push(`- ${s}`);
    }
    if (a.weaknesses.length) {
      lines.push("Weaknesses:");
      for (const w of a.weaknesses) lines.push(`- ${w}`);
    }
    lines.push("");
  }
  lines.push("## Synthesized prompt");
  if (input.synthesizedLabel) {
    lines.push(`Saved as **${input.synthesizedLabel}**.`);
  }
  if (input.analysis.synthesis.rationale) {
    lines.push("");
    lines.push(`Rationale: ${input.analysis.synthesis.rationale}`);
  }
  lines.push("");
  if (input.evaluate && input.evalComparisons && input.evalComparisons.length) {
    lines.push(
      `## Evaluation vs sources on the disagreement set (${input.evalDatasetSize ?? "?"} images)`
    );
    lines.push("| Prompt | Source P/R/F1 | Synthesized P/R/F1 | ΔF1 |");
    lines.push("|---|---|---|---|");
    for (const cmp of input.evalComparisons) {
      const dF1 = cmp.synthesized_metrics.f1 - cmp.source_metrics.f1;
      const sign = dF1 >= 0 ? "+" : "";
      lines.push(
        `| ${cmp.label} | ${pct(cmp.source_metrics.precision)}/${pct(cmp.source_metrics.recall)}/${pct(cmp.source_metrics.f1)} | ${pct(cmp.synthesized_metrics.precision)}/${pct(cmp.synthesized_metrics.recall)}/${pct(cmp.synthesized_metrics.f1)} | ${sign}${(dF1 * 100).toFixed(1)} pts |`
      );
    }
    lines.push("");
  } else if (input.evaluate) {
    lines.push("## Evaluation");
    lines.push("_Evaluation did not produce comparable metrics (missing ground truth or evaluation failed)._");
    lines.push("");
  }
  return lines.join("\n");
}
