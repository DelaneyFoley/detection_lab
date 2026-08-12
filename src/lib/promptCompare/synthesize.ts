import { v4 as uuid } from "uuid";
import { promptCompareJobRepository } from "@/lib/repositories/promptCompareJobRepository";
import {
  datasetRepository,
  promptRepository,
  runRepository,
  versionNoteEntryRepository,
} from "@/lib/repositories";
import { compareJobQueue } from "@/lib/services";
import { computeMetrics } from "@/lib/metrics";
import { runDetectionInference } from "@/lib/inference";
import { getProvider, PROVIDER_ENV_KEY } from "@/lib/models";
import { logger } from "@/lib/logger";
import { confusionFromPairs, metricsFromConfusion } from "@/lib/promptIteration/metrics";
import { aiVersionLabel, buildPromptVersionInput } from "@/lib/promptIteration/saving";
import type { Decision, ErrorTag, MetricsSummary, Prediction, PromptVersion } from "@/types";
import type {
  ClassifiedRow,
  ComparePhase,
  CompareJob,
  EvalPromptComparison,
} from "@/lib/promptCompare/types";
import {
  buildComparisonMatrix,
  classifyRows,
  perPromptDisagreementMetrics,
  sampleAgreementCounterexamples,
  selectDisagreementImages,
  type PromptRunPredictions,
} from "@/lib/promptCompare/disagreementSet";
import { extractPromptFields, runAnalyzer } from "@/lib/promptCompare/analyzerPrompt";
import { generateCompareReport } from "@/lib/promptCompare/report";

/** Pick the most recent completed run for a prompt on a given dataset. */
function pickLatestCompletedRun(runs: any[], promptId: string, datasetId: string): any | null {
  const matching = runs.filter(
    (r) => r.prompt_version_id === promptId && r.dataset_id === datasetId && r.status === "completed"
  );
  matching.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return matching[0] ?? null;
}

function parseStructure(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

interface EvalOutcome {
  image_id: string;
  image_uri: string;
  truth: Decision | null;
  predicted: Decision | null;
  confidence: number | null;
  evidence: string | null;
  parse_ok: boolean;
  raw: string;
  parse_error_reason: string | null;
  parse_fix_suggestion: string | null;
  runtime_ms: number | null;
}

function deriveErrorTag(p: EvalOutcome): ErrorTag | null {
  if (p.parse_ok) return null;
  const raw = String(p.raw || "");
  const reason = String(p.parse_error_reason || "");
  if (raw.startsWith("ERROR:") || reason.startsWith("Model/API error:")) {
    return "INFERENCE_CALL_FAILED";
  }
  return "SCHEMA_VIOLATION";
}

/**
 * Run the merged prompt on every disagreement image so we can compare it to
 * each source prompt on identical inputs. Returns predictions + a CUSTOM dataset
 * + a real Run so the result surfaces in normal Detection Lab UI.
 */
async function evaluateSynthesizedPrompt(params: {
  detectionId: string;
  detectionCode: string;
  jobId: string;
  disagreementRows: ClassifiedRow[];
  synthesizedPromptId: string;
  synthesizedPromptVersion: PromptVersion;
  apiKey: string;
  modelUsed: string;
  logProgress: (message: string) => void;
  isCancelled: () => boolean;
}): Promise<{
  datasetId: string | null;
  runId: string | null;
  outcomes: EvalOutcome[];
  metrics: MetricsSummary | null;
}> {
  const { disagreementRows, synthesizedPromptVersion, apiKey, detectionCode } = params;
  if (disagreementRows.length === 0) {
    return { datasetId: null, runId: null, outcomes: [], metrics: null };
  }

  // Materialize a CUSTOM dataset for the disagreement image set so the eval run
  // shows up in normal PromptCompare on that dataset for later comparison.
  const datasetId = uuid();
  const now = new Date().toISOString();
  const datasetName = `${detectionCode}-compare-${params.jobId.slice(0, 8)}`;
  datasetRepository.createDataset({
    datasetId,
    name: datasetName,
    detectionId: params.detectionId,
    splitType: "CUSTOM",
    datasetHash: `${params.jobId.slice(0, 12)}-dis-${disagreementRows.length}`,
    size: disagreementRows.length,
    createdAt: now,
    updatedAt: now,
  });
  datasetRepository.insertDatasetItems(
    disagreementRows.map((row) => ({
      itemId: uuid(),
      datasetId,
      imageId: row.image_id,
      imageUri: row.image_uri,
      imageDescription: "",
      segmentTagsJson: "[]",
      groundTruthLabel: row.ground_truth,
    }))
  );

  const runId = uuid();
  runRepository.createRun({
    runId,
    detectionId: params.detectionId,
    promptVersionId: params.synthesizedPromptId,
    modelUsed: params.modelUsed,
    promptSnapshot: JSON.stringify({ source: "prompt_compare_synthesis", job_id: params.jobId }),
    decodingParams: JSON.stringify({ model: params.modelUsed }),
    datasetId,
    datasetHash: `${params.jobId.slice(0, 12)}-dis-${disagreementRows.length}`,
    splitType: "CUSTOM",
    createdAt: new Date().toISOString(),
    totalImages: disagreementRows.length,
  });

  const outcomes: EvalOutcome[] = new Array(disagreementRows.length);
  const maxConcurrency = 4;
  let cursor = 0;
  let processed = 0;

  const worker = async () => {
    while (true) {
      if (params.isCancelled()) return;
      const i = cursor;
      if (i >= disagreementRows.length) return;
      cursor += 1;
      const row = disagreementRows[i];
      try {
        const res = await runDetectionInference(
          apiKey,
          synthesizedPromptVersion,
          detectionCode,
          row.image_uri
        );
        outcomes[i] = {
          image_id: row.image_id,
          image_uri: row.image_uri,
          truth: row.ground_truth,
          predicted: (res.parsed?.decision || null) as Decision | null,
          confidence: res.parsed?.confidence ?? null,
          evidence: res.parsed?.evidence || null,
          parse_ok: res.parseOk,
          raw: res.raw,
          parse_error_reason: res.parseErrorReason,
          parse_fix_suggestion: res.parseFixSuggestion,
          runtime_ms: res.runtimeMs,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        outcomes[i] = {
          image_id: row.image_id,
          image_uri: row.image_uri,
          truth: row.ground_truth,
          predicted: null,
          confidence: null,
          evidence: null,
          parse_ok: false,
          raw: `ERROR: ${msg}`,
          parse_error_reason: `Model/API error: ${msg}`,
          parse_fix_suggestion: "Verify API key/model availability and retry.",
          runtime_ms: null,
        };
      } finally {
        processed += 1;
        if (processed % 5 === 0 || processed === disagreementRows.length) {
          params.logProgress(`Evaluated ${processed}/${disagreementRows.length} disagreement images`);
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, disagreementRows.length) }, () => worker())
  );

  const filled = outcomes.filter(Boolean);
  const predictions: Prediction[] = filled.map((o) => ({
    prediction_id: uuid(),
    run_id: runId,
    image_id: o.image_id,
    image_uri: o.image_uri,
    ground_truth_label: o.truth,
    predicted_decision: o.predicted,
    confidence: o.confidence,
    evidence: o.evidence,
    parse_ok: o.parse_ok,
    raw_response: o.raw,
    parse_error_reason: o.parse_error_reason,
    parse_fix_suggestion: o.parse_fix_suggestion,
    inference_runtime_ms: o.runtime_ms,
    parse_retry_count: 0,
    corrected_label: null,
    error_tag: deriveErrorTag(o),
    reviewer_note: null,
    corrected_at: null,
  }));
  for (const pred of predictions) {
    runRepository.insertPrediction(pred, pred.error_tag);
  }
  const metrics = computeMetrics(predictions);
  runRepository.updateRunCompletion(runId, JSON.stringify(metrics), "completed", predictions.length);
  return { datasetId, runId, outcomes: filled, metrics };
}

/**
 * Compare synthesized outcomes vs each source prompt on identical image ids.
 * Returns per-source-prompt P/R/F1 pairs restricted to the disagreement set.
 */
function buildEvalComparisons(
  outcomes: EvalOutcome[],
  disagreementRows: ClassifiedRow[],
  sources: Array<{ prompt_version_id: string; label: string }>
): EvalPromptComparison[] {
  const outcomeByImage = new Map(outcomes.map((o) => [o.image_id, o] as const));
  return sources.map((sp) => {
    const sourcePairs = disagreementRows
      .map((row) => {
        const per = row.per_prompt.find((p) => p.prompt_version_id === sp.prompt_version_id);
        if (!per) return null;
        return { predicted: per.predicted, truth: row.ground_truth, parseOk: per.parse_ok };
      })
      .filter((v): v is { predicted: Decision | null; truth: Decision | null; parseOk: boolean } => v !== null);
    const synthPairs = disagreementRows
      .map((row) => {
        const outcome = outcomeByImage.get(row.image_id);
        if (!outcome) return null;
        return { predicted: outcome.predicted, truth: row.ground_truth, parseOk: outcome.parse_ok };
      })
      .filter((v): v is { predicted: Decision | null; truth: Decision | null; parseOk: boolean } => v !== null);
    return {
      prompt_version_id: sp.prompt_version_id,
      label: sp.label,
      source_metrics: metricsFromConfusion(confusionFromPairs(sourcePairs)),
      synthesized_metrics: metricsFromConfusion(confusionFromPairs(synthPairs)),
    };
  });
}

/**
 * Full prompt-compare synthesis job. Loads every selected prompt's completed
 * runs across the datasets they all share, computes the union of prompt-vs-prompt
 * and prompt-vs-ground-truth disagreements, sends the actual images + evidence
 * + reviewer notes + full source prompts to a single analyzer LLM call, saves
 * the compiled merged prompt as a new PromptVersion, and optionally evaluates
 * it on the disagreement image set for a direct head-to-head.
 *
 * Fire-and-forget: the caller returns immediately from the API; progress lands
 * on the job row.
 */
export async function runPromptCompareSynthesisJob(
  jobId: string,
  requestApiKey?: string | null
): Promise<void> {
  const repo = promptCompareJobRepository;
  const control = compareJobQueue.get(jobId) || compareJobQueue.create(jobId);
  const isCancelled = () => control.cancelRequested || repo.getJob(jobId)?.status === "canceled";

  const setPhase = (phase: ComparePhase, progress: number, message?: string) => {
    repo.updateJob(jobId, { phase, progress });
    if (message) repo.appendLog(jobId, phase, message);
  };

  const finishCanceled = () => {
    repo.updateJob(jobId, { status: "canceled", finished_at: new Date().toISOString() });
    repo.appendLog(jobId, "done" as ComparePhase, "Job canceled");
    compareJobQueue.delete(jobId);
  };

  try {
    const job = repo.getJob(jobId);
    if (!job) return;
    repo.updateJob(jobId, {
      status: "running",
      started_at: new Date().toISOString(),
      phase: "preparing",
      progress: 2,
    });
    repo.appendLog(jobId, "preparing", "Loading source prompts");

    // ── Load prompts + detection ──────────────────────────────────────────────
    const prompts: PromptVersion[] = job.source_prompt_version_ids
      .map((id) => promptRepository.getFullPromptById(id))
      .filter((p): p is PromptVersion => Boolean(p));
    if (prompts.length !== job.source_prompt_version_ids.length) {
      throw new Error("One or more prompt versions were not found");
    }
    if (prompts.length < 2) {
      throw new Error("At least 2 prompt versions are required");
    }
    const detectionIds = new Set(prompts.map((p) => p.detection_id));
    if (detectionIds.size > 1) {
      throw new Error("All prompts must belong to the same detection");
    }
    const detection = runRepository.getDetectionById(job.detection_id);
    if (!detection) throw new Error("Detection not found");

    // ── Load runs + build shared-dataset intersection ────────────────────────
    setPhase("loading", 8, "Finding shared datasets");
    const runsByPromptDataset = new Map<string, Set<string>>();
    const allRuns = runRepository.listRuns({ detectionId: job.detection_id }).rows;
    for (const p of prompts) {
      const perPrompt = new Set<string>();
      for (const r of allRuns) {
        if (r.prompt_version_id === p.prompt_version_id && r.status === "completed") {
          perPrompt.add(r.dataset_id);
        }
      }
      runsByPromptDataset.set(p.prompt_version_id, perPrompt);
    }
    const sharedDatasetIds = Array.from(runsByPromptDataset.values()).reduce<Set<string>>(
      (acc, set, i) => {
        if (i === 0) return new Set(set);
        for (const id of Array.from(acc)) if (!set.has(id)) acc.delete(id);
        return acc;
      },
      new Set()
    );
    if (sharedDatasetIds.size === 0) {
      throw new Error("No datasets have completed runs for every selected prompt");
    }
    repo.appendLog(
      jobId,
      "loading",
      `${sharedDatasetIds.size} shared dataset(s) found across ${prompts.length} prompts`
    );

    if (isCancelled()) return finishCanceled();

    // For each shared dataset × prompt, take the latest completed run and load predictions.
    const runsByPrompt: PromptRunPredictions[] = prompts.map((p) => ({
      promptVersionId: p.prompt_version_id,
      label: p.version_label,
      run: null as any,
      predictions: [],
    }));
    for (const datasetId of sharedDatasetIds) {
      for (let i = 0; i < prompts.length; i++) {
        const run = pickLatestCompletedRun(allRuns, prompts[i].prompt_version_id, datasetId);
        if (!run) continue;
        const preds = runRepository.getRunPredictions(run.run_id);
        // Concatenate predictions across datasets — matrix builder joins on (dataset_id, image_id).
        runsByPrompt[i].predictions.push(...preds);
        // Store one run stub so buildComparisonMatrix can read dataset_id;
        // preds carry their own image_id, but we need dataset per prediction so
        // stamp it onto every prediction that came from this run.
        for (const pr of preds) (pr as any).__dataset_id = datasetId;
        if (!runsByPrompt[i].run) runsByPrompt[i].run = run;
      }
    }
    // Rebuild predictions with dataset_id resolved via the stamp.
    const runsByPromptFinal: PromptRunPredictions[] = runsByPrompt.map((rp) => ({
      promptVersionId: rp.promptVersionId,
      label: rp.label,
      run: rp.run,
      predictions: rp.predictions,
    }));
    // Feed the matrix builder with per-dataset run stubs by using the stamped dataset_id.
    // We handle this by grouping predictions per (promptVersionId, __dataset_id).
    const grouped: PromptRunPredictions[] = [];
    for (const rp of runsByPromptFinal) {
      const byDataset = new Map<string, Prediction[]>();
      for (const pr of rp.predictions) {
        const d = (pr as any).__dataset_id || rp.run?.dataset_id;
        if (!d) continue;
        if (!byDataset.has(d)) byDataset.set(d, []);
        byDataset.get(d)!.push(pr);
      }
      for (const [datasetId, preds] of byDataset) {
        grouped.push({
          promptVersionId: rp.promptVersionId,
          label: rp.label,
          run: { ...(rp.run || {}), dataset_id: datasetId } as any,
          predictions: preds,
        });
      }
    }

    // ── Analyze disagreements ────────────────────────────────────────────────
    setPhase("analyzing", 20, "Computing disagreement set");
    const matrix = buildComparisonMatrix(grouped);
    const classified = classifyRows(matrix);
    const perPromptMetrics = perPromptDisagreementMetrics(
      classified,
      prompts.map((p) => ({ prompt_version_id: p.prompt_version_id, label: p.version_label }))
    );
    const totalDisagreementCount = classified.filter(
      (r) => r.kind !== "AGREE_CORRECT" && r.kind !== "UNLABELED"
    ).length;
    const disagreementImages = selectDisagreementImages(classified, job.image_cap, jobId);
    const counterexamples = job.include_agreement_samples
      ? sampleAgreementCounterexamples(classified, Math.min(6, Math.floor(job.image_cap / 4)), jobId)
      : [];
    repo.updateJob(jobId, {
      disagreement_image_count: totalDisagreementCount,
      per_prompt_metrics: perPromptMetrics,
    });
    repo.appendLog(
      jobId,
      "analyzing",
      `${totalDisagreementCount} disagreement rows total; sending ${disagreementImages.length} + ${counterexamples.length} counterexample(s) to analyzer`
    );

    if (isCancelled()) return finishCanceled();

    // ── Analyzer LLM call ────────────────────────────────────────────────────
    const provider = getProvider(job.analyzer_model);
    const envKey = PROVIDER_ENV_KEY[provider];
    const apiKey = String(requestApiKey || process.env[envKey] || "").trim();
    if (!apiKey) throw new Error(`No API key available for ${provider}`);

    setPhase("analyzing", 40, `Analyzer LLM call (${provider}:${job.analyzer_model})`);
    const analyzerResult = await runAnalyzer(
      {
        model: job.analyzer_model,
        temperature: job.analyzer_temperature,
        detectionCode: detection.detection_code,
        detectionCategory: String(detection.detection_category || "general"),
        detectionDescription: String(detection.description || ""),
        sourcePrompts: prompts.map(extractPromptFields),
        perPromptMetrics,
        disagreementImages,
        counterexampleImages: counterexamples,
        totalDisagreementCount,
      },
      apiKey,
      job.image_cap
    );
    repo.updateJob(jobId, { synthesis_analysis: analyzerResult.analysis });
    repo.appendLog(
      jobId,
      "analyzing",
      `Analyzer produced synthesis (${analyzerResult.imageCount} images, ~${Math.round(analyzerResult.bytesUsed / 1024)}KB base64 payload)`
    );

    if (isCancelled()) return finishCanceled();

    // ── Save synthesized prompt version ──────────────────────────────────────
    setPhase("saving", 65, "Saving synthesized prompt version");
    const sourcePrompt = prompts[0];
    const candidate = {
      id: uuid(),
      kind: "balanced" as const,
      label: analyzerResult.analysis.synthesis.label || "synthesis-merge",
      target_failure_mode: "cross-prompt synthesis",
      rationale: analyzerResult.analysis.synthesis.rationale,
      label_policy: analyzerResult.analysis.synthesis.label_policy,
      decision_rubric: analyzerResult.analysis.synthesis.decision_rubric,
      system_prompt: null,
      user_prompt_addendum: analyzerResult.analysis.synthesis.detection_guidance || null,
    };
    const synthesizedLabel = promptRepository.uniqueVersionLabel(
      job.detection_id,
      `${aiVersionLabel(sourcePrompt.version_label)}-merge`
    );
    const synthesizedId = uuid();
    const now = new Date().toISOString();
    promptRepository.createPromptVersion(
      buildPromptVersionInput({
        promptVersionId: synthesizedId,
        detectionId: job.detection_id,
        sourcePrompt,
        candidate,
        newVersionLabel: synthesizedLabel,
        changeNotes: `Prompt compare synthesis from ${prompts.length} prompts (job ${jobId.slice(0, 8)}).`,
        versionNotes: "",
        createdAt: now,
        sourcePromptVersionId: sourcePrompt.prompt_version_id,
      })
    );
    repo.updateJob(jobId, { result_prompt_version_id: synthesizedId });

    // ── Optional evaluation on the disagreement set ─────────────────────────
    let evalDatasetId: string | null = null;
    let evalRunId: string | null = null;
    let evalMetrics: MetricsSummary | null = null;
    let evalComparisons: EvalPromptComparison[] | null = null;
    const disagreementForEval = classified.filter(
      (r) => r.kind !== "AGREE_CORRECT" && r.kind !== "UNLABELED" && r.ground_truth != null
    );
    if (job.evaluate && disagreementForEval.length > 0) {
      setPhase("evaluating", 75, `Evaluating synthesized prompt on ${disagreementForEval.length} disagreement images`);
      const synthesizedPrompt = promptRepository.getFullPromptById(synthesizedId) as PromptVersion;
      const modelUsed = synthesizedPrompt?.model || sourcePrompt.model;
      const inferProvider = getProvider(modelUsed);
      const inferApiKey = String(
        requestApiKey || process.env[PROVIDER_ENV_KEY[inferProvider]] || ""
      ).trim();
      if (!inferApiKey) {
        repo.appendLog(jobId, "evaluating", `No ${inferProvider} API key for evaluation — skipping`);
      } else {
        const evalOut = await evaluateSynthesizedPrompt({
          detectionId: job.detection_id,
          detectionCode: detection.detection_code,
          jobId,
          disagreementRows: disagreementForEval,
          synthesizedPromptId: synthesizedId,
          synthesizedPromptVersion: synthesizedPrompt,
          apiKey: inferApiKey,
          modelUsed,
          logProgress: (m) => repo.appendLog(jobId, "evaluating", m),
          isCancelled,
        });
        evalDatasetId = evalOut.datasetId;
        evalRunId = evalOut.runId;
        evalMetrics = evalOut.metrics;
        evalComparisons = buildEvalComparisons(
          evalOut.outcomes,
          disagreementForEval,
          prompts.map((p) => ({ prompt_version_id: p.prompt_version_id, label: p.version_label }))
        );
        repo.updateJob(jobId, {
          result_run_id: evalRunId,
          result_dataset_id: evalDatasetId,
          eval_summary: evalMetrics,
          eval_comparisons: evalComparisons,
        });
      }
    }

    if (isCancelled()) return finishCanceled();

    // ── Report + finalize ────────────────────────────────────────────────────
    setPhase("reporting", 96, "Writing report");
    const report = generateCompareReport({
      detectionCode: detection.detection_code,
      sourcePrompts: prompts.map((p) => ({
        prompt_version_id: p.prompt_version_id,
        label: p.version_label,
      })),
      sharedDatasetCount: sharedDatasetIds.size,
      totalDisagreementCount,
      imagesAnalyzed: disagreementImages.length,
      counterexamplesAnalyzed: counterexamples.length,
      perPromptMetrics,
      analysis: analyzerResult.analysis,
      evaluate: job.evaluate,
      evalDatasetSize: evalMetrics ? evalMetrics.total : null,
      evalComparisons,
      synthesizedLabel,
    });
    promptRepository.updateVersionNotes(synthesizedId, report);
    versionNoteEntryRepository.createEntry({
      entryId: uuid(),
      promptVersionId: synthesizedId,
      origin: "auto_hil",
      eventType: "ai_prompt_iteration",
      body: report,
      metadata: {
        job_id: jobId,
        source_prompt_version_ids: job.source_prompt_version_ids,
        analyzer_model: job.analyzer_model,
        result_run_id: evalRunId,
        result_dataset_id: evalDatasetId,
      },
      createdBy: "system",
      createdAt: new Date().toISOString(),
    });

    repo.updateJob(jobId, {
      status: "completed",
      phase: "done",
      progress: 100,
      report,
      finished_at: new Date().toISOString(),
    });
    repo.appendLog(jobId, "done", `Completed — synthesized ${synthesizedLabel}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Prompt compare synthesis failed", { jobId, error: msg });
    promptCompareJobRepository.updateJob(jobId, {
      status: "failed",
      error: msg,
      finished_at: new Date().toISOString(),
    });
    promptCompareJobRepository.appendLog(jobId, "done" as ComparePhase, `Failed: ${msg}`);
  } finally {
    compareJobQueue.delete(jobId);
  }
}

/** Public export for tests / diagnostics. */
export type { CompareJob };
