import { describe, it, expect } from "vitest";
import {
  buildSingleDetectionComposition,
  applyDetectionPromptEdits,
  withTargetDescription,
} from "@/lib/productionMirror";
import { renderPromptFeedbackSingleDetectionTemplate, DEFAULT_PROMPT_FEEDBACK_SINGLE_DETECTION_TEMPLATE } from "@/lib/adminPrompts";
import { buildPromptVersionInput } from "@/lib/promptIteration/saving";
import { fallbackCandidates, type CandidateGenInput } from "@/lib/promptIteration/candidateGen";
import type { ProductionSnapshot, PromptComposition } from "@/types";
import type { PromptCandidate } from "@/lib/promptIteration/types";

const AGG_MARKER = "\n\n1. When you see this description:";

function makeSnapshot(): ProductionSnapshot {
  const preamble = "You are a property underwriting detection system.";
  return {
    snapshot_id: "snap-1",
    context_name: "roof",
    source_revision: "rev-1",
    imported_at: "2026-10-29T00:00:00.000Z",
    google_model: "gemini-2.5-flash",
    thinking_level: "medium",
    ordered_members: [
      { role: "detection", label: "other hazard", description: "something else", position: 1, enabled: true, is_target: false },
    ],
    built_prompt: `${preamble}${AGG_MARKER}\nsomething else\n\napply this label: other hazard`,
    response_schema: {},
    raw_source: "",
    checksum: "abc",
    import_method: "test",
  };
}

describe("buildSingleDetectionComposition (PC-001)", () => {
  it("builds a one-member composition with the context preamble and the target member", () => {
    const snap = makeSnapshot();
    const comp = buildSingleDetectionComposition(snap, {
      label: "major corrosion",
      description: "Look for reddish-brown iron-oxide staining with pitting.",
    });

    expect(comp.members).toHaveLength(1);
    const member = comp.members[0];
    expect(member.is_target).toBe(true);
    expect(member.enabled).toBe(true);
    expect(member.label).toBe("major corrosion");
    expect(member.description).toContain("iron-oxide staining");
    expect(comp.multi_label).toBe(false);
    // Preamble is the shared instructions extracted from the frozen snapshot.
    expect(comp.preamble).toBe("You are a property underwriting detection system.");
    expect(comp.context_name).toBe("roof");
    expect(comp.google_model).toBe("gemini-2.5-flash");
    expect(comp.thinking_level).toBe("medium");
  });

  it("trims the production label", () => {
    const comp = buildSingleDetectionComposition(makeSnapshot(), { label: "  rust  ", description: "x" });
    expect(comp.members[0].label).toBe("rust");
  });
});

describe("buildPromptVersionInput single-detection path (PC-001)", () => {
  const sourcePrompt = {
    prompt_version_id: "pv-1",
    version_label: "Detection baseline_V1",
    model: "gemini-2.5-flash",
    temperature: 0,
    top_p: 1,
    max_output_tokens: 1024,
    system_prompt: "",
    user_prompt_template: "",
    prompt_structure: { user_prompt_addendum: "original detection prompt" },
    mode: "DEVELOPMENT_MODE",
    context_name: "roof",
    production_label: "major corrosion",
    production_snapshot_id: "snap-1",
    composition: {
      context_name: "roof",
      google_model: "gemini-2.5-flash",
      thinking_level: "medium",
      preamble: "shared instructions",
      multi_label: false,
      members: [
        { role: "detection", label: "major corrosion", description: "original detection prompt", position: 1, enabled: true, is_target: true },
      ],
    },
  };

  const candidate: PromptCandidate = {
    id: "c1",
    kind: "lean",
    label: "Lean refactor",
    target_failure_mode: "fp",
    rationale: "r",
    label_policy: "",
    decision_rubric: "",
    detection_prompt: "tuned detection prompt",
  };

  it("persists a composition-backed version whose target member is the tuned Detection Prompt", () => {
    const input = buildPromptVersionInput({
      promptVersionId: "pv-2",
      detectionId: "det-1",
      sourcePrompt,
      candidate,
      newVersionLabel: "Detection baseline_V2",
      changeNotes: "iter",
      versionNotes: "",
      createdAt: "2026-10-29T00:00:00.000Z",
      sourcePromptVersionId: "pv-1",
    });

    expect(input.mode).toBe("DEVELOPMENT_MODE");
    expect(input.productionSnapshotId).toBe("snap-1");
    expect(input.productionLabel).toBe("major corrosion");
    expect(input.systemPrompt).toBe("");
    expect(input.composition).toBeTruthy();
    const comp = JSON.parse(String(input.composition));
    const target = comp.members.find((m: any) => m.is_target);
    expect(target.description).toBe("tuned detection prompt");
    // Structured copy stays in sync for the editor.
    const structure = JSON.parse(input.promptStructure);
    expect(structure.user_prompt_addendum).toBe("tuned detection prompt");
  });

  it("falls back to the source member description when the candidate has no tuned text", () => {
    const input = buildPromptVersionInput({
      promptVersionId: "pv-3",
      detectionId: "det-1",
      sourcePrompt,
      candidate: { ...candidate, detection_prompt: null, user_prompt_addendum: null },
      newVersionLabel: "Detection baseline_V3",
      changeNotes: "iter",
      versionNotes: "",
      createdAt: "2026-10-29T00:00:00.000Z",
      sourcePromptVersionId: "pv-1",
    });
    const comp = JSON.parse(String(input.composition));
    const target = comp.members.find((m: any) => m.is_target);
    expect(target.description).toBe("original detection prompt");
  });
});

describe("fallbackCandidates single-detection (PC-001)", () => {
  const base: CandidateGenInput = {
    model: "gemini-2.5-flash",
    detectionCode: "RUST",
    detectionCategory: "general",
    sourceVersionLabel: "V1",
    baseLabelPolicy: "",
    baseDecisionRubric: "",
    baseSystemPrompt: "",
    baseUserAddendum: "",
    baseFixedGuidance: "",
    singleDetection: true,
    baseDetectionPrompt: "Look for rust.\nLook for rust.\nPitting present.",
    failureModes: [],
    tuningSummary: { total: 10, positives: 5, negatives: 5, fp: 3, fn: 1 },
    goalF1: null,
    maxCandidates: 4,
  };

  it("produces detection_prompt candidates and leaves policy/rubric empty", () => {
    const cands = fallbackCandidates(base);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.label_policy).toBe("");
      expect(c.decision_rubric).toBe("");
      expect(typeof c.detection_prompt).toBe("string");
      expect(c.detection_prompt).toBeTruthy();
      expect(c.user_prompt_addendum).toBe(c.detection_prompt);
    }
    // Lean refactor collapses the duplicated line.
    const lean = cands.find((c) => c.kind === "lean");
    expect(lean?.detection_prompt).toBe("Look for rust.\nPitting present.");
  });

  it("adds a recall candidate when false negatives dominate", () => {
    const cands = fallbackCandidates({
      ...base,
      tuningSummary: { total: 10, positives: 5, negatives: 5, fp: 1, fn: 4 },
    });
    expect(cands.some((c) => c.kind === "recall")).toBe(true);
  });
});

describe("Prompt Feedback single-detection helpers (PC-002)", () => {
  it("applyDetectionPromptEdits applies ordered first-occurrence replacements", () => {
    const current = "Look for rust. Ignore shadows. Look for rust again.";
    const edited = applyDetectionPromptEdits(current, [
      { old_text: "Look for rust.", new_text: "Look for reddish-brown iron-oxide staining." },
      { old_text: "Ignore shadows.", new_text: "Distinguish shadows from oxidation." },
    ]);
    expect(edited).toBe(
      "Look for reddish-brown iron-oxide staining. Distinguish shadows from oxidation. Look for rust again."
    );
  });

  it("applyDetectionPromptEdits ignores edits whose old_text is absent", () => {
    const edited = applyDetectionPromptEdits("abc", [{ old_text: "zzz", new_text: "q" }]);
    expect(edited).toBe("abc");
  });

  it("withTargetDescription replaces only the target member description", () => {
    const comp: PromptComposition = {
      context_name: "roof",
      google_model: "gemini-2.5-flash",
      thinking_level: "medium",
      preamble: "shared",
      multi_label: false,
      members: [
        { role: "detection", label: "other", description: "keep me", position: 1, enabled: true, is_target: false },
        { role: "detection", label: "rust", description: "old", position: 2, enabled: true, is_target: true },
      ],
    };
    const next = withTargetDescription(comp, "new detection prompt");
    expect(next.members.find((m) => m.is_target)?.description).toBe("new detection prompt");
    expect(next.members.find((m) => !m.is_target)?.description).toBe("keep me");
    // Original is not mutated.
    expect(comp.members.find((m) => m.is_target)?.description).toBe("old");
  });

  it("renders the single-detection feedback template with the current Detection Prompt and detection_prompt-only instruction", () => {
    const out = renderPromptFeedbackSingleDetectionTemplate(DEFAULT_PROMPT_FEEDBACK_SINGLE_DETECTION_TEMPLATE, {
      detectionCode: "RUST",
      detectionDisplayName: "Rust",
      currentDetectionPrompt: "Look for reddish-brown staining.",
      falsePositivesTotal: 2,
      falsePositivesList: "- fp",
      falseNegativesTotal: 1,
      falseNegativesList: "- fn",
      truePositivesList: "tp",
      trueNegativesList: "tn",
      errorTagsList: "none",
      parseFailTotal: 0,
      parseFailList: "None",
    });
    expect(out).toContain("Look for reddish-brown staining.");
    expect(out).toContain('"section": "detection_prompt"');
    expect(out).not.toContain("{{CURRENT_DETECTION_PROMPT}}");
    // No policy/rubric placeholders leak in.
    expect(out).not.toContain("CURRENT_DECISION_POLICY");
  });
});
