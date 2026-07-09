/**
 * Shared helpers for per-user attribute pill layouts.
 *
 * Layouts are keyed by (user, taxonomyKey) so that a user's chosen row
 * organization for a given set of attributes persists across every image,
 * session, refresh, navigation and login.
 */

// The app currently has no real auth. All tabs share a single "current user"
// identity for layout persistence. (Annotator impersonation in the Annotation
// tab does not change which layout is loaded — organization is per real user.)
export const CURRENT_USER = "Delaney F.";

/**
 * Build a stable, order-independent key for a set of attribute options.
 * The same attribute set always produces the same key regardless of the
 * order the options are provided in, so a layout applies wherever those
 * attributes appear.
 */
export function taxonomyKey(options: string[]): string {
  const cleaned = Array.from(new Set(options.map((o) => String(o).trim()).filter(Boolean)));
  cleaned.sort();
  return cleaned.join("\u0001");
}

/**
 * Reconcile a saved row layout against the current attribute options:
 * - drop attributes that no longer exist
 * - drop duplicates (keep first occurrence)
 * - append any new attributes (not in the saved layout) to the last row
 * - drop empty rows
 * Always returns at least one row when there are options.
 */
export function reconcileLayout(saved: string[][], options: string[]): string[][] {
  const valid = new Set(options);
  const seen = new Set<string>();
  const rows: string[][] = [];

  for (const row of saved) {
    if (!Array.isArray(row)) continue;
    const next: string[] = [];
    for (const attr of row) {
      if (valid.has(attr) && !seen.has(attr)) {
        seen.add(attr);
        next.push(attr);
      }
    }
    if (next.length) rows.push(next);
  }

  const missing = options.filter((o) => !seen.has(o));
  if (missing.length) {
    if (rows.length) {
      rows[rows.length - 1] = [...rows[rows.length - 1], ...missing];
    } else {
      rows.push(missing);
    }
  }

  return rows.length ? rows : options.length ? [[...options]] : [];
}
