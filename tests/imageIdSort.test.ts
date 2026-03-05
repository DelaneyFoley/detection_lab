import { describe, expect, it } from "vitest";
import { compareImageIds, sortByImageId } from "@/lib/imageIdSort";

describe("image_id sorting", () => {
  it("sorts numeric suffixes by full number value", () => {
    const input = ["DV_1", "DV_10", "DV_100", "DV_1001", "DV_9", "DV_12", "DV_11"];
    const sorted = [...input].sort(compareImageIds);
    expect(sorted).toEqual(["DV_1", "DV_9", "DV_10", "DV_11", "DV_12", "DV_100", "DV_1001"]);
  });

  it("sorts structured image rows by image_id", () => {
    const rows = [
      { image_id: "img_20" },
      { image_id: "img_3" },
      { image_id: "img_100" },
      { image_id: "img_11" },
    ];
    const sorted = sortByImageId(rows);
    expect(sorted.map((row) => row.image_id)).toEqual(["img_3", "img_11", "img_20", "img_100"]);
  });
});
