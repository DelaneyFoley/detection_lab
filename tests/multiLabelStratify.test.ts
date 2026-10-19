import { describe, it, expect } from "vitest";
import { apportion, stratifyMultiLabel } from "@/lib/multiLabelStratify";

const SPLITS = [
  { key: "ITERATION", ratio: 0.5 },
  { key: "GOLDEN", ratio: 0.2 },
  { key: "HELD_OUT_EVAL", ratio: 0.3 },
];

describe("apportion", () => {
  it("sums to the total and respects ratios", () => {
    const counts = apportion(10, [0.5, 0.2, 0.3]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(counts).toEqual([5, 2, 3]);
  });

  it("uses largest remainder for non-divisible totals", () => {
    const counts = apportion(7, [0.5, 0.2, 0.3]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe("stratifyMultiLabel", () => {
  it("assigns every item exactly once with no duplicates", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      labels: [i % 2 === 0 ? "dog" : "cat", i % 5 === 0 ? "pool" : ""].filter(Boolean),
    }));
    const out = stratifyMultiLabel(items, (it) => it.labels, SPLITS);
    const all = [...out.ITERATION, ...out.GOLDEN, ...out.HELD_OUT_EVAL];
    expect(all.length).toBe(100);
    expect(new Set(all.map((x) => x.id)).size).toBe(100);
  });

  it("keeps the overall split sizes close to the ratios", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, labels: ["a"] }));
    const out = stratifyMultiLabel(items, (it) => it.labels, SPLITS);
    expect(out.ITERATION.length).toBe(50);
    expect(out.GOLDEN.length).toBe(20);
    expect(out.HELD_OUT_EVAL.length).toBe(30);
  });

  it("balances each label's proportion across splits", () => {
    // 60 dog, 40 cat, 20 shared pool — check per-label split ratios ~ 50/20/30.
    const items: { id: number; labels: string[] }[] = [];
    let id = 0;
    for (let i = 0; i < 60; i++) items.push({ id: id++, labels: ["dog", i < 20 ? "pool" : ""].filter(Boolean) });
    for (let i = 0; i < 40; i++) items.push({ id: id++, labels: ["cat"] });

    const out = stratifyMultiLabel(items, (it) => it.labels, SPLITS);
    const countLabel = (arr: { labels: string[] }[], label: string) =>
      arr.filter((x) => x.labels.includes(label)).length;

    for (const label of ["dog", "cat", "pool"]) {
      const total = countLabel(items, label);
      const iter = countLabel(out.ITERATION, label);
      const golden = countLabel(out.GOLDEN, label);
      const eval_ = countLabel(out.HELD_OUT_EVAL, label);
      expect(iter + golden + eval_).toBe(total);
      // Each split should be within ~1 of the ideal proportion.
      expect(Math.abs(iter - total * 0.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(golden - total * 0.2)).toBeLessThanOrEqual(1);
      expect(Math.abs(eval_ - total * 0.3)).toBeLessThanOrEqual(1);
    }
  });

  it("distributes unlabeled items by overall ratios", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, labels: [] as string[] }));
    const out = stratifyMultiLabel(items, (it) => it.labels, SPLITS);
    expect(out.ITERATION.length + out.GOLDEN.length + out.HELD_OUT_EVAL.length).toBe(10);
    expect(out.ITERATION.length).toBe(5);
  });

  it("handles an empty input", () => {
    const out = stratifyMultiLabel([], () => [], SPLITS);
    expect(out.ITERATION).toEqual([]);
    expect(out.GOLDEN).toEqual([]);
    expect(out.HELD_OUT_EVAL).toEqual([]);
  });
});
