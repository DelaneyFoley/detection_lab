import { dataStore } from "@/lib/services";

export type PromptGroupMetadataRow = {
  detection_id: string;
  base_name: string;
  description: string;
  updated_at: string;
};

function keyOf(baseName: string): string {
  return String(baseName || "").trim().toLowerCase();
}

export class PromptGroupMetadataRepository {
  listByDetection(detectionId: string): PromptGroupMetadataRow[] {
    return dataStore.all<PromptGroupMetadataRow>(
      "SELECT detection_id, base_name, description, updated_at FROM prompt_group_metadata WHERE detection_id = ?",
      detectionId
    );
  }

  upsert(detectionId: string, baseName: string, description: string): void {
    const key = keyOf(baseName);
    if (!key) return;
    const now = new Date().toISOString();
    dataStore.run(
      `INSERT INTO prompt_group_metadata (detection_id, base_name_key, base_name, description, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(detection_id, base_name_key)
       DO UPDATE SET base_name = excluded.base_name, description = excluded.description, updated_at = excluded.updated_at`,
      detectionId,
      key,
      String(baseName || "").trim(),
      String(description || ""),
      now
    );
  }

  rename(detectionId: string, oldBaseName: string, newBaseName: string): void {
    const oldKey = keyOf(oldBaseName);
    const newKey = keyOf(newBaseName);
    if (!oldKey || !newKey) return;
    if (oldKey === newKey) {
      // Same key — just refresh the display casing.
      const now = new Date().toISOString();
      dataStore.run(
        `UPDATE prompt_group_metadata SET base_name = ?, updated_at = ?
         WHERE detection_id = ? AND base_name_key = ?`,
        String(newBaseName || "").trim(),
        now,
        detectionId,
        oldKey
      );
      return;
    }
    const existing = dataStore.get<{ description: string }>(
      "SELECT description FROM prompt_group_metadata WHERE detection_id = ? AND base_name_key = ?",
      detectionId,
      oldKey
    );
    const description = String(existing?.description || "");
    const now = new Date().toISOString();
    const tx = dataStore.transaction((store) => {
      store.run(
        "DELETE FROM prompt_group_metadata WHERE detection_id = ? AND base_name_key = ?",
        detectionId,
        oldKey
      );
      store.run(
        `INSERT INTO prompt_group_metadata (detection_id, base_name_key, base_name, description, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(detection_id, base_name_key)
         DO UPDATE SET base_name = excluded.base_name, description = excluded.description, updated_at = excluded.updated_at`,
        detectionId,
        newKey,
        String(newBaseName || "").trim(),
        description,
        now
      );
    });
    tx();
  }

  remove(detectionId: string, baseName: string): void {
    const key = keyOf(baseName);
    if (!key) return;
    dataStore.run(
      "DELETE FROM prompt_group_metadata WHERE detection_id = ? AND base_name_key = ?",
      detectionId,
      key
    );
  }
}

export const promptGroupMetadataRepository = new PromptGroupMetadataRepository();
