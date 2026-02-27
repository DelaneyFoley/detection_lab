export function splitTypeLabel(splitType: string): string {
  switch (splitType) {
    case "ITERATION":
      return "TRAIN";
    case "GOLDEN":
      return "TEST";
    case "HELD_OUT_EVAL":
      return "EVALUATE";
    case "CUSTOM":
      return "CUSTOM";
    default:
      return splitType;
  }
}
