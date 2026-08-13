import type { SplitType } from "@/types";

export const DATASET_SPLIT_TYPES: SplitType[] = [
  "MASTER",
  "ITERATION",
  "GOLDEN",
  "HELD_OUT_EVAL",
  "CUSTOM",
  "DISCOVERY",
];

export function isDatasetSplitType(value: string): value is SplitType {
  return DATASET_SPLIT_TYPES.includes(value as SplitType);
}

export function splitTypeLabel(splitType: string): string {
  switch (splitType) {
    case "MASTER":
      return "MASTER";
    case "ITERATION":
      return "TRAIN";
    case "GOLDEN":
      return "TEST";
    case "HELD_OUT_EVAL":
      return "EVALUATE";
    case "CUSTOM":
      return "CUSTOM";
    case "DISCOVERY":
      return "DISCOVERY";
    default:
      return splitType;
  }
}

export function splitTypeBadgeClass(splitType: string): string {
  switch (splitType) {
    case "MASTER":
      return "app-pill app-pill-master";
    case "ITERATION":
      return "app-pill app-pill-train";
    case "GOLDEN":
      return "app-pill app-pill-test";
    case "HELD_OUT_EVAL":
      return "app-pill app-pill-evaluate";
    case "CUSTOM":
      return "app-pill app-pill-custom";
    case "DISCOVERY":
      return "app-pill app-pill-discovery";
    default:
      return "app-pill app-pill-custom";
  }
}
