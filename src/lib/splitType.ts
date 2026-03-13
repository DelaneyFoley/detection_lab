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

export function splitTypeBadgeClass(splitType: string): string {
  switch (splitType) {
    case "ITERATION":
      return "app-pill app-pill-train";
    case "GOLDEN":
      return "app-pill app-pill-test";
    case "HELD_OUT_EVAL":
      return "app-pill app-pill-evaluate";
    case "CUSTOM":
      return "app-pill app-pill-custom";
    default:
      return "app-pill app-pill-custom";
  }
}
