/**
 * Multi-label stratified splitting (iterative stratification, Sechidis et al. 2011).
 *
 * Unlike binary stratification, a multi-label example belongs to several label
 * groups at once, so it can't be placed in a single class bucket. This greedily
 * assigns each example — rarest label first — to the split with the largest
 * remaining need for that label, keeping every label's proportion balanced across
 * splits. Examples with no labels are distributed by the overall split ratios.
 */

export type SplitSpec = { key: string; ratio: number };

/** Largest-remainder apportionment of `total` across `ratios` (sums to `total`). */
export function apportion(total: number, ratios: number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0) || 1;
  const exact = ratios.map((r) => (r / sum) * total);
  const counts = exact.map((v) => Math.floor(v));
  let remaining = total - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remaining > 0 && order.length > 0) {
    counts[order[k % order.length].idx] += 1;
    remaining -= 1;
    k += 1;
  }
  return counts;
}

export function stratifyMultiLabel<T>(
  items: T[],
  getLabels: (item: T) => string[],
  splits: SplitSpec[]
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const s of splits) result[s.key] = [];
  if (items.length === 0) return result;

  const labelSets = items.map((it) => Array.from(new Set(getLabels(it).filter(Boolean))));

  // Overall desired count per split (integer, sums to n).
  const desiredOverall = apportion(items.length, splits.map((s) => s.ratio));
  const remainingDesired = [...desiredOverall];

  // Per-label totals and per-split fractional per-label desired counts.
  const labelTotal = new Map<string, number>();
  for (const set of labelSets) for (const l of set) labelTotal.set(l, (labelTotal.get(l) ?? 0) + 1);
  const ratioSum = splits.reduce((a, s) => a + s.ratio, 0) || 1;
  const desiredPerSplitLabel = splits.map((s) => {
    const m = new Map<string, number>();
    for (const [label, count] of labelTotal) m.set(label, (count * s.ratio) / ratioSum);
    return m;
  });

  const remainingLabelCount = new Map(labelTotal);
  const remaining = new Set(items.map((_, i) => i));

  const assign = (i: number, splitIdx: number) => {
    result[splits[splitIdx].key].push(items[i]);
    remaining.delete(i);
    remainingDesired[splitIdx] -= 1;
    for (const l of labelSets[i]) {
      desiredPerSplitLabel[splitIdx].set(l, (desiredPerSplitLabel[splitIdx].get(l) ?? 0) - 1);
      remainingLabelCount.set(l, (remainingLabelCount.get(l) ?? 0) - 1);
    }
  };

  while (remaining.size > 0) {
    // Rarest label still present among remaining items.
    let rarest: string | null = null;
    let min = Infinity;
    for (const [label, count] of remainingLabelCount) {
      if (count > 0 && count < min) {
        min = count;
        rarest = label;
      }
    }

    if (rarest === null) {
      // Only unlabeled items remain: fill by largest overall remaining need.
      for (const i of Array.from(remaining)) {
        let best = 0;
        for (let s = 1; s < splits.length; s++) {
          if (remainingDesired[s] > remainingDesired[best]) best = s;
        }
        assign(i, best);
      }
      break;
    }

    const withLabel = Array.from(remaining).filter((i) => labelSets[i].includes(rarest!));
    for (const i of withLabel) {
      if (!remaining.has(i)) continue;
      // Split with the largest remaining need for the rarest label; tie-break by
      // largest overall remaining need, then by split order.
      let best = 0;
      let bestDesiredLabel = -Infinity;
      let bestRemaining = -Infinity;
      for (let s = 0; s < splits.length; s++) {
        const dl = desiredPerSplitLabel[s].get(rarest) ?? 0;
        if (dl > bestDesiredLabel || (dl === bestDesiredLabel && remainingDesired[s] > bestRemaining)) {
          best = s;
          bestDesiredLabel = dl;
          bestRemaining = remainingDesired[s];
        }
      }
      assign(i, best);
    }
  }

  return result;
}
