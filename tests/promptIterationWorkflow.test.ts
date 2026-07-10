import { describe, it, expect } from "vitest";
import { toReviewedRows, summarizeReviewedRows, summarizeFailureModes, collectFailureImages } from "@/lib/promptIteration/packaging";
import { buildPromptVersionInput, aiVersionLabel, parseGoalF1, parseLeanPreference, applyCandidateUserTemplate } from "@/lib/promptIteration/saving";
import { buildCandidatePromptVersion, computeRegressionCounts, type EvalPrediction } from "@/lib/promptIteration/evaluation";
import { generateIterationReport } from "@/lib/promptIteration/report";
import { splitUserPromptTemplate, buildUserPromptTemplate, ensureEvidenceRequirement, EVIDENCE_REQUIREMENT } from "@/lib/detectionPrompts";
import { normalizeLabelPolicy, normalizeDecisionRubric } from "@/lib/promptIteration/candidateGen";
import type { PromptCandidate, ReviewedRow, SelectionResult, CandidateResult } from "@/lib/promptIteration/types";
import type { Prediction } from "@/types";

function pred(p: Partial<Prediction>): Prediction {
  return {
    prediction_id: p.prediction_id || "pid",
    run_id: "run",
    image_id: p.image_id || "img",
    image_uri: p.image_uri || "uri",
    ground_truth_label: p.ground_truth_label ?? null,
    predicted_decision: p.predicted_decision ?? null,
    confidence: p.confidence ?? null,
    evidence: p.evidence ?? null,
    parse_ok: p.parse_ok ?? true,
    raw_response: p.raw_response ?? "{}",
    parse_error_reason: p.parse_error_reason ?? null,
    parse_fix_suggestion: p.parse_fix_suggestion ?? null,
    inference_runtime_ms: p.inference_runtime_ms ?? null,
    parse_retry_count: p.parse_retry_count ?? 0,
    corrected_label: p.corrected_label ?? null,
    error_tag: p.error_tag ?? null,
    reviewer_note: p.reviewer_note ?? null,
    image_description: p.image_description ?? null,
    corrected_at: p.corrected_at ?? null,
  };
}

const candidate: PromptCandidate = {
  id: "cand-1",
  kind: "lean",
  label: "Lean refactor",
  target_failure_mode: "false positives",
  rationale: "trims redundancy",
  label_policy: "NEW POLICY",
  decision_rubric: "NEW RUBRIC",
};

describe("packaging.toReviewedRows", () => {
  it("uses reviewer correction as finalized ground truth", () => {
    const rows = toReviewedRows([
      pred({ image_id: "a", ground_truth_label: "NOT_DETECTED", corrected_label: "DETECTED", predicted_decision: "DETECTED" }),
    ]);
    expect(rows[0].finalized_ground_truth).toBe("DETECTED");
    expect(rows[0].original_ground_truth).toBe("NOT_DETECTED");
    expect(rows[0].outcome).toBe("TP");
  });

  it("prefers reviewer_note then image_description for notes", () => {
    const withNote = toReviewedRows([pred({ reviewer_note: "note", image_description: "desc" })]);
    expect(withNote[0].reviewer_note).toBe("note");
    const withDesc = toReviewedRows([pred({ reviewer_note: null, image_description: "desc" })]);
    expect(withDesc[0].reviewer_note).toBe("desc");
  });

  it("summarizes counts and reviewer corrections", () => {
    const rows = toReviewedRows([
      pred({ image_id: "a", ground_truth_label: "DETECTED", predicted_decision: "DETECTED" }), // TP
      pred({ image_id: "b", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED" }), // FP
      pred({ image_id: "c", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED" }), // FN
      pred({ image_id: "d", ground_truth_label: "NOT_DETECTED", corrected_label: "DETECTED", predicted_decision: "DETECTED" }), // corrected → TP
    ]);
    const s = summarizeReviewedRows(rows);
    expect(s).toMatchObject({ total: 4, tp: 2, fp: 1, fn: 1, reviewer_corrections: 1 });
  });

  it("groups FP and FN failure modes without leaking image ids", () => {
    const rows: ReviewedRow[] = toReviewedRows([
      pred({ image_id: "x1", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED", evidence: "shiny surface" }),
      pred({ image_id: "x2", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED", evidence: "faint pitting" }),
    ]);
    const modes = summarizeFailureModes(rows);
    const serialized = JSON.stringify(modes);
    expect(modes.find((m) => m.kind === "FP")?.count).toBe(1);
    expect(modes.find((m) => m.kind === "FN")?.count).toBe(1);
    expect(serialized).not.toContain("x1");
    expect(serialized).not.toContain("x2");
  });

  it("prefers the reviewer note over the model's evidence in failure examples", () => {
    const rows = toReviewedRows([
      pred({ image_id: "n1", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED", evidence: "only minor oxidation", reviewer_note: "textured rust at the union" }),
    ]);
    const modes = summarizeFailureModes(rows);
    const fn = modes.find((m) => m.kind === "FN");
    expect(fn?.example_evidence).toContain("textured rust at the union");
    expect(fn?.example_evidence).not.toContain("only minor oxidation");
  });
});

describe("packaging.collectFailureImages", () => {
  it("collects only FP/FN images, interleaved FN-first, with ground truth", () => {
    const rows = toReviewedRows([
      pred({ image_id: "tp", image_uri: "tp.jpg", ground_truth_label: "DETECTED", predicted_decision: "DETECTED" }),
      pred({ image_id: "fn1", image_uri: "fn1.jpg", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED", reviewer_note: "rust ringing the inlet nipple" }),
      pred({ image_id: "fp1", image_uri: "fp1.jpg", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED" }),
      pred({ image_id: "fn2", image_uri: "fn2.jpg", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED" }),
    ]);
    const imgs = collectFailureImages(rows);
    expect(imgs.map((i) => i.image_uri)).toEqual(["fn1.jpg", "fp1.jpg", "fn2.jpg"]);
    expect(imgs.map((i) => i.outcome)).toEqual(["FN", "FP", "FN"]);
    expect(imgs[0].ground_truth).toBe("DETECTED");
    expect(imgs[0].reviewer_note).toBe("rust ringing the inlet nipple");
    expect(imgs[1].ground_truth).toBe("NOT_DETECTED");
  });

  it("skips failures that have no image uri", () => {
    const row: ReviewedRow = {
      image_id: "fn",
      image_uri: "",
      original_ground_truth: "DETECTED",
      finalized_ground_truth: "DETECTED",
      ai_predicted: "NOT_DETECTED",
      ai_evidence: null,
      reviewer_note: null,
      attributes: [],
      confidence: null,
      parse_ok: true,
      outcome: "FN",
    };
    expect(collectFailureImages([row])).toHaveLength(0);
  });
});

describe("saving helpers", () => {
  it("aiVersionLabel derives from source", () => {
    expect(aiVersionLabel("v3.0")).toBe("v3.0-ai");
    expect(aiVersionLabel("")).toBe("prompt-ai");
  });

  it("aiVersionLabel adds round suffixes and strips prior ai suffixes", () => {
    expect(aiVersionLabel("V1", 1)).toBe("V1-ai-r1");
    expect(aiVersionLabel("V1", 3)).toBe("V1-ai-r3");
    // Re-tuning an already-tuned label keeps a clean root.
    expect(aiVersionLabel("V1-ai-r1", 2)).toBe("V1-ai-r2");
    expect(aiVersionLabel("V1-ai", 2)).toBe("V1-ai-r2");
  });

  it("aiVersionLabel disambiguates separate iteration batches", () => {
    expect(aiVersionLabel("V1", 1, 1)).toBe("V1-ai-r1"); // batch 1 stays clean
    expect(aiVersionLabel("V1", 1, 2)).toBe("V1-ai-b2-r1");
    expect(aiVersionLabel("V1", 3, 3)).toBe("V1-ai-b3-r3");
    // Stripping handles a prior batched label too.
    expect(aiVersionLabel("V1-ai-b2-r1", 4, 2)).toBe("V1-ai-b2-r4");
  });

  it("buildPromptVersionInput overrides tuned fields and inherits the rest", () => {
    const source = {
      system_prompt: "SYS",
      user_prompt_template: "USER {{DETECTION_CODE}}",
      prompt_structure: JSON.stringify({
        detection_identity: "ID",
        label_policy: "OLD POLICY",
        decision_rubric: "OLD RUBRIC",
        output_schema: "SCHEMA",
      }),
      model: "gemini-2.5-flash",
      temperature: 0.2,
      top_p: 0.9,
      max_output_tokens: 512,
      version_label: "v2.0",
    };
    const input = buildPromptVersionInput({
      promptVersionId: "new-id",
      detectionId: "det-1",
      sourcePrompt: source,
      candidate,
      newVersionLabel: aiVersionLabel(source.version_label),
      changeNotes: "notes",
      versionNotes: "REPORT",
      createdAt: "2026-01-01T00:00:00Z",
      sourcePromptVersionId: "src-id",
    });
    const structure = JSON.parse(input.promptStructure);
    expect(structure.label_policy).toBe("NEW POLICY");
    expect(structure.decision_rubric).toBe("NEW RUBRIC");
    expect(structure.detection_identity).toBe("ID"); // inherited
    expect(structure.output_schema).toBe("SCHEMA"); // inherited
    expect(input.systemPrompt).toBe("SYS");
    // The evidence requirement is always guaranteed in the addendum.
    expect(input.userPromptTemplate).toBe(
      buildUserPromptTemplate("USER {{DETECTION_CODE}}", EVIDENCE_REQUIREMENT)
    );
    expect(input.model).toBe("gemini-2.5-flash");
    expect(input.versionLabel).toBe("v2.0-ai");
    expect(input.sourcePromptVersionId).toBe("src-id");
    expect(input.versionNotes).toBe("REPORT");
  });

  it("splitUserPromptTemplate round-trips the editable addendum", () => {
    const base = "Analyze this image.\n\nReturn ONLY this JSON: {schema}";
    const addendum = "Area scope\nEvaluate visible plumbing.";
    const compiled = buildUserPromptTemplate(base, addendum);
    const split = splitUserPromptTemplate(compiled);
    expect(split.base).toBe(base);
    expect(split.addendum).toBe(addendum);
    // No addendum marker → whole string is the base.
    expect(splitUserPromptTemplate(base)).toEqual({ base, addendum: "" });
  });

  it("applyCandidateUserTemplate rebuilds the addendum but preserves the fixed base", () => {
    const base = "Analyze this image.\n\nReturn ONLY this JSON: {schema}";
    const compiled = buildUserPromptTemplate(base, "OLD guidance");
    // A candidate with a new addendum replaces only the addendum region.
    const rebuilt = applyCandidateUserTemplate(compiled, { ...candidate, user_prompt_addendum: "NEW guidance" });
    expect(rebuilt).toBe(buildUserPromptTemplate(base, ensureEvidenceRequirement("NEW guidance")));
    expect(rebuilt).toContain("Return ONLY this JSON: {schema}");
    expect(rebuilt).toContain("NEW guidance");
    expect(rebuilt).not.toContain("OLD guidance");
    // The evidence requirement is always injected into the addendum.
    expect(rebuilt).toContain(EVIDENCE_REQUIREMENT);
    // A candidate without an addendum keeps the source guidance + evidence req.
    const inherited = applyCandidateUserTemplate(compiled, candidate);
    expect(inherited).toContain("OLD guidance");
    expect(inherited).toContain(EVIDENCE_REQUIREMENT);
  });

  it("ensureEvidenceRequirement never yields a blank addendum and avoids duplicates", () => {
    expect(ensureEvidenceRequirement("")).toBe(EVIDENCE_REQUIREMENT);
    expect(ensureEvidenceRequirement(null)).toBe(EVIDENCE_REQUIREMENT);
    expect(ensureEvidenceRequirement("   ")).toBe(EVIDENCE_REQUIREMENT);
    // Appends when missing.
    expect(ensureEvidenceRequirement("Rule A")).toContain(EVIDENCE_REQUIREMENT);
    expect(ensureEvidenceRequirement("Rule A")).toContain("Rule A");
    // Does not duplicate when an evidence directive already exists.
    const withEvidence = "Report the evidence for each decision.";
    expect(ensureEvidenceRequirement(withEvidence)).toBe(withEvidence);
  });

  it("parseLeanPreference accepts fractions and percents, rejects out-of-range", () => {
    expect(parseLeanPreference("")).toEqual({ ok: true, value: null });
    expect(parseLeanPreference(null)).toEqual({ ok: true, value: null });
    expect(parseLeanPreference("0.02")).toEqual({ ok: true, value: 0.02 });
    expect(parseLeanPreference("2")).toEqual({ ok: true, value: 0.02 });
    expect(parseLeanPreference("abc").ok).toBe(false);
    expect(parseLeanPreference("60").ok).toBe(false);
  });

  it("normalizeLabelPolicy splits a one-line policy into two DETECTED/NOT_DETECTED lines", () => {
    const result = normalizeLabelPolicy(
      "DETECTED: only when an eligible component shows Severity 3 or 4. NOT_DETECTED: otherwise"
    );
    expect(result).toBe(
      "DETECTED: only when an eligible component shows Severity 3 or 4.\nNOT_DETECTED: otherwise"
    );
    // Markdown is stripped and both markers land on their own lines.
    expect(normalizeLabelPolicy("**DETECTED:** yes\n**NOT_DETECTED:** no")).toBe(
      "DETECTED: yes\nNOT_DETECTED: no"
    );
  });

  it("normalizeDecisionRubric flattens markdown into plain numbered one-per-line criteria", () => {
    const md = "*   **DETECTED (Severity 3 or 4):**\n    *   **Eligible Components:** tank, valves\n1. Some numbered rule";
    const result = normalizeDecisionRubric(md);
    expect(result).toBe(
      "1. DETECTED (Severity 3 or 4):\n2. Eligible Components: tank, valves\n3. Some numbered rule"
    );
    expect(result).not.toMatch(/[*`]/);
  });

  it("parseGoalF1 accepts fractions and percents, rejects out-of-range", () => {
    expect(parseGoalF1("")).toEqual({ ok: true, value: null });
    expect(parseGoalF1(null)).toEqual({ ok: true, value: null });
    expect(parseGoalF1("0.85")).toEqual({ ok: true, value: 0.85 });
    expect(parseGoalF1("85")).toEqual({ ok: true, value: 0.85 });
    expect(parseGoalF1("abc").ok).toBe(false);
    expect(parseGoalF1("250").ok).toBe(false);
  });
});

describe("evaluation helpers", () => {
  it("buildCandidatePromptVersion overrides structure and system prompt", () => {
    const source = { system_prompt: "OLD SYS", prompt_structure: { label_policy: "OLD", decision_rubric: "OLD" } };
    const pv = buildCandidatePromptVersion(source, { ...candidate, system_prompt: "NEW SYS" });
    expect(pv.system_prompt).toBe("NEW SYS");
    expect(pv.prompt_structure.label_policy).toBe("NEW POLICY");
    expect(pv.prompt_structure.decision_rubric).toBe("NEW RUBRIC");
  });

  it("computeRegressionCounts counts fixes and new regressions", () => {
    const baselineRows = toReviewedRows([
      pred({ image_id: "a", ground_truth_label: "NOT_DETECTED", predicted_decision: "DETECTED" }), // baseline FP
      pred({ image_id: "b", ground_truth_label: "DETECTED", predicted_decision: "NOT_DETECTED" }), // baseline FN
      pred({ image_id: "c", ground_truth_label: "NOT_DETECTED", predicted_decision: "NOT_DETECTED" }), // baseline TN
    ]);
    const candPreds: EvalPrediction[] = [
      { image_id: "a", image_uri: "", truth: "NOT_DETECTED", predicted: "NOT_DETECTED", confidence: null, evidence: null, parse_ok: true, raw: "", parse_error_reason: null, parse_fix_suggestion: null, runtime_ms: null }, // FP fixed
      { image_id: "b", image_uri: "", truth: "DETECTED", predicted: "DETECTED", confidence: null, evidence: null, parse_ok: true, raw: "", parse_error_reason: null, parse_fix_suggestion: null, runtime_ms: null }, // FN fixed
      { image_id: "c", image_uri: "", truth: "NOT_DETECTED", predicted: "DETECTED", confidence: null, evidence: null, parse_ok: true, raw: "", parse_error_reason: null, parse_fix_suggestion: null, runtime_ms: null }, // new FP
    ];
    const counts = computeRegressionCounts(baselineRows, candPreds);
    expect(counts).toEqual({ fp_fixed: 1, fn_fixed: 1, new_false_positives: 1, new_false_negatives: 0 });
  });
});

describe("generateIterationReport", () => {
  const baseline = { precision: 0.9, recall: 0.6, f1: 0.72, accuracy: 0.8 };
  const selectedCandidate: CandidateResult = {
    candidate,
    confusion: { tp: 5, fp: 1, fn: 1, tn: 5, parseFail: 0, total: 12 },
    metrics: { precision: 0.83, recall: 0.83, f1: 0.83, accuracy: 0.85 },
    complexity: 300,
    parse_errors: 0,
    changed_rows: ["a"],
    rejected_reasons: [],
    eval_error: null,
  };

  const REQUIRED_SECTIONS = [
    "### Summary",
    "### Baseline performance",
    "### Selected prompt performance",
    "### Candidate comparison table",
    "### Failure modes found",
    "### Prompt changes made",
    "### Generalization safeguards",
    "### Regressions or risks",
    "### Recommended next experiment",
  ];

  it("includes all required sections when a candidate is promoted", () => {
    const selection: SelectionResult = { selected: selectedCandidate, baseline, reasons: ["ok"], goal_met: true };
    const report = generateIterationReport({
      sourceVersionLabel: "v2.0",
      newVersionLabel: "v2.0-ai",
      goalF1: 0.8,
      baseline,
      selection,
      candidates: [selectedCandidate],
      failureModes: [{ name: "False positives", kind: "FP", count: 1, example_evidence: [] }],
      regression: { fp_fixed: 1, fn_fixed: 1, new_false_positives: 0, new_false_negatives: 0 },
      guardrails: ["held-out split"],
      holdoutSize: 6,
      tuningSize: 14,
    });
    for (const s of REQUIRED_SECTIONS) expect(report).toContain(s);
    expect(report).toContain("v2.0-ai");
    expect(report).toContain("met ✅");
  });

  it("explains why nothing was promoted", () => {
    const selection: SelectionResult = { selected: null, baseline, reasons: ["no safe gain"], goal_met: false };
    const report = generateIterationReport({
      sourceVersionLabel: "v2.0",
      newVersionLabel: null,
      goalF1: null,
      baseline,
      selection,
      candidates: [],
      failureModes: [],
      regression: { fp_fixed: 0, fn_fixed: 0, new_false_positives: 0, new_false_negatives: 0 },
      guardrails: ["held-out split"],
      holdoutSize: 6,
      tuningSize: 14,
    });
    for (const s of REQUIRED_SECTIONS) expect(report).toContain(s);
    expect(report).toContain("No candidate safely improved");
  });
});
