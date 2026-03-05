import crypto from "crypto";
import { dataStore } from "@/lib/services";

export class DatasetRepository {
  getDatasetById(datasetId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM datasets WHERE dataset_id = ?", datasetId);
  }

  getDatasetWithItems(datasetId: string): { dataset: any | undefined; items: any[] } {
    return {
      dataset: this.getDatasetById(datasetId),
      items: dataStore.all<any>("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY image_id", datasetId),
    };
  }

  listDatasets(filters: {
    detectionId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    paginated?: boolean;
  }): { rows: any[]; total: number } {
    const { detectionId, search = "", page = 1, pageSize = 50, paginated = false } = filters;
    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (detectionId) {
      whereClauses.push("detection_id = ?");
      params.push(detectionId);
    }
    if (search) {
      whereClauses.push("(name LIKE ? OR split_type LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const totalRow = dataStore.get<{ count: number }>(`SELECT COUNT(*) as count FROM datasets ${whereSql}`, ...params);
    const rows = dataStore.all<any>(
      `SELECT * FROM datasets ${whereSql} ORDER BY created_at DESC ${paginated ? "LIMIT ? OFFSET ?" : ""}`,
      ...params,
      ...(paginated ? [pageSize, (page - 1) * pageSize] : [])
    );

    return { rows, total: Number(totalRow?.count || 0) };
  }

  createDataset(input: {
    datasetId: string;
    name: string;
    detectionId: string;
    splitType: string;
    datasetHash: string;
    size: number;
    createdAt: string;
    updatedAt: string;
  }) {
    dataStore.run(
      `INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.datasetId,
      input.name,
      input.detectionId,
      input.splitType,
      input.datasetHash,
      input.size,
      input.createdAt,
      input.updatedAt
    );
  }

  insertDatasetItem(input: {
    itemId: string;
    datasetId: string;
    imageId: string;
    imageUri: string;
    imageDescription: string;
    segmentTagsJson: string;
    groundTruthLabel: string | null;
  }) {
    dataStore.run(
      `INSERT INTO dataset_items (
        item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.itemId,
      input.datasetId,
      input.imageId,
      input.imageUri,
      input.imageDescription,
      input.segmentTagsJson,
      null,
      null,
      input.groundTruthLabel
    );
  }

  insertDatasetItems(items: Array<{
    itemId: string;
    datasetId: string;
    imageId: string;
    imageUri: string;
    imageDescription: string;
    segmentTagsJson: string;
    groundTruthLabel: string | null;
  }>) {
    const tx = dataStore.transaction((store, payload: typeof items) => {
      for (const item of payload) {
        store.run(
          `INSERT INTO dataset_items (
            item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          item.itemId,
          item.datasetId,
          item.imageId,
          item.imageUri,
          item.imageDescription,
          item.segmentTagsJson,
          null,
          null,
          item.groundTruthLabel
        );
      }
    });
    tx(items);
  }

  getDatasetImageIds(datasetId: string): string[] {
    return dataStore
      .all<{ image_id: string }>("SELECT image_id FROM dataset_items WHERE dataset_id = ?", datasetId)
      .map((r) => String(r.image_id || ""));
  }

  getDatasetItemById(itemId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM dataset_items WHERE item_id = ?", itemId);
  }

  getDatasetItemsForDataset(datasetId: string): Array<{ item_id: string; image_id: string }> {
    return dataStore.all<{ item_id: string; image_id: string }>(
      "SELECT item_id, image_id FROM dataset_items WHERE dataset_id = ?",
      datasetId
    );
  }

  getDuplicateImageItem(datasetId: string, imageId: string, excludeItemId: string): { item_id: string } | undefined {
    return dataStore.get<{ item_id: string }>(
      "SELECT item_id FROM dataset_items WHERE dataset_id = ? AND image_id = ? AND item_id != ? LIMIT 1",
      datasetId,
      imageId,
      excludeItemId
    );
  }

  updateDatasetItem(input: {
    itemId: string;
    imageId: string;
    imageUri: string;
    imageDescription: string;
    segmentTagsJson: string;
    aiAssignedLabel: string | null;
    aiConfidence: number | null;
    groundTruthLabel: string | null;
  }) {
    dataStore.run(
      `UPDATE dataset_items
       SET image_id = ?, image_uri = ?, image_description = ?, segment_tags = ?, ai_assigned_label = ?, ai_confidence = ?, ground_truth_label = ?
       WHERE item_id = ?`,
      input.imageId,
      input.imageUri,
      input.imageDescription,
      input.segmentTagsJson,
      input.aiAssignedLabel,
      input.aiConfidence,
      input.groundTruthLabel,
      input.itemId
    );
  }

  updateDatasetItemDescription(itemId: string, imageDescription: string) {
    dataStore.run(
      "UPDATE dataset_items SET image_description = ? WHERE item_id = ?",
      imageDescription,
      itemId
    );
  }

  bulkUpdateDatasetItems(
    items: Array<{
      itemId: string;
      imageId: string;
      imageUri: string;
      imageDescription: string;
      segmentTagsJson: string;
      aiAssignedLabel: string | null;
      aiConfidence: number | null;
      groundTruthLabel: string | null;
    }>
  ) {
    const tx = dataStore.transaction((store, payload: typeof items) => {
      for (const item of payload) {
        store.run(
          `UPDATE dataset_items
           SET image_id = ?, image_uri = ?, image_description = ?, segment_tags = ?, ai_assigned_label = ?, ai_confidence = ?, ground_truth_label = ?
           WHERE item_id = ?`,
          item.imageId,
          item.imageUri,
          item.imageDescription,
          item.segmentTagsJson,
          item.aiAssignedLabel,
          item.aiConfidence,
          item.groundTruthLabel,
          item.itemId
        );
      }
    });
    tx(items);
  }

  deleteDatasetItem(itemId: string) {
    dataStore.run("DELETE FROM dataset_items WHERE item_id = ?", itemId);
  }

  updateDatasetMeta(datasetId: string, name: string, splitType: string, updatedAt: string) {
    dataStore.run(
      "UPDATE datasets SET name = ?, split_type = ?, updated_at = ? WHERE dataset_id = ?",
      name,
      splitType,
      updatedAt,
      datasetId
    );
  }

  deleteDatasetCascade(datasetId: string) {
    const tx = dataStore.transaction((store, targetDatasetId: string) => {
      const runIds = store.all<{ run_id: string }>("SELECT run_id FROM runs WHERE dataset_id = ?", targetDatasetId);
      for (const r of runIds) {
        store.run("DELETE FROM predictions WHERE run_id = ?", r.run_id);
      }
      store.run("DELETE FROM runs WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM dataset_items WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM datasets WHERE dataset_id = ?", targetDatasetId);
    });
    tx(datasetId);
  }

  refreshDatasetStats(datasetId: string, now: string) {
    const items = dataStore.all<{ image_id: string; ground_truth_label: string | null; segment_tags: string | null }>(
      "SELECT image_id, ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ? ORDER BY image_id",
      datasetId
    );
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          items.map((i) => ({
            image_id: i.image_id,
            label: i.ground_truth_label,
            segment_tags: i.segment_tags || "[]",
          }))
        )
      )
      .digest("hex")
      .slice(0, 16);

    dataStore.run(
      "UPDATE datasets SET dataset_hash = ?, size = ?, updated_at = ? WHERE dataset_id = ?",
      hash,
      items.length,
      now,
      datasetId
    );
  }

  touchDataset(datasetId: string, now: string) {
    dataStore.run("UPDATE datasets SET updated_at = ? WHERE dataset_id = ?", now, datasetId);
  }
}

export const datasetRepository = new DatasetRepository();
