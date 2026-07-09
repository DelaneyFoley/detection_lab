import type {
  CandidateResult,
  CoreMetrics,
  FailureMode,
  RoundSummary,
  SelectionResult,
} from "@/lib/promptIteration/types";

export interface RegressionCounts {
  fp_fixed: number;
  fn_fixed: number;
  new_false_positives: number;
  new_false_negatives: number;
}

export interface ReportInput {
  sourceVersionLabel: string;
  newVersionLabel: string | null;
  goalF1: number | null;
  baseline: CoreMetrics;
  selection: SelectionResult;
  candidates: CandidateResult[];
  failureModes: FailureMode[];
  regression: RegressionCounts;
  guardrails: string[];
  holdoutSize: number;
  tuningSize: number;
  rounds?: RoundSummary[];
  baselineParseErrors?: number;
}

const pct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "n/a" : `${(n * 100).toFixed(1)}%`;

const delta = (before: number, after: number): string => {
  const d = (after - before) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)} pts`;
};

/**
 * Build the final human-readable iteration report (Markdown). This is written
 * into the Prompt Versions "Version Notes / Observations" section and is also
 * returned to the HIL UI. Pure and deterministic for easy testing.
 */
export function generateIterationReport(input: ReportInput): string {
  const { baseline, selection, candidates, failureModes, regression, guardrails } = input;
  const sel = selection.selected;
  const selMetrics = sel?.metrics ?? null;
  const promoted = Boolean(sel);

  const lines: string[] = [];

  // ── Summary ───────────────────────────────────────────────────────────────
  lines.push("## AI Prompt Iteration Report");
  lines.push("");
  lines.push("### Summary");
  if (promoted && selMetrics) {
    lines.push(
      `Promoted **${input.newVersionLabel ?? "a new prompt version"}** tuned from ` +
        `**${input.sourceVersionLabel}**. Holdout F1 moved ${pct(baseline.f1)} → ${pct(selMetrics.f1)} ` +
        `(${delta(baseline.f1, selMetrics.f1)}).`
    );
  } else {
    lines.push(
      `No candidate safely improved on **${input.sourceVersionLabel}** under the anti-overfitting ` +
        `guardrails, so the current prompt was kept. This report documents the analysis for auditability.`
    );
  }
  if (input.goalF1 != null) {
    lines.push(
      `Operator goal F1: **${pct(input.goalF1)}** — ${selection.goal_met ? "met ✅" : "not met ⚠️"}.`
    );
  }
  lines.push(`Evaluated on a held-out slice of ${input.holdoutSize} images (tuning slice: ${input.tuningSize}).`);
  lines.push("");

  // ── Baseline performance ────────────────────────────────────────────────────
  lines.push("### Baseline performance");
  lines.push(
    `Precision ${pct(baseline.precision)} · Recall ${pct(baseline.recall)} · ` +
      `F1 ${pct(baseline.f1)} · Accuracy ${pct(baseline.accuracy)}.`
  );
  if ((input.baselineParseErrors ?? 0) > 0) {
    lines.push(
      `⚠️ Baseline produced **${input.baselineParseErrors} parse error(s)**. Parse errors are unacceptable, ` +
        `so only candidates that emit strictly schema-valid output on every holdout image are eligible.`
    );
  }
  lines.push("");

  // ── Selected prompt performance ─────────────────────────────────────────────
  lines.push("### Selected prompt performance");
  if (promoted && selMetrics) {
    lines.push(
      `Precision ${pct(selMetrics.precision)} (${delta(baseline.precision, selMetrics.precision)}) · ` +
        `Recall ${pct(selMetrics.recall)} (${delta(baseline.recall, selMetrics.recall)}) · ` +
        `F1 ${pct(selMetrics.f1)} (${delta(baseline.f1, selMetrics.f1)}).`
    );
    lines.push(
      `False positives fixed: ${regression.fp_fixed} · False negatives fixed: ${regression.fn_fixed} · ` +
        `New FPs: ${regression.new_false_positives} · New FNs: ${regression.new_false_negatives}.`
    );
  } else {
    lines.push("No prompt was promoted; baseline remains in effect.");
  }
  lines.push("");

  // ── Round-by-round progression ──────────────────────────────────────────────
  const rounds = input.rounds ?? [];
  if (rounds.length > 0) {
    lines.push("### Round-by-round progression");
    lines.push("");
    lines.push("| Round | Version | Precision | Recall | F1 | Complexity | Parse err | Outcome |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rounds) {
      const outcome = !r.promoted ? "no promotion (stopped)" : r.is_best ? "**★ best**" : "promoted";
      lines.push(
        `| ${r.round} | ${r.promoted ? r.label : "—"} | ${pct(r.precision)} | ${pct(r.recall)} | ` +
          `${pct(r.f1)} | ${r.complexity} | ${r.parse_errors} | ${outcome} |`
      );
    }
    lines.push("");
    lines.push("Each promoted round was saved as its own prompt version + evaluation run for inspection.");
    lines.push("");
  }

  // ── Candidate comparison table ──────────────────────────────────────────────
  lines.push("### Candidate comparison table");
  lines.push("");
  lines.push("| Candidate | Kind | Precision | Recall | F1 | Complexity | Parse err | Status |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of candidates) {
    const isSel = sel && c.candidate.id === sel.candidate.id;
    const status = c.eval_error
      ? "eval error"
      : isSel
        ? "**selected**"
        : c.rejected_reasons.length > 0
          ? `rejected (${c.rejected_reasons[0]})`
          : "viable";
    lines.push(
      `| ${c.candidate.label} | ${c.candidate.kind} | ${pct(c.metrics.precision)} | ${pct(c.metrics.recall)} | ` +
        `${pct(c.metrics.f1)} | ${c.complexity} | ${c.parse_errors} | ${status} |`
    );
  }
  lines.push("");

  // ── Failure modes found ─────────────────────────────────────────────────────
  lines.push("### Failure modes found");
  if (failureModes.length === 0) {
    lines.push("No dominant FP/FN failure mode detected in the reviewed set.");
  } else {
    for (const m of failureModes) {
      lines.push(`- **${m.name}** — ${m.count} case(s).`);
    }
  }
  lines.push("");

  // ── Prompt changes made ─────────────────────────────────────────────────────
  lines.push("### Prompt changes made");
  if (promoted && sel) {
    lines.push(`Target failure mode: ${sel.candidate.target_failure_mode || "general refinement"}.`);
    lines.push(`Rationale: ${sel.candidate.rationale || "n/a"}`);
  } else {
    lines.push("None promoted.");
  }
  lines.push("");

  // ── Generalization safeguards ───────────────────────────────────────────────
  lines.push("### Generalization safeguards");
  for (const g of guardrails) lines.push(`- ${g}`);
  lines.push("");

  // ── Regressions or risks ────────────────────────────────────────────────────
  lines.push("### Regressions or risks");
  if (promoted) {
    if (regression.new_false_positives === 0 && regression.new_false_negatives === 0) {
      lines.push("No new false positives or false negatives introduced on the holdout.");
    } else {
      lines.push(
        `Introduced ${regression.new_false_positives} new FP(s) and ${regression.new_false_negatives} new FN(s) ` +
          `on the holdout — monitor on the next unseen dataset.`
      );
    }
  } else {
    lines.push("No changes promoted, so no new regressions were introduced.");
  }
  lines.push("");

  // ── Recommended next experiment ─────────────────────────────────────────────
  lines.push("### Recommended next experiment");
  if (!promoted) {
    lines.push(
      "Gather more reviewed examples of the dominant failure mode, then re-run iteration; " +
        "the current sample was insufficient to justify a safe change."
    );
  } else if (input.goalF1 != null && !selection.goal_met) {
    lines.push(
      "Goal F1 not yet reached — collect additional reviewed data (especially the residual failure mode) " +
        "and re-run iteration with the promoted prompt as the new baseline."
    );
  } else if (selMetrics && selMetrics.recall < selMetrics.precision - 0.1) {
    lines.push("Recall trails precision — next iteration should target the remaining false-negative morphology.");
  } else {
    lines.push("Validate the promoted prompt on a fresh unseen dataset before approving it for production.");
  }
  lines.push("");

  return lines.join("\n");
}
