import { describe, it, expect } from "vitest";
import {
  buildCompositionFromSnapshot,
  computeProvenanceKind,
  compileTargetMemberDescription,
} from "../src/lib/productionMirror";
import type { ProductionSnapshot } from "../src/types";

function snapshot(): ProductionSnapshot {
  return {
    snapshot_id: "snap-1",
    context_name: "underwriting.residential.interior.kitchen.under_sink",
    source_revision: "abc123",
    imported_at: "2026-08-10T00:00:00.000Z",
    google_model: "gemini-3.5-flash",
    thinking_level: "medium",
    ordered_members: [
      { role: "detection", label: "backplate", description: "a backplate", position: 1, enabled: true, is_target: false },
      { role: "detection", label: "knob", description: "a knob", position: 2, enabled: true, is_target: false },
      { role: "detection", label: "major corrosion", description: "prod corrosion text", position: 3, enabled: true, is_target: false },
      { role: "ic_correct", label: "correct capture", description: "correct", position: 4, enabled: true, is_target: false },
      { role: "ic_incorrect", label: "incorrect capture", description: "incorrect", position: 5, enabled: true, is_target: false },
    ],
    built_prompt: "preamble ...",
    response_schema: {},
    raw_source: "{}",
    checksum: "deadbeef",
    import_method: "local_compile",
  };
}

describe("productionMirror", () => {
  it("flags an existing production member as the target", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "MY EDITED target text",
    });
    const target = comp.members.find((m) => m.is_target);
    expect(target?.label).toBe("major corrosion");
    expect(target?.description).toBe("MY EDITED target text");
    expect(comp.members).toHaveLength(5);
  });

  it("editing only the target keeps an exact replication", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "totally different target wording",
    });
    expect(computeProvenanceKind(snapshot(), comp)).toBe("exact_replication");
  });

  it("baseline source keeps the frozen production wording for the target", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "MY EDITED",
      targetSource: "baseline",
    });
    expect(comp.members.find((m) => m.is_target)?.description).toBe("prod corrosion text");
    expect(comp.target_source).toBe("baseline");
  });

  it("structured source uses the compiled fields for the target", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "MY EDITED",
      targetSource: "structured",
    });
    expect(comp.members.find((m) => m.is_target)?.description).toBe("MY EDITED");
    expect(comp.target_source).toBe("structured");
  });

  it("a target not in production is always structured with no target_source ambiguity", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "new hazard",
      targetDescription: "brand new",
      targetSource: "baseline",
    });
    expect(comp.target_source).toBe("structured");
    expect(comp.members.find((m) => m.is_target)?.description).toBe("brand new");
  });

  it("editing a sibling produces a modified replication", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "x",
    });
    comp.members[1] = { ...comp.members[1], description: "changed knob wording" };
    expect(computeProvenanceKind(snapshot(), comp)).toBe("modified_replication");
  });

  it("disabling a sibling produces a modified replication", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "x",
    });
    comp.members[0] = { ...comp.members[0], enabled: false };
    expect(computeProvenanceKind(snapshot(), comp)).toBe("modified_replication");
  });

  it("changing pinned params produces a modified replication", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "major corrosion",
      targetDescription: "x",
    });
    comp.google_model = "gemini-3.1-flash-lite";
    expect(computeProvenanceKind(snapshot(), comp)).toBe("modified_replication");
  });

  it("inserts a new target not present in production at a chosen position", () => {
    const comp = buildCompositionFromSnapshot(snapshot(), {
      targetLabel: "new hazard",
      targetDescription: "brand new detection",
      targetInsertPosition: 2,
    });
    expect(comp.members).toHaveLength(6);
    expect(comp.members[1].is_target).toBe(true);
    expect(comp.members[1].label).toBe("new hazard");
    expect(comp.members.map((m) => m.position)).toEqual([1, 2, 3, 4, 5, 6]);
    // Inserting a new target still leaves the siblings byte-identical -> exact.
    expect(computeProvenanceKind(snapshot(), comp)).toBe("exact_replication");
  });

  it("compiles structured target fields into one member description", () => {
    const text = compileTargetMemberDescription({
      labelPolicy: "DETECTED: x\nNOT_DETECTED: y",
      decisionRubric: "1. a\n2. b",
      userPromptAddendum: "note",
    });
    expect(text).toContain("Decision Policy:");
    expect(text).toContain("Decision Rubric:");
    expect(text).toContain("Detection-Specific Addendum:");
  });
});
