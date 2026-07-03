import type { Prediction } from "@/types";
import { dataStore } from "@/lib/services";
import { v4 as uuid } from "uuid";

export class ReviewRepository {
  getPredictionById(predictionId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM predictions WHERE prediction_id = ?", predictionId);
  }

  updatePredictionReview(input: {
    predictionId: string;
    correctedLabel: string | null;
    errorTag: string | null;
    reviewerNote: string | null;
    correctedAt: string;
  }) {
    dataStore.run(
      `UPDATE predictions SET
         corrected_label = ?,
         error_tag = ?,
         reviewer_note = ?,
         corrected_at = ?
       WHERE prediction_id = ?`,
      input.correctedLabel,
      input.errorTag,
      input.reviewerNote,
      input.correctedAt,
      input.predictionId
    );
  }

  updatePredictionGroundTruth(predictionId: string, groundTruthLabel: string | null) {
    dataStore.run("UPDATE predictions SET ground_truth_label = ? WHERE prediction_id = ?", groundTruthLabel, predictionId);
  }

  getRunById(runId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM runs WHERE run_id = ?", runId);
  }

  getDatasetById(datasetId: string): any | undefined {
    return dataStore.get<any>("SELECT * FROM datasets WHERE dataset_id = ?", datasetId);
  }

  updateDatasetItemGroundTruth(datasetId: string, imageId: string, groundTruthLabel: string | null) {
    dataStore.run(
      "UPDATE dataset_items SET ground_truth_label = ? WHERE dataset_id = ? AND image_id = ?",
      groundTruthLabel,
      datasetId,
      imageId
    );
  }

  updateDatasetItemDescription(datasetId: string, imageId: string, description: string | null) {
    dataStore.run(
      "UPDATE dataset_items SET image_description = ? WHERE dataset_id = ? AND image_id = ?",
      description,
      datasetId,
      imageId
    );
  }

  getDatasetItemDescription(datasetId: string, imageId: string): string | null {
    const row = dataStore.get<{ image_description: string | null }>(
      "SELECT image_description FROM dataset_items WHERE dataset_id = ? AND image_id = ?",
      datasetId,
      imageId
    );
    return row?.image_description || null;
  }

  getRunPredictions(runId: string): Prediction[] {
    return dataStore.all<Prediction>("SELECT * FROM predictions WHERE run_id = ?", runId);
  }

  getDatasetSegmentTagsByImageId(datasetId: string): Map<string, string[]> {
    const rows = dataStore.all<{ image_id: string; segment_tags: string | null }>(
      "SELECT image_id, segment_tags FROM dataset_items WHERE dataset_id = ?",
      datasetId
    );
    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(String(row.image_id || ""), this.parseSegmentTags(row.segment_tags));
    }
    return map;
  }

  updateRunMetrics(runId: string, metricsJson: string) {
    dataStore.run("UPDATE runs SET metrics_summary = ? WHERE run_id = ?", metricsJson, runId);
  }

  logGroundtruthCorrection(input: {
    predictionId: string;
    runId: string;
    datasetId: string;
    imageId: string;
    oldLabel: string | null;
    newLabel: string | null;
    predictedDecision: string | null;
    reason: string | null;
    actor?: string | null;
  }): string {
    const id = uuid();
    const now = new Date().toISOString();
    let aiMatches: number | null = null;
    if (input.newLabel && input.predictedDecision && input.predictedDecision !== "PARSE_FAIL") {
      aiMatches = input.predictedDecision === input.newLabel ? 1 : 0;
    }
    dataStore.run(
      `INSERT INTO groundtruth_corrections
        (correction_id, prediction_id, run_id, dataset_id, image_id, old_label, new_label, predicted_decision, ai_matches_new_gt, reason, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.predictionId,
      input.runId,
      input.datasetId,
      input.imageId,
      input.oldLabel,
      input.newLabel,
      input.predictedDecision,
      aiMatches,
      input.reason,
      input.actor || "user",
      now
    );
    return id;
  }

  getGroundtruthCorrectionsByRun(runId: string): any[] {
    return dataStore.all<any>(
      `SELECT * FROM groundtruth_corrections WHERE run_id = ? ORDER BY created_at DESC`,
      runId
    );
  }

  private parseSegmentTags(value: unknown): string[] {
    if (Array.isArray(value)) return this.normalizeSegmentTags(value);
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return this.normalizeSegmentTags(parsed);
      } catch {
        return this.normalizeSegmentTags(value);
      }
    }
    return ["Baseline"];
  }

  private normalizeSegmentTags(value: unknown): string[] {
    const rawParts = Array.isArray(value)
      ? value.map((v) => String(v || ""))
      : String(value || "")
          .split(/[;,|]/g)
          .map((v) => String(v || ""));
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of rawParts) {
      const clean = part.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(clean);
    }
    return tags.length > 0 ? tags : ["Baseline"];
  }
}

export const reviewRepository = new ReviewRepository();
