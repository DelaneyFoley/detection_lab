function tokenizeForNaturalSort(value: string): string[] {
  return String(value || "")
    .trim()
    .match(/\d+|\D+/g) || [];
}

export function compareImageIds(left: string, right: string): number {
  const a = tokenizeForNaturalSort(left);
  const b = tokenizeForNaturalSort(right);
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;

    const aNum = /^\d+$/.test(av);
    const bNum = /^\d+$/.test(bv);

    if (aNum && bNum) {
      const aNormalized = av.replace(/^0+/, "") || "0";
      const bNormalized = bv.replace(/^0+/, "") || "0";

      if (aNormalized.length !== bNormalized.length) {
        return aNormalized.length - bNormalized.length;
      }
      if (aNormalized !== bNormalized) {
        return aNormalized < bNormalized ? -1 : 1;
      }
      if (av.length !== bv.length) {
        return av.length - bv.length;
      }
      continue;
    }

    if (aNum !== bNum) return aNum ? -1 : 1;

    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;
  }

  return 0;
}

export function sortByImageId<T extends { image_id?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => compareImageIds(String(left?.image_id || ""), String(right?.image_id || "")));
}
