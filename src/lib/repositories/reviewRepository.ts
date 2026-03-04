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

  updateRunMetrics(runId: string, metricsJson: string) {
    dataStore.run("UPDATE runs SET metrics_summary = ? WHERE run_id = ?", metricsJson, runId);
  }
}

export const reviewRepository = new ReviewRepository();
