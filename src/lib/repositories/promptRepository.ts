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
    createdBy: string;
    createdAt: string;
  }) {
    dataStore.run(
      `INSERT INTO prompt_versions (prompt_version_id, detection_id, version_label, system_prompt, user_prompt_template, prompt_structure, model, temperature, top_p, max_output_tokens, change_notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.createdBy,
      input.createdAt
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

  deletePromptCascade(promptVersionId: string, detectionId: string) {
    const tx = dataStore.transaction((store, targetPromptId: string, targetDetectionId: string) => {
      const runIds = store.all<{ run_id: string }>(
        "SELECT run_id FROM runs WHERE prompt_version_id = ?",
        targetPromptId
      );
      for (const r of runIds) {
        store.run("DELETE FROM predictions WHERE run_id = ?", r.run_id);
      }
      store.run("DELETE FROM runs WHERE prompt_version_id = ?", targetPromptId);
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
