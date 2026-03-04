export function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-gray-600 text-xs">—</span>;
  if (decision !== "DETECTED" && decision !== "NOT_DETECTED") {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">{decision}</span>;
  }
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        decision === "DETECTED"
          ? "bg-purple-900/30 text-purple-300"
          : "bg-emerald-900/30 text-emerald-300"
      }`}
    >
      {decision}
    </span>
  );
}
