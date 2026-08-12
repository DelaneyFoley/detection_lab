import { dataStore } from "@/lib/services";
import type { ProductionSnapshot, CompositionMember } from "@/types";

export class SnapshotRepository {
  createSnapshot(input: {
    snapshotId: string;
    contextName: string;
    sourceRevision: string;
    importedAt: string;
    googleModel: string;
    thinkingLevel: string;
    orderedMembers: CompositionMember[];
    builtPrompt: string;
    responseSchema: Record<string, unknown>;
    rawSource: string;
    checksum: string;
    importMethod?: string;
  }) {
    dataStore.run(
      `INSERT INTO production_snapshots (snapshot_id, context_name, source_revision, imported_at, google_model, thinking_level, ordered_members, built_prompt, response_schema, raw_source, checksum, import_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.snapshotId,
      input.contextName,
      input.sourceRevision,
      input.importedAt,
      input.googleModel,
      input.thinkingLevel,
      JSON.stringify(input.orderedMembers),
      input.builtPrompt,
      JSON.stringify(input.responseSchema),
      input.rawSource,
      input.checksum,
      input.importMethod || "local_compile"
    );
  }

  getSnapshotById(snapshotId: string): ProductionSnapshot | null {
    const row = dataStore.get<any>(
      "SELECT * FROM production_snapshots WHERE snapshot_id = ?",
      snapshotId
    );
    return row ? rowToSnapshot(row) : null;
  }

  listByContext(contextName: string): ProductionSnapshot[] {
    const rows = dataStore.all<any>(
      "SELECT * FROM production_snapshots WHERE context_name = ? ORDER BY imported_at DESC",
      contextName
    );
    return rows.map(rowToSnapshot);
  }

  /** All (context_name, checksum) pairs of frozen snapshots, for drift detection. */
  listContextChecksums(): Array<{ context_name: string; checksum: string }> {
    return dataStore.all<{ context_name: string; checksum: string }>(
      "SELECT context_name, checksum FROM production_snapshots"
    );
  }
}

function rowToSnapshot(row: any): ProductionSnapshot {
  return {
    snapshot_id: row.snapshot_id,
    context_name: row.context_name,
    source_revision: row.source_revision,
    imported_at: row.imported_at,
    google_model: row.google_model,
    thinking_level: row.thinking_level,
    ordered_members: safeParse(row.ordered_members, []),
    built_prompt: row.built_prompt,
    response_schema: safeParse(row.response_schema, {}),
    raw_source: row.raw_source,
    checksum: row.checksum,
    import_method: row.import_method,
  };
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const snapshotRepository = new SnapshotRepository();
