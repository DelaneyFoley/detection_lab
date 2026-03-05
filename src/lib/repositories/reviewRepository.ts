import type { Prediction } from "@/types";
import { dataStore } from "@/lib/services";

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
