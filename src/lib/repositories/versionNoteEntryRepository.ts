import type { VersionNoteEntry, VersionNoteEntryOrigin } from "@/types";
import { dataStore } from "@/lib/services";

interface RawRow {
  entry_id: string;
  prompt_version_id: string;
  origin: VersionNoteEntryOrigin;
  event_type: string | null;
  body: string;
  metadata: string | null;
  created_by: string;
  created_at: string;
}

function hydrate(row: RawRow): VersionNoteEntry {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    entry_id: row.entry_id,
    prompt_version_id: row.prompt_version_id,
    origin: row.origin,
    event_type: (row.event_type as VersionNoteEntry["event_type"]) ?? null,
    body: row.body,
    metadata,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export class VersionNoteEntryRepository {
  listByVersion(promptVersionId: string): VersionNoteEntry[] {
    const rows = dataStore.all<RawRow>(
      "SELECT * FROM version_note_entries WHERE prompt_version_id = ? ORDER BY created_at DESC",
      promptVersionId
    );
    return rows.map(hydrate);
  }

  getById(entryId: string): VersionNoteEntry | undefined {
    const row = dataStore.get<RawRow>(
      "SELECT * FROM version_note_entries WHERE entry_id = ?",
      entryId
    );
    return row ? hydrate(row) : undefined;
  }

  hasHilEntryForRun(runId: string): boolean {
    const row = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM version_note_entries
       WHERE origin = 'auto_hil'
         AND json_extract(metadata, '$.run_id') = ?`,
      runId
    );
    return (row?.count ?? 0) > 0;
  }

  createEntry(input: {
    entryId: string;
    promptVersionId: string;
    origin: VersionNoteEntryOrigin;
    eventType: string | null;
    body: string;
    metadata: Record<string, unknown> | null;
    createdBy: string;
    createdAt: string;
  }): VersionNoteEntry {
    dataStore.run(
      `INSERT INTO version_note_entries (entry_id, prompt_version_id, origin, event_type, body, metadata, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.entryId,
      input.promptVersionId,
      input.origin,
      input.eventType,
      input.body,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdBy,
      input.createdAt
    );
    return {
      entry_id: input.entryId,
      prompt_version_id: input.promptVersionId,
      origin: input.origin,
      event_type: (input.eventType as VersionNoteEntry["event_type"]) ?? null,
      body: input.body,
      metadata: input.metadata,
      created_by: input.createdBy,
      created_at: input.createdAt,
    };
  }

  updateEntryBody(entryId: string, body: string): void {
    dataStore.run(
      "UPDATE version_note_entries SET body = ? WHERE entry_id = ?",
      body,
      entryId
    );
  }

  deleteEntry(entryId: string): void {
    dataStore.run("DELETE FROM version_note_entries WHERE entry_id = ?", entryId);
  }

  deleteEntriesForPromptVersion(promptVersionId: string): void {
    dataStore.run("DELETE FROM version_note_entries WHERE prompt_version_id = ?", promptVersionId);
  }
}

export const versionNoteEntryRepository = new VersionNoteEntryRepository();
