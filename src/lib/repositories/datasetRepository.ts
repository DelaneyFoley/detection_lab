import crypto from "crypto";
import { dataStore } from "@/lib/services";
import { sortByImageId } from "@/lib/imageIdSort";

export class DatasetRepository {
  getDatasetById(datasetId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM datasets WHERE dataset_id = ?", datasetId);
  }

  setExcludeAttributes(datasetId: string, exclude: boolean): void {
    dataStore.run(
      "UPDATE datasets SET exclude_attributes = ?, updated_at = ? WHERE dataset_id = ?",
      exclude ? 1 : 0,
      new Date().toISOString(),
      datasetId
    );
  }

  getDatasetWithItems(datasetId: string): { dataset: any | undefined; items: any[] } {
    return {
      dataset: this.getDatasetById(datasetId),
      items: sortByImageId(dataStore.all<any>("SELECT * FROM dataset_items WHERE dataset_id = ?", datasetId)),
    };
  }

  listDatasets(filters: {
    detectionId?: string;
    includeUnassigned?: boolean;
    unassignedOnly?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
    paginated?: boolean;
  }): { rows: any[]; total: number } {
    const { detectionId, includeUnassigned = false, unassignedOnly = false, search = "", page = 1, pageSize = 50, paginated = false } = filters;
    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (unassignedOnly) {
      whereClauses.push("(detection_id IS NULL OR detection_id = '')");
    } else if (detectionId) {
      if (includeUnassigned) {
        whereClauses.push("(detection_id = ? OR detection_id IS NULL OR detection_id = '')");
        params.push(detectionId);
      } else {
        whereClauses.push("detection_id = ?");
        params.push(detectionId);
      }
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
    detectionId: string | null;
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

  findDuplicateImageIds(imageIds: string[]): Array<{ image_id: string; dataset_id: string; dataset_name: string }> {
    if (imageIds.length === 0) return [];
    const placeholders = imageIds.map(() => "?").join(",");
    return dataStore.all<{ image_id: string; dataset_id: string; dataset_name: string }>(
      `SELECT di.image_id, d.dataset_id, d.name AS dataset_name
       FROM dataset_items di
       JOIN datasets d ON d.dataset_id = di.dataset_id
       WHERE di.image_id IN (${placeholders})
       GROUP BY di.image_id, d.dataset_id`,
      ...imageIds
    );
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

  updateDatasetMeta(datasetId: string, name: string, detectionId: string | null, splitType: string, updatedAt: string) {
    dataStore.run(
      "UPDATE datasets SET name = ?, detection_id = ?, split_type = ?, updated_at = ? WHERE dataset_id = ?",
      name,
      detectionId,
      splitType,
      updatedAt,
      datasetId
    );
  }

  deleteDatasetCascade(datasetId: string) {
    const children = dataStore.all<{ dataset_id: string }>(
      "SELECT dataset_id FROM datasets WHERE linked_dataset_id = ?",
      datasetId
    );
    for (const child of children) {
      this.deleteDatasetCascade(child.dataset_id);
    }

    const tx = dataStore.transaction((store, targetDatasetId: string) => {
      const runIds = store.all<{ run_id: string }>("SELECT run_id FROM runs WHERE dataset_id = ?", targetDatasetId);
      for (const r of runIds) {
        store.run("DELETE FROM predictions WHERE run_id = ?", r.run_id);
      }
      store.run("DELETE FROM runs WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM qa_logs WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM qa_samples WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM review_flags WHERE dataset_item_id IN (SELECT item_id FROM dataset_items WHERE dataset_id = ?)", targetDatasetId);
      store.run("DELETE FROM notifications WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM dataset_items WHERE dataset_id = ?", targetDatasetId);
      store.run("DELETE FROM datasets WHERE dataset_id = ?", targetDatasetId);
    });
    tx(datasetId);
  }

  updateDatasetAttributes(datasetId: string, segmentTaxonomy: string[]) {
    dataStore.run(
      `UPDATE datasets SET segment_taxonomy = ?, updated_at = ? WHERE dataset_id = ?`,
      JSON.stringify(segmentTaxonomy),
      new Date().toISOString(),
      datasetId
    );
  }

  refreshDatasetStats(datasetId: string, now: string) {
    const items = sortByImageId(
      dataStore.all<{ image_id: string; ground_truth_label: string | null; segment_tags: string | null }>(
        "SELECT image_id, ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ?",
        datasetId
      )
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

  getDatasetProgress(datasetId: string): { total: number; labeled: number } {
    const row = dataStore.get<{ total: number; labeled: number }>(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ground_truth_label IS NOT NULL THEN 1 ELSE 0 END) as labeled
      FROM dataset_items WHERE dataset_id = ?`,
      datasetId
    );
    return { total: row?.total ?? 0, labeled: row?.labeled ?? 0 };
  }

  refreshItemsLabeledCount(datasetId: string) {
    dataStore.run(
      `UPDATE datasets SET items_labeled = (
        SELECT COUNT(*) FROM dataset_items
        WHERE dataset_items.dataset_id = ? AND ground_truth_label IS NOT NULL
      ) WHERE dataset_id = ?`,
      datasetId,
      datasetId
    );
  }

  updateItemStatus(itemId: string, status: string) {
    dataStore.run("UPDATE dataset_items SET item_status = ? WHERE item_id = ?", status, itemId);
  }

  setRevisionNote(datasetId: string, note: string | null) {
    dataStore.run(
      "UPDATE datasets SET revision_note = ?, updated_at = ? WHERE dataset_id = ?",
      note,
      new Date().toISOString(),
      datasetId
    );
  }

  duplicateDataset(input: {
    sourceDatasetId: string;
    newDatasetId: string;
    newName: string;
    assignedTo: string | null;
    resetLabels: boolean;
  }): void {
    const now = new Date().toISOString();
    const source = this.getDatasetById(input.sourceDatasetId);
    if (!source) throw new Error("Source dataset not found");

    const items = dataStore.all<{
      image_id: string;
      image_uri: string;
      image_description: string;
      segment_tags: string;
      ground_truth_label: string | null;
    }>(
      "SELECT image_id, image_uri, image_description, segment_tags, ground_truth_label FROM dataset_items WHERE dataset_id = ?",
      input.sourceDatasetId
    );

    const tx = dataStore.transaction((store, payload: typeof input) => {
      store.run(
        `INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, assigned_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
        payload.newDatasetId,
        payload.newName,
        source.detection_id,
        source.split_type,
        "",
        items.length,
        payload.assignedTo,
        now,
        now
      );

      for (const item of items) {
        store.run(
          `INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          crypto.randomUUID(),
          payload.newDatasetId,
          item.image_id,
          item.image_uri,
          item.image_description || "",
          payload.resetLabels ? "[]" : item.segment_tags,
          payload.resetLabels ? null : item.ground_truth_label
        );
      }
    });
    tx(input);

    this.refreshDatasetStats(input.newDatasetId, now);
  }

  createMasterDataset(input: {
    sourceDatasetIdA: string;
    sourceDatasetIdB: string;
    name: string;
    detectionId: string | null;
  }): string {
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    const itemsA = dataStore.all<{
      image_id: string;
      image_uri: string;
      image_description: string;
      segment_tags: string;
      ground_truth_label: string | null;
    }>(
      "SELECT image_id, image_uri, image_description, segment_tags, ground_truth_label FROM dataset_items WHERE dataset_id = ?",
      input.sourceDatasetIdA
    );

    const itemsB = dataStore.all<{
      image_id: string;
      image_uri: string;
      image_description: string;
      segment_tags: string;
      ground_truth_label: string | null;
    }>(
      "SELECT image_id, image_uri, image_description, segment_tags, ground_truth_label FROM dataset_items WHERE dataset_id = ?",
      input.sourceDatasetIdB
    );

    const seen = new Set<string>();
    const mergedItems: typeof itemsA = [];
    for (const item of [...itemsA, ...itemsB]) {
      if (!seen.has(item.image_id)) {
        seen.add(item.image_id);
        mergedItems.push(item);
      }
    }

    const tx = dataStore.transaction((store, items: typeof mergedItems) => {
      store.run(
        `INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, created_at, updated_at)
         VALUES (?, ?, ?, 'MASTER', ?, ?, 'finalized', ?, ?)`,
        newId,
        input.name,
        input.detectionId,
        "",
        items.length,
        now,
        now
      );

      for (const item of items) {
        store.run(
          `INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          crypto.randomUUID(),
          newId,
          item.image_id,
          item.image_uri,
          item.image_description || "",
          item.segment_tags || "[]",
          item.ground_truth_label
        );
      }
    });
    tx(mergedItems);

    this.refreshDatasetStats(newId, now);
    return newId;
  }

  getChildDatasets(parentId: string, options: { includeArchived?: boolean } = {}): any[] {
    const sql = options.includeArchived
      ? "SELECT * FROM datasets WHERE linked_dataset_id = ? ORDER BY name"
      : "SELECT * FROM datasets WHERE linked_dataset_id = ? AND qa_status != 'archived' ORDER BY name";
    return dataStore.all<any>(sql, parentId);
  }

  isParentDataset(datasetId: string): boolean {
    const row = dataStore.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM datasets WHERE linked_dataset_id = ?",
      datasetId
    );
    return (row?.c ?? 0) > 0;
  }

  batchCreateChildDatasets(input: {
    parentId: string;
    annotators: string[];
    resetLabels: boolean;
    resetSegments: boolean;
  }): string[] {
    const now = new Date().toISOString();
    const parent = this.getDatasetById(input.parentId);
    if (!parent) throw new Error("Parent dataset not found");

    const items = dataStore.all<{
      image_id: string;
      image_uri: string;
      image_description: string;
      segment_tags: string;
      ground_truth_label: string | null;
    }>(
      "SELECT image_id, image_uri, image_description, segment_tags, ground_truth_label FROM dataset_items WHERE dataset_id = ?",
      input.parentId
    );

    const childIds: string[] = [];

    const tx = dataStore.transaction((store, payload: { annotators: string[]; resetLabels: boolean; resetSegments: boolean }) => {
      for (const annotator of payload.annotators) {
        const childId = crypto.randomUUID();
        childIds.push(childId);

        store.run(
          `INSERT INTO datasets (dataset_id, name, detection_id, split_type, dataset_hash, size, qa_status, assigned_to, linked_dataset_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', ?, 'assigned', ?, ?, ?, ?)`,
          childId,
          `${parent.name} - ${annotator}`,
          parent.detection_id,
          parent.split_type,
          items.length,
          annotator,
          input.parentId,
          now,
          now
        );

        for (const item of items) {
          store.run(
            `INSERT INTO dataset_items (item_id, dataset_id, image_id, image_uri, image_description, segment_tags, ai_assigned_label, ai_confidence, ground_truth_label)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
            crypto.randomUUID(),
            childId,
            item.image_id,
            item.image_uri,
            item.image_description || "",
            payload.resetSegments ? "[]" : item.segment_tags,
            payload.resetLabels ? null : item.ground_truth_label
          );
        }
      }
    });
    tx(input);

    for (const childId of childIds) {
      this.refreshDatasetStats(childId, now);
    }
    return childIds;
  }

  getMergeConflicts(parentId: string, excludeAttributes = false): Array<{ image_id: string; labels: Array<{ annotator: string; label: string; tags: string }> }> {
    const children = this.getChildDatasets(parentId);
    if (children.length === 0) return [];

    const imageLabels = new Map<string, Array<{ annotator: string; label: string; tags: string }>>();

    for (const child of children) {
      const items = dataStore.all<{ image_id: string; ground_truth_label: string | null; segment_tags: string }>(
        "SELECT image_id, ground_truth_label, segment_tags FROM dataset_items WHERE dataset_id = ? AND ground_truth_label IS NOT NULL",
        child.dataset_id
      );
      for (const item of items) {
        if (!imageLabels.has(item.image_id)) imageLabels.set(item.image_id, []);
        imageLabels.get(item.image_id)!.push({
          annotator: child.assigned_to || child.name,
          label: item.ground_truth_label!,
          tags: item.segment_tags || "[]",
        });
      }
    }

    const conflicts: Array<{ image_id: string; labels: Array<{ annotator: string; label: string; tags: string }> }> = [];
    for (const [imageId, entries] of imageLabels) {
      if (entries.length < 2) continue;
      // When attributes are excluded from the review, only label disagreements
      // count as discrepancies — differing attribute tags are ignored.
      const allAgree = excludeAttributes
        ? entries.every((e) => e.label === entries[0].label)
        : entries.every((e) => e.label === entries[0].label && e.tags === entries[0].tags);
      if (!allAgree) conflicts.push({ image_id: imageId, labels: entries });
    }
    return conflicts;
  }

  getCorrections(childDatasetId: string): Array<{ image_id: string; child_label: string; parent_label: string; child_tags: string[]; parent_tags: string[] }> {
    const child = this.getDatasetById(childDatasetId);
    if (!child || !child.linked_dataset_id) return [];

    const rows = dataStore.all<{ image_id: string; child_label: string; child_tags: string; parent_label: string; parent_tags: string }>(
      `SELECT
        ci.image_id,
        ci.ground_truth_label AS child_label,
        ci.segment_tags AS child_tags,
        pi.ground_truth_label AS parent_label,
        pi.segment_tags AS parent_tags
      FROM dataset_items ci
      JOIN dataset_items pi ON ci.image_id = pi.image_id AND pi.dataset_id = ?
      WHERE ci.dataset_id = ?
        AND ci.ground_truth_label IS NOT NULL
        AND pi.ground_truth_label IS NOT NULL
        AND (ci.ground_truth_label != pi.ground_truth_label OR ci.segment_tags != pi.segment_tags)`,
      child.linked_dataset_id,
      childDatasetId
    );

    return rows.map((r) => ({
      image_id: r.image_id,
      child_label: r.child_label,
      parent_label: r.parent_label,
      child_tags: JSON.parse(r.child_tags || "[]"),
      parent_tags: JSON.parse(r.parent_tags || "[]"),
    }));
  }

  mergeChildrenIntoParent(parentId: string, resolutions: Array<{ image_id: string; label: string; tags?: string[] }>, excludeAttributes = false): void {
    const now = new Date().toISOString();
    const children = this.getChildDatasets(parentId);
    if (children.length === 0) throw new Error("No child datasets to merge");

    const resolutionMap = new Map(resolutions.map((r) => [r.image_id, r]));

    // Agreed label/tags (first child's values) plus, when attributes are
    // excluded from review, the union of every child's tags for each image.
    const imageLabels = new Map<string, { label: string; tags: string }>();
    const imageTagUnion = new Map<string, Set<string>>();
    // Distinct, non-empty annotator notes per image, preserved in child order,
    // so annotator notes surface as the master's image description.
    const imageNotes = new Map<string, string[]>();
    for (const child of children) {
      const items = dataStore.all<{ image_id: string; ground_truth_label: string | null; segment_tags: string; image_description: string | null }>(
        "SELECT image_id, ground_truth_label, segment_tags, image_description FROM dataset_items WHERE dataset_id = ? AND ground_truth_label IS NOT NULL",
        child.dataset_id
      );
      for (const item of items) {
        if (!imageLabels.has(item.image_id)) {
          imageLabels.set(item.image_id, { label: item.ground_truth_label!, tags: item.segment_tags || "[]" });
        }
        const note = (item.image_description || "").trim();
        if (note) {
          if (!imageNotes.has(item.image_id)) imageNotes.set(item.image_id, []);
          const notes = imageNotes.get(item.image_id)!;
          if (!notes.includes(note)) notes.push(note);
        }
        if (excludeAttributes) {
          if (!imageTagUnion.has(item.image_id)) imageTagUnion.set(item.image_id, new Set<string>());
          const union = imageTagUnion.get(item.image_id)!;
          try {
            const parsed = JSON.parse(item.segment_tags || "[]");
            if (Array.isArray(parsed)) parsed.forEach((t) => union.add(String(t)));
          } catch {
            /* ignore malformed tags */
          }
        }
      }
    }

    const tx = dataStore.transaction((store, _payload: null) => {
      for (const [imageId, agreed] of imageLabels) {
        const resolution = resolutionMap.get(imageId);
        const finalLabel = resolution ? resolution.label : agreed.label;
        // When attributes are excluded, the parent's tags become the union of
        // all child datasets' tags for the image (reviewer tag edits ignored).
        let finalTags: string;
        if (excludeAttributes) {
          finalTags = JSON.stringify([...(imageTagUnion.get(imageId) ?? new Set<string>())]);
        } else {
          finalTags = resolution?.tags ? JSON.stringify(resolution.tags) : agreed.tags;
        }

        store.run(
          "UPDATE dataset_items SET ground_truth_label = ?, segment_tags = ?, item_status = 'labeled' WHERE dataset_id = ? AND image_id = ?",
          finalLabel,
          finalTags,
          parentId,
          imageId
        );

        // Carry annotator notes into the master's image description. Only write
        // when at least one annotator left a note so existing descriptions are
        // preserved for images without notes.
        const notes = imageNotes.get(imageId);
        if (notes && notes.length > 0) {
          store.run(
            "UPDATE dataset_items SET image_description = ? WHERE dataset_id = ? AND image_id = ?",
            notes.join("\n"),
            parentId,
            imageId
          );
        }
      }

      store.run("UPDATE datasets SET qa_status = 'finalized', split_type = 'MASTER', updated_at = ? WHERE dataset_id = ?", now, parentId);

      for (const child of children) {
        store.run("UPDATE datasets SET qa_status = 'archived', updated_at = ? WHERE dataset_id = ?", now, child.dataset_id);
      }
    });
    tx(null);

    this.refreshDatasetStats(parentId, now);
    this.refreshItemsLabeledCount(parentId);
  }
}

export const datasetRepository = new DatasetRepository();
