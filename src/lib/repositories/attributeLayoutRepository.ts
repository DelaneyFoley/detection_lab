import { dataStore } from "@/lib/services";

export class AttributeLayoutRepository {
  getLayout(userKey: string, taxonomyKey: string): string[][] | null {
    const row = dataStore.get<{ layout: string }>(
      "SELECT layout FROM attribute_pill_layouts WHERE user_key = ? AND taxonomy_key = ?",
      userKey,
      taxonomyKey
    );
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.layout);
      if (Array.isArray(parsed) && parsed.every((r) => Array.isArray(r))) {
        return parsed as string[][];
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  saveLayout(userKey: string, taxonomyKey: string, layout: string[][]): void {
    const now = new Date().toISOString();
    dataStore.run(
      `INSERT INTO attribute_pill_layouts (user_key, taxonomy_key, layout, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_key, taxonomy_key)
       DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`,
      userKey,
      taxonomyKey,
      JSON.stringify(layout),
      now
    );
  }
}

export const attributeLayoutRepository = new AttributeLayoutRepository();
