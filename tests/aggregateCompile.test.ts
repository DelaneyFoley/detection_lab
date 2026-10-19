import { describe, it, expect } from "vitest";
import {
  compileAggregatePrompt,
  extractPreamble,
  deriveAggregateOutcome,
  validateAggregatePayload,
} from "../src/lib/inference/aggregate";

describe("aggregate prompt compiler", () => {
  const preamble = "You are a classifier.\n\nThe descriptions and labels are listed below.";
  const members = [
    { label: "knob", description: "a metal knob" },
    { label: "mold", description: "black mold" },
  ];

  it("reproduces production's numbered build_prompt format exactly", () => {
    const built = compileAggregatePrompt(preamble, members);
    expect(built).toBe(
      `${preamble}\n\n` +
        "1. When you see this description:\na metal knob\n\napply this label: knob\n\n" +
        "2. When you see this description:\nblack mold\n\napply this label: mold"
    );
  });

  it("extractPreamble + compileAggregatePrompt round-trips byte-for-byte", () => {
    const built = compileAggregatePrompt(preamble, members);
    expect(extractPreamble(built)).toBe(preamble);
    expect(
      compileAggregatePrompt(
        extractPreamble(built),
        members.map((m) => ({ label: m.label, description: m.description }))
      )
    ).toBe(built);
  });

  it("returns just the preamble when there are no members", () => {
    expect(compileAggregatePrompt(preamble, [])).toBe(preamble);
  });
});

describe("aggregate outcome (presence semantics)", () => {
  const list = [
    { detection: "knob", reasoning: "shiny knob" },
    { detection: "major corrosion", reasoning: "green verdigris on valve" },
  ];

  it("marks the target DETECTED when its label is present, capturing its reasoning", () => {
    const out = deriveAggregateOutcome(list, "major corrosion");
    expect(out.decision).toBe("DETECTED");
    expect(out.evidence).toBe("green verdigris on valve");
    expect(out.siblings.map((s) => s.label)).toEqual(["knob"]);
  });

  it("marks the target NOT_DETECTED when absent, keeping all as siblings", () => {
    const out = deriveAggregateOutcome(list, "mold");
    expect(out.decision).toBe("NOT_DETECTED");
    expect(out.evidence).toBeNull();
    expect(out.siblings.map((s) => s.label)).toEqual(["knob", "major corrosion"]);
  });

  it("treats a null target label as NOT_DETECTED", () => {
    const out = deriveAggregateOutcome(list, null);
    expect(out.decision).toBe("NOT_DETECTED");
    expect(out.siblings).toHaveLength(2);
  });
});

describe("validateAggregatePayload (strict schema enforcement)", () => {
  const labels = ["knob", "major corrosion"];

  it("accepts a well-formed payload with in-enum labels", () => {
    const payload = { detections: [{ detection: "knob", reasoning: "shiny" }] };
    expect(validateAggregatePayload(payload, labels)).toBeNull();
  });

  it("accepts an empty detections array", () => {
    expect(validateAggregatePayload({ detections: [] }, labels)).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(validateAggregatePayload("nope", labels)).toMatch(/JSON object/);
  });

  it("rejects a missing detections array", () => {
    expect(validateAggregatePayload({}, labels)).toMatch(/detections/);
  });

  it("rejects an out-of-enum label", () => {
    const payload = { detections: [{ detection: "unicorn", reasoning: "x" }] };
    expect(validateAggregatePayload(payload, labels)).toMatch(/out-of-schema/);
  });

  it("matches labels case-insensitively", () => {
    const payload = { detections: [{ detection: "KNOB", reasoning: "x" }] };
    expect(validateAggregatePayload(payload, labels)).toBeNull();
  });

  it("rejects a non-string detection or reasoning", () => {
    expect(validateAggregatePayload({ detections: [{ detection: 1, reasoning: "x" }] }, labels)).toMatch(/detection/);
    expect(validateAggregatePayload({ detections: [{ detection: "knob", reasoning: 2 }] }, labels)).toMatch(/reasoning/);
  });

  it("allows any string label when the enum is empty", () => {
    const payload = { detections: [{ detection: "anything", reasoning: "x" }] };
    expect(validateAggregatePayload(payload, [])).toBeNull();
  });
});
