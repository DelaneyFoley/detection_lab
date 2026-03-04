import { dataStore } from "@/lib/services";

export class SettingsRepository {
  getByKey(key: string): { value?: string } | undefined {
    return dataStore.get<{ value?: string }>("SELECT value FROM app_settings WHERE key = ?", key);
  }

  getByKeys(keys: string[]): Array<{ key: string; value: string }> {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => "?").join(",");
    return dataStore.all<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
      ...keys
    );
  }

  upsertMany(entries: Array<{ key: string; value: string; updatedAt: string }>) {
    const tx = dataStore.transaction((store, payload: typeof entries) => {
      for (const entry of payload) {
        store.run(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          entry.key,
          entry.value,
          entry.updatedAt
        );
      }
    });
    tx(entries);
  }
}

export const settingsRepository = new SettingsRepository();
