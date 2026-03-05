import type { Prediction } from "@/types";
import { dataStore } from "@/lib/services";
import { sortByImageId } from "@/lib/imageIdSort";

export class RunRepository {
  getRunById(runId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM runs WHERE run_id = ?", runId);
  }

  getRunPredictions(runId: string): Prediction[] {
    return sortByImageId(dataStore.all<Prediction>("SELECT * FROM predictions WHERE run_id = ?", runId));
  }

  listRuns(filters: {
    detectionId?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    paginated?: boolean;
  }): { rows: any[]; total: number } {
    const { detectionId, status, search = "", page = 1, pageSize = 50, paginated = false } = filters;
    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (detectionId) {
      whereClauses.push("detection_id = ?");
      params.push(detectionId);
    }
    if (status) {
      whereClauses.push("status = ?");
      params.push(status);
    }
    if (search) {
      whereClauses.push(
        "(run_id LIKE ? OR prompt_version_id LIKE ? OR model_used LIKE ? OR split_type LIKE ? OR dataset_id LIKE ?)"
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const totalRow = dataStore.get<{ count: number }>(`SELECT COUNT(*) as count FROM runs ${whereSql}`, ...params);
    const rows = dataStore.all<any>(
      `SELECT * FROM runs ${whereSql} ORDER BY created_at DESC ${paginated ? "LIMIT ? OFFSET ?" : ""}`,
      ...params,
      ...(paginated ? [pageSize, (page - 1) * pageSize] : [])
    );

    return { rows, total: Number(totalRow?.count || 0) };
  }

  getPromptVersionById(promptVersionId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM prompt_versions WHERE prompt_version_id = ?", promptVersionId);
  }

  getDatasetById(datasetId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM datasets WHERE dataset_id = ?", datasetId);
  }

  getDatasetItems(datasetId: string): any[] {
    return sortByImageId(dataStore.all<any>("SELECT * FROM dataset_items WHERE dataset_id = ?", datasetId));
  }

  getDetectionById(detectionId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM detections WHERE detection_id = ?", detectionId);
  }

  createRun(input: {
    runId: string;
    detectionId: string;
    promptVersionId: string;
    modelUsed: string;
    promptSnapshot: string;
    decodingParams: string;
    datasetId: string;
    datasetHash: string;
    splitType: string;
    createdAt: string;
    totalImages: number;
  }) {
    dataStore.run(
      `INSERT INTO runs (run_id, detection_id, prompt_version_id, model_used, prompt_snapshot, decoding_params, dataset_id, dataset_hash, split_type, created_at, status, total_images, processed_images)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, 0)`,
      input.runId,
      input.detectionId,
      input.promptVersionId,
      input.modelUsed,
      input.promptSnapshot,
      input.decodingParams,
      input.datasetId,
      input.datasetHash,
      input.splitType,
      input.createdAt,
      input.totalImages
    );
  }

  insertPrediction(pred: Prediction, errorTag: string | null) {
    dataStore.run(
      `INSERT INTO predictions (
        prediction_id, run_id, image_id, image_uri, ground_truth_label, predicted_decision, confidence, evidence,
        parse_ok, raw_response, parse_error_reason, parse_fix_suggestion, inference_runtime_ms, parse_retry_count, error_tag
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pred.prediction_id,
      pred.run_id,
      pred.image_id,
      pred.image_uri,
      pred.ground_truth_label,
      pred.predicted_decision,
      pred.confidence,
      pred.evidence,
      pred.parse_ok ? 1 : 0,
      pred.raw_response,
      pred.parse_error_reason ?? null,
      pred.parse_fix_suggestion ?? null,
      pred.inference_runtime_ms ?? null,
      pred.parse_retry_count ?? 0,
      errorTag
    );
  }

  updateProcessedImages(runId: string, processed: number) {
    dataStore.run("UPDATE runs SET processed_images = ? WHERE run_id = ?", processed, runId);
  }

  updateRunCompletion(runId: string, metricsSummary: string, status: string, processed: number) {
    dataStore.run(
      "UPDATE runs SET metrics_summary = ?, status = ?, processed_images = ? WHERE run_id = ?",
      metricsSummary,
      status,
      processed,
      runId
    );
  }

  markRunFailed(runId: string) {
    dataStore.run("UPDATE runs SET status = 'failed' WHERE run_id = ?", runId);
  }

  getRunStatus(runId: string): { status?: string } | undefined {
    return dataStore.get<{ status?: string }>("SELECT status FROM runs WHERE run_id = ?", runId);
  }

  markRunCancelled(runId: string) {
    dataStore.run("UPDATE runs SET status = 'cancelled' WHERE run_id = ?", runId);
  }

  setPromptFeedbackLog(runId: string, promptFeedbackLog: string) {
    dataStore.run("UPDATE runs SET prompt_feedback_log = ? WHERE run_id = ?", promptFeedbackLog, runId);
  }
}

export const runRepository = new RunRepository();
