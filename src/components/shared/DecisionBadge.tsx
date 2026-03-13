export function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-[11px] text-[var(--app-text-subtle)]">—</span>;
  if (decision === "UNSET") {
    return <span className="app-badge app-badge-muted">Unset</span>;
  }
  if (decision !== "DETECTED" && decision !== "NOT_DETECTED") {
    return (
      <span className="app-badge app-badge-danger">
        {decision}
      </span>
    );
  }
  return (
    <span
      className={`app-badge ${
        decision === "DETECTED"
          ? "app-badge-purple"
          : "app-badge-accent"
      }`}
    >
      {decision === "DETECTED" ? "DETECTED" : "NOT DETECTED"}
    </span>
  );
}
