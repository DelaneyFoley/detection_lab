import { dataStore } from "@/lib/services";

export class PromptRepository {
  listPromptVersions(detectionId?: string): any[] {
    if (detectionId) {
      return dataStore.all<any>(
        "SELECT * FROM prompt_versions WHERE detection_id = ? ORDER BY created_at DESC",
        detectionId
      );
    }
    return dataStore.all<any>("SELECT * FROM prompt_versions ORDER BY created_at DESC");
  }

  createPromptVersion(input: {
    promptVersionId: string;
    detectionId: string;
    versionLabel: string;
    systemPrompt: string;
    userPromptTemplate: string;
    promptStructure: string;
    model: string;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    changeNotes: string;
    versionNotes?: string;
    createdBy: string;
    createdAt: string;
    sourcePromptVersionId?: string | null;
  }) {
    dataStore.run(
      `INSERT INTO prompt_versions (prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template, prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, version_notes, created_by, created_at, source_prompt_version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.promptVersionId,
      input.detectionId,
      input.versionLabel,
      input.systemPrompt,
      input.userPromptTemplate,
      input.promptStructure,
      input.model,
      input.temperature,
      input.topP,
      input.maxOutputTokens,
      input.changeNotes,
      input.versionNotes || "",
      input.createdBy,
      input.createdAt,
      input.sourcePromptVersionId ?? null
    );
  }

  updateVersionNotes(promptVersionId: string, versionNotes: string) {
    dataStore.run(
      "UPDATE prompt_versions SET version_notes = ? WHERE prompt_version_id = ?",
      versionNotes,
      promptVersionId
    );
  }

  setGoldenRegressionResult(promptVersionId: string, resultJson: string) {
    dataStore.run(
      "UPDATE prompt_versions SET golden_set_regression_result = ? WHERE prompt_version_id = ?",
      resultJson,
      promptVersionId
    );
  }

  getPromptById(promptVersionId: string): any | undefined {
    return dataStore.get<any>(
      "SELECT prompt_version_id, detection_id FROM prompt_versions WHERE prompt_version_id = ?",
      promptVersionId
    );
  }

  getFullPromptById(promptVersionId: string): any | undefined {
    return dataStore.get<any>(
      "SELECT * FROM prompt_versions WHERE prompt_version_id = ?",
      promptVersionId
    );
  }

  /** True if a version_label already exists for the given detection. */
  versionLabelExists(detectionId: string, versionLabel: string): boolean {
    const row = dataStore.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM prompt_versions WHERE detection_id = ? AND version_label = ?",
      detectionId,
      versionLabel
    );
    return (row?.c ?? 0) > 0;
  }

  /**
   * Return a version_label guaranteed unique for the detection. If `desired`
   * is taken, append `-2`, `-3`, … until a free label is found.
   */
  uniqueVersionLabel(detectionId: string, desired: string): string {
    const base = String(desired || "prompt").trim() || "prompt";
    if (!this.versionLabelExists(detectionId, base)) return base;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base}-${n}`;
      if (!this.versionLabelExists(detectionId, candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  deletePromptCascade(promptVersionId: string, detectionId: string) {
    const tx = dataStore.transaction((store, targetPromptId: string, targetDetectionId: string) => {
      const runIds = store.all<{ run_id: string }>(
        "SELECT run_id FROM runs WHERE prompt_version_id = ?",
        targetPromptId
      );
      for (const r of runIds) {
        // Remove rows that reference this run's predictions/run before the
        // predictions themselves, or SQLite raises FOREIGN KEY constraint failed.
        store.run(
          "DELETE FROM review_flags WHERE prediction_id IN (SELECT prediction_id FROM predictions WHERE run_id = ?)",
          r.run_id
        );
        store.run("DELETE FROM groundtruth_corrections WHERE run_id = ?", r.run_id);
        store.run("DELETE FROM predictions WHERE run_id = ?", r.run_id);
      }
      store.run("DELETE FROM runs WHERE prompt_version_id = ?", targetPromptId);
      // Version-note entries FK to prompt_versions — remove them before the version.
      store.run("DELETE FROM version_note_entries WHERE prompt_version_id = ?", targetPromptId);
      store.run("DELETE FROM prompt_versions WHERE prompt_version_id = ?", targetPromptId);
      store.run(
        `UPDATE detections
         SET approved_prompt_version = CASE WHEN approved_prompt_version = ? THEN NULL ELSE approved_prompt_version END
         WHERE detection_id = ?`,
        targetPromptId,
        targetDetectionId
      );
    });

    tx(promptVersionId, detectionId);
  }
}

export const promptRepository = new PromptRepository();
