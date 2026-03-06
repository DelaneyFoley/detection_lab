import { dataStore } from "@/lib/services";

export class DetectionRepository {
  listDetections(filters: {
    search?: string;
    page?: number;
    pageSize?: number;
    paginated?: boolean;
  }): { rows: any[]; total: number } {
    const { search = "", page = 1, pageSize = 50, paginated = false } = filters;
    if (!search && !paginated) {
      const rows = dataStore.all<any>("SELECT * FROM detections ORDER BY created_at DESC");
      return { rows, total: rows.length };
    }

    const where = search ? "WHERE detection_code LIKE ? OR display_name LIKE ? OR description LIKE ?" : "";
    const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
    const totalRow = dataStore.get<{ count: number }>(`SELECT COUNT(*) as count FROM detections ${where}`, ...params);
    const rows = dataStore.all<any>(
      `SELECT * FROM detections ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize
    );
    return { rows, total: Number(totalRow?.count || 0) };
  }

  getDetectionById(detectionId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM detections WHERE detection_id = ?", detectionId);
  }

  createDetection(input: {
    detectionId: string;
    detectionCode: string;
    displayName: string;
    description: string;
    labelPolicy: string;
    decisionRubricJson: string;
    segmentTaxonomyJson: string;
    metricThresholdsJson: string;
    createdAt: string;
    updatedAt: string;
  }) {
    dataStore.run(
      `INSERT INTO detections (detection_id, detection_code, display_name, description, label_policy, decision_rubric, segment_taxonomy, metric_thresholds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.detectionId,
      input.detectionCode,
      input.displayName,
      input.description,
      input.labelPolicy,
      input.decisionRubricJson,
      input.segmentTaxonomyJson,
      input.metricThresholdsJson,
      input.createdAt,
      input.updatedAt
    );
  }

  updateDetection(input: {
    detectionId: string;
    displayName: string;
    description: string;
    labelPolicy: string;
    decisionRubricJson: string;
    segmentTaxonomyJson: string;
    metricThresholdsJson: string;
    approvedPromptVersion: string | null;
    updatedAt: string;
  }) {
    dataStore.run(
      `UPDATE detections SET
         display_name = ?,
         description = ?,
         label_policy = ?,
         decision_rubric = ?,
         segment_taxonomy = ?,
         metric_thresholds = ?,
         approved_prompt_version = ?,
         updated_at = ?
       WHERE detection_id = ?`,
      input.displayName,
      input.description,
      input.labelPolicy,
      input.decisionRubricJson,
      input.segmentTaxonomyJson,
      input.metricThresholdsJson,
      input.approvedPromptVersion,
      input.updatedAt,
      input.detectionId
    );
  }

  deleteDetectionCascade(detectionId: string) {
    const tx = dataStore.transaction((store, targetDetectionId: string) => {
      const runs = store.all<{ run_id: string }>("SELECT run_id FROM runs WHERE detection_id = ?", targetDetectionId);
      for (const r of runs) {
        store.run("DELETE FROM predictions WHERE run_id = ?", r.run_id);
      }
      store.run("DELETE FROM runs WHERE detection_id = ?", targetDetectionId);
      // Preserve datasets and dataset_items; unassign them from this detection.
      store.run("UPDATE datasets SET detection_id = NULL WHERE detection_id = ?", targetDetectionId);
      store.run("DELETE FROM prompt_versions WHERE detection_id = ?", targetDetectionId);
      store.run("DELETE FROM detections WHERE detection_id = ?", targetDetectionId);
    });

    tx(detectionId);
  }
}

export const detectionRepository = new DetectionRepository();
