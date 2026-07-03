import type { ReviewFlag } from "@/types";
import { dataStore } from "@/lib/services";

export class ReviewFlagRepository {
  getAllFlags(status?: string): ReviewFlag[] {
    if (status) {
      return dataStore.all<ReviewFlag>(
        "SELECT * FROM review_flags WHERE status = ? ORDER BY created_at DESC",
        status
      );
    }
    return dataStore.all<ReviewFlag>("SELECT * FROM review_flags ORDER BY created_at DESC");
  }

  getAllFlagsPaginated(filters: {
    statuses?: string[];
    page?: number;
    pageSize?: number;
  }): { flags: any[]; total: number } {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filters.statuses && filters.statuses.length > 0) {
      const placeholders = filters.statuses.map(() => "?").join(",");
      clauses.push(`status IN (${placeholders})`);
      params.push(...filters.statuses);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalRow = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM review_flags ${where}`,
      ...params
    );

    const page = filters.page || 1;
    const pageSize = filters.pageSize || 10;
    const offset = (page - 1) * pageSize;

    const flags = dataStore.all<any>(
      `SELECT rf.*,
        COALESCE(di.image_uri, p.image_uri) as image_uri,
        d.name as dataset_name,
        d.assigned_to as annotator
       FROM review_flags rf
       LEFT JOIN dataset_items di ON rf.dataset_item_id = di.item_id
       LEFT JOIN predictions p ON rf.prediction_id = p.prediction_id
       LEFT JOIN datasets d ON di.dataset_id = d.dataset_id
       ${where}
       ORDER BY rf.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset
    );

    return { flags, total: totalRow?.count ?? 0 };
  }

  createFlag(input: {
    flagId: string;
    predictionId?: string;
    datasetItemId?: string;
    detectionId: string;
    imageId: string;
    reason: string;
    createdAt: string;
  }): void {
    dataStore.run(
      `INSERT INTO review_flags (flag_id, prediction_id, dataset_item_id, detection_id, image_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      input.flagId,
      input.predictionId || null,
      input.datasetItemId || null,
      input.detectionId,
      input.imageId,
      input.reason,
      input.createdAt
    );
  }

  getFlagById(flagId: string): ReviewFlag | undefined {
    return dataStore.get<ReviewFlag>("SELECT * FROM review_flags WHERE flag_id = ?", flagId);
  }

  getFlagsByDetection(detectionId: string, status?: string): ReviewFlag[] {
    if (status) {
      return dataStore.all<ReviewFlag>(
        "SELECT * FROM review_flags WHERE detection_id = ? AND status = ? ORDER BY created_at DESC",
        detectionId,
        status
      );
    }
    return dataStore.all<ReviewFlag>(
      "SELECT * FROM review_flags WHERE detection_id = ? ORDER BY created_at DESC",
      detectionId
    );
  }

  getFlagsByRun(runId: string): ReviewFlag[] {
    return dataStore.all<ReviewFlag>(
      `SELECT rf.* FROM review_flags rf
       INNER JOIN predictions p ON rf.prediction_id = p.prediction_id
       WHERE p.run_id = ?
       ORDER BY rf.created_at DESC`,
      runId
    );
  }

  getFlagsByDataset(datasetId: string): ReviewFlag[] {
    return dataStore.all<ReviewFlag>(
      `SELECT rf.*, di.image_uri FROM review_flags rf
       INNER JOIN dataset_items di ON rf.dataset_item_id = di.item_id
       WHERE di.dataset_id = ?
       ORDER BY rf.created_at DESC`,
      datasetId
    );
  }

  getFlagsByPredictionIds(predictionIds: string[]): ReviewFlag[] {
    if (predictionIds.length === 0) return [];
    const placeholders = predictionIds.map(() => "?").join(",");
    return dataStore.all<ReviewFlag>(
      `SELECT * FROM review_flags WHERE prediction_id IN (${placeholders}) AND status = 'open'`,
      ...predictionIds
    );
  }

  getFlagsByDatasetItemIds(itemIds: string[]): ReviewFlag[] {
    if (itemIds.length === 0) return [];
    const placeholders = itemIds.map(() => "?").join(",");
    return dataStore.all<ReviewFlag>(
      `SELECT * FROM review_flags WHERE dataset_item_id IN (${placeholders}) AND status = 'open'`,
      ...itemIds
    );
  }

  resolveFlag(input: {
    flagId: string;
    resolutionAction?: string;
    resolutionNote?: string | null;
    resolvedAt: string;
    resolvedBy?: string | null;
    previousGroundTruthLabel?: string | null;
    newGroundTruthLabel?: string | null;
    previousAttributes?: string[] | null;
    newAttributes?: string[] | null;
  }): void {
    dataStore.run(
      `UPDATE review_flags SET status = 'resolved', resolution_action = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?, previous_ground_truth_label = ?, new_ground_truth_label = ?, previous_attributes = ?, new_attributes = ? WHERE flag_id = ?`,
      input.resolutionAction || null,
      input.resolutionNote || null,
      input.resolvedAt,
      input.resolvedBy || null,
      input.previousGroundTruthLabel ?? null,
      input.newGroundTruthLabel ?? null,
      input.previousAttributes ? JSON.stringify(input.previousAttributes) : null,
      input.newAttributes ? JSON.stringify(input.newAttributes) : null,
      input.flagId
    );
  }

  dismissFlag(flagId: string, resolvedAt: string, resolvedBy?: string | null): void {
    dataStore.run(
      `UPDATE review_flags SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE flag_id = ?`,
      resolvedAt,
      resolvedBy || null,
      flagId
    );
  }

  deleteFlag(flagId: string): void {
    dataStore.run(`DELETE FROM review_flags WHERE flag_id = ?`, flagId);
  }

  getOpenFlagCountForRun(runId: string): number {
    const row = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM review_flags rf
       INNER JOIN predictions p ON rf.prediction_id = p.prediction_id
       WHERE p.run_id = ? AND rf.status = 'open'`,
      runId
    );
    return row?.count ?? 0;
  }

  getOpenFlagCountForDataset(datasetId: string): number {
    const row = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM review_flags rf
       INNER JOIN dataset_items di ON rf.dataset_item_id = di.item_id
       WHERE di.dataset_id = ? AND rf.status = 'open'`,
      datasetId
    );
    return row?.count ?? 0;
  }

  getResolvedFlagCountForDataset(datasetId: string): number {
    const row = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM review_flags rf
       INNER JOIN dataset_items di ON rf.dataset_item_id = di.item_id
       WHERE di.dataset_id = ? AND rf.status IN ('resolved', 'dismissed')`,
      datasetId
    );
    return row?.count ?? 0;
  }
}

export const reviewFlagRepository = new ReviewFlagRepository();
