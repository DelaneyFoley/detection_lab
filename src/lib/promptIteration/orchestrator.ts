import { v4 as uuid } from "uuid";
import { promptIterationRepository, promptRepository, runRepository, versionNoteEntryRepository } from "@/lib/repositories";
import { iterationJobQueue } from "@/lib/services";
import { getProvider } from "@/lib/models";
import { computeMetrics } from "@/lib/metrics";
import { logger } from "@/lib/logger";
import type { Decision, MetricsSummary, Prediction, ErrorTag } from "@/types";
import {
  confusionFromRows,
  metricsFromConfusion,
  groupAwareStratifiedSplit,
  selectBestCandidate,
  candidateComplexity,
  resolveEvaluationPlan,
  groupBootstrapDelta,
  nearDuplicateGroupKey,
  objectiveScore,
  objectiveLabel,
  parseObjective,
  DEFAULT_SELECTION_CONFIG,
} from "@/lib/promptIteration/metrics";
import { summarizeFailureModes, summarizeReviewedRows, toReviewedRows, collectFailureImages } from "@/lib/promptIteration/packaging";
import { generateCandidates } from "@/lib/promptIteration/candidateGen";
import { evaluateCandidate, computeRegressionCounts, buildCandidatePromptVersion, type EvalPrediction } from "@/lib/promptIteration/evaluation";
import { generateIterationReport } from "@/lib/promptIteration/report";
import { aiVersionLabel, buildPromptVersionInput, applyCandidateUserTemplate } from "@/lib/promptIteration/saving";
import { splitUserPromptTemplate } from "@/lib/detectionPrompts";
import type {
  CandidateResult,
  CoreMetrics,
  IterationPhase,
  PromptCandidate,
  RoundSummary,
} from "@/lib/promptIteration/types";

const PROVIDER_ENV_KEY: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const MAX_CANDIDATES = 1;

function parseStructure(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

/** Content identity of a candidate prompt, used to skip re-evaluating dupes. */
function candidateContentKey(c: { system_prompt?: string | null; label_policy: string; decision_rubric: string; user_prompt_addendum?: string | null }): string {
  return `${c.system_prompt || ""}\u0000${c.label_policy || ""}\u0000${c.decision_rubric || ""}\u0000${c.user_prompt_addendum ?? ""}`;
}

/** Rough token estimate (~4 chars/token) for a compiled prompt version. */
function estimatePromptTokens(parts: Array<string | null | undefined>): number {
  const chars = parts.reduce((sum, p) => sum + String(p || "").length, 0);
  return Math.max(0, Math.ceil(chars / 4));
}

/** Short blurb describing what a candidate prompt optimizes for / changes. */
function candidateBlurb(candidate: PromptCandidate): string {
  const focus = String(candidate.target_failure_mode || "").trim();
  const rationale = String(candidate.rationale || "").replace(/\s+/g, " ").trim();
  const kindLabel: Record<string, string> = {
    lean: "Leaner phrasing",
    conservative: "Higher precision",
    recall: "Higher recall",
    balanced: "Balanced precision/recall",
  };
  const lead = kindLabel[candidate.kind] || "Refined prompt";
  const focusPart = focus ? ` · targets ${focus}` : "";
  const why = rationale ? ` — ${rationale.slice(0, 200)}` : "";
  return `${lead}${focusPart}${why}`.trim();
}

/**
 * Build the per-round "Observations & Notes" entry saved on each iteration
 * prompt version: the logic behind the prompt, its initial held-out performance
 * vs baseline, and heuristic recommended next steps derived from its error mix.
 */
function buildRoundObservationNote(params: {
  round: number;
  candidate: PromptCandidate;
  result: CandidateResult;
  baseline: CoreMetrics;
  objectiveLabelText: string;
  holdoutSize: number;
  promptTokens: number;
  blurb: string;
}): string {
  const { round, candidate, result, baseline, objectiveLabelText, holdoutSize, promptTokens } = params;
  const m = result.metrics;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const dpct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const changed = result.changed_rows.length;

  const nextSteps: string[] = [];
  if (result.parse_errors > 0) {
    nextSteps.push(
      `Eliminate the ${result.parse_errors} parse error(s): the prompt must always return the exact JSON schema and nothing else — this hard-blocks promotion.`
    );
  }
  if (m.recall < m.precision - 0.05) {
    nextSteps.push(
      "Recall lags precision — loosen borderline acceptance and clarify that partial-but-consistent evidence counts, targeting the dominant false negatives."
    );
  } else if (m.precision < m.recall - 0.05) {
    nextSteps.push(
      "Precision lags recall — add sharper exclusions/look-alike rules for the top confusers driving false positives."
    );
  } else {
    nextSteps.push(
      "Precision and recall are balanced — pursue leaner wording and edge-case disambiguation for marginal gains."
    );
  }
  if (m.f1 <= baseline.f1) {
    nextSteps.push("This variant did not beat the baseline; the next round should try a different failure mode rather than extending this direction.");
  }

  return [
    `### What this prompt tried (round ${round})`,
    `- Strategy: **${candidate.label}** (${candidate.kind})`,
    candidate.target_failure_mode ? `- Targeted failure mode: ${candidate.target_failure_mode}` : "",
    candidate.rationale ? `- Rationale: ${candidate.rationale.replace(/\s+/g, " ").trim()}` : "",
    "",
    `### Initial performance (held-out slice, ${holdoutSize} images)`,
    `- Objective: ${objectiveLabelText}`,
    `- F1 ${pct(m.f1)} · Precision ${pct(m.precision)} · Recall ${pct(m.recall)} · Parse errors ${result.parse_errors} · ~${promptTokens} tokens`,
    `- vs baseline: ΔF1 ${dpct(m.f1 - baseline.f1)}, ΔRecall ${dpct(m.recall - baseline.recall)}, ΔPrecision ${dpct(m.precision - baseline.precision)}`,
    `- Changed ${changed} prediction(s) vs the prompt it was tuned from.`,
    "",
    "### Recommended next steps",
    ...nextSteps.map((s) => `- ${s}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Run the full AI prompt-iteration workflow for a finalized HIL review. Designed
 * to be invoked fire-and-forget (`void runPromptIterationJob(jobId, apiKey)`) so
 * the API request returns immediately; all progress is persisted to the job row.
 */
export async function runPromptIterationJob(jobId: string, requestApiKey?: string | null): Promise<void> {
  const repo = promptIterationRepository;
  const control = iterationJobQueue.get(jobId) || iterationJobQueue.create(jobId);
  const isCancelled = () => control.cancelRequested || repo.getJob(jobId)?.status === "canceled";

  const setPhase = (phase: IterationPhase, progress: number, message?: string) => {
    repo.updateJob(jobId, { phase, progress });
    if (message) repo.appendLog(jobId, phase, message);
  };

  try {
    const job = repo.getJob(jobId);
    if (!job) return;
    repo.updateJob(jobId, { status: "running", started_at: new Date().toISOString(), phase: "preparing", progress: 2 });
    repo.appendLog(jobId, "preparing", "Preparing reviewed dataset");

    // ── Load source data ──────────────────────────────────────────────────────
    const run = runRepository.getRunById(job.run_id);
    if (!run) throw new Error("Run not found");
    const detection = runRepository.getDetectionById(job.detection_id);
    if (!detection) throw new Error("Detection not found");
    const sourcePrompt = promptRepository.getFullPromptById(job.source_prompt_version_id);
    if (!sourcePrompt) throw new Error("Source prompt version not found");

    const structure = parseStructure(sourcePrompt.prompt_structure);
    // Per-run override for the pinned fixed guidance block (set from the
    // iteration modal). When provided it replaces the source prompt's
    // fixed_guidance for every round; otherwise the source value is used.
    if (job.fixed_guidance != null) {
      structure.fixed_guidance = job.fixed_guidance;
    }
    const baseLabelPolicy = String(structure.label_policy || detection.label_policy || "");
    const baseDecisionRubric = String(
      structure.decision_rubric ||
        (Array.isArray(detection.decision_rubric)
          ? detection.decision_rubric.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n")
          : "")
    );
    const baseComplexity = candidateComplexity(
      baseLabelPolicy,
      baseDecisionRubric,
      sourcePrompt.system_prompt,
      splitUserPromptTemplate(sourcePrompt.user_prompt_template || "").addendum
    );

    const predictions = runRepository.getRunPredictions(run.run_id);
    const rows = toReviewedRows(predictions);
    const packageSummary = summarizeReviewedRows(rows);
    if (packageSummary.labeled === 0) {
      throw new Error("No labeled rows in this review to tune against.");
    }

    // ── Resolve API key for evaluation ────────────────────────────────────────
    // Prefer the model the reviewed RUN actually used (what the operator selected
    // in Detection Lab) over the source prompt version's stored model — otherwise
    // tuned prompts get mis-tagged with the prompt's default (e.g. gemini-2.5-flash).
    const modelUsed = run.model_used || sourcePrompt.model || "gemini-2.5-flash";
    const provider = getProvider(modelUsed);
    const envKey = PROVIDER_ENV_KEY[provider] || "GEMINI_API_KEY";
    const apiKey = String(requestApiKey || process.env[envKey] || "").trim();

    if (isCancelled()) return void finishCanceled(jobId);

    // ── Phase: baseline metrics ───────────────────────────────────────────────
    setPhase("baseline", 8, "Computing baseline metrics");
    const baselineSummary: MetricsSummary = computeMetrics(predictions);
    repo.updateJob(jobId, { baseline_metrics: baselineSummary });
    // Genuine parse errors in the baseline run (excludes transient API failures).
    const baselineParseErrors = predictions.filter(
      (p) => !p.parse_ok && p.error_tag !== "INFERENCE_CALL_FAILED"
    ).length;
    if (baselineParseErrors > 0) {
      repo.appendLog(jobId, "baseline", `Baseline has ${baselineParseErrors} parse error(s) — the tuned prompt must eliminate all of them.`);
    }

    // ── Phase: failure-mode analysis ──────────────────────────────────────────
    setPhase("analysis", 14, "Analyzing failure modes");
    const failureModes = summarizeFailureModes(rows);
    repo.appendLog(
      jobId,
      "analysis",
      `Found ${failureModes.map((m) => `${m.count} ${m.kind}`).join(", ") || "no dominant failure modes"}`
    );

    // Every FP/FN image, so each generation round can visually review its own
    // mistakes (not just the model's text evidence) before rewriting the prompt.
    const failureImages = collectFailureImages(rows);
    if (failureImages.length > 0) {
      const fnCount = failureImages.filter((f) => f.outcome === "FN").length;
      const fpCount = failureImages.length - fnCount;
      repo.appendLog(
        jobId,
        "analysis",
        `Attaching ${failureImages.length} misclassified image(s) (${fnCount} FN, ${fpCount} FP) for the tuning model to review visually.`
      );
    }

    // Held-out split — the AI only sees the tuning slice; candidates are scored
    // on the holdout it never saw. The split fraction and the promotion bar are
    // chosen adaptively from the labeled sample's statistical power.
    const labeledRows = rows.filter(
      (r) => r.finalized_ground_truth === "DETECTED" || r.finalized_ground_truth === "NOT_DETECTED"
    );
    const labeledPositives = labeledRows.filter((r) => r.finalized_ground_truth === "DETECTED").length;
    const evalPlan = resolveEvaluationPlan({
      labeled: labeledRows.length,
      positives: labeledPositives,
      negatives: labeledRows.length - labeledPositives,
    });
    repo.appendLog(
      jobId,
      "analysis",
      `Sample: ${labeledRows.length} labeled (${labeledPositives} pos / ${labeledRows.length - labeledPositives} neg) → ${evalPlan.regime} regime (holdout ${Math.round(evalPlan.holdoutFraction * 100)}%, min ΔF1 ${(evalPlan.minEffectF1 * 100).toFixed(0)}%). ${evalPlan.note}`
    );
    const { tuning, holdout } = groupAwareStratifiedSplit(labeledRows, evalPlan.holdoutFraction, job.run_id);
    const evalHoldout = holdout.length > 0 ? holdout : labeledRows;
    repo.appendLog(
      jobId,
      "analysis",
      `Split: ${tuning.length} tuning / ${evalHoldout.length} holdout (~${Math.round(evalPlan.holdoutFraction * 100)}% held out; group-aware, label-stratified, attribute-diverse)`
    );

    const baselineHoldoutConfusion = confusionFromRows(evalHoldout);
    const baselineHoldoutCore = metricsFromConfusion(baselineHoldoutConfusion);
    // Optimization objective (defaults to F1). Ranking, baseline-beat, and the
    // bootstrap promotion gate all use this instead of raw F1.
    const objective = parseObjective(job.objective);
    const baselineObjectiveScore = objectiveScore(baselineHoldoutCore, baselineHoldoutConfusion, objective);
    repo.appendLog(jobId, "analysis", `Objective: ${objectiveLabel(objective)} (baseline ${(baselineObjectiveScore * 100).toFixed(1)}%).`);
    const baselineByImageId = new Map<string, Decision | null>(
      evalHoldout.map((r) => [r.image_id, r.ai_predicted])
    );

    if (isCancelled()) return void finishCanceled(jobId);

    // ── Single-chain iteration ────────────────────────────────────────────────
    // Each round writes ONE complete prompt, built from the cumulative history of
    // every prior round's prompt and result, scores it on the SAME holdout, and
    // always saves it as its own version + run (so each is inspectable). The best
    // prompt across the whole chain is chosen at the end.
    const guardrailsBase = [
      "Held-out split: prompts are scored only on images excluded from the tuning slice.",
      "Group-aware split keeps near-duplicate images on the same side (no leakage) and stratifies by ground-truth label AND attribute labels.",
      job.precision_floor != null
        ? `Explicit precision floor of ${(job.precision_floor * 100).toFixed(0)}% enforced when choosing the winner.`
        : "Precision guardrail prevents choosing a winner that collapses precision.",
      "Leaner prompts win ties (complexity penalty) to avoid prompt bloat and overfitting.",
      "Parse errors are unacceptable: a prompt producing schema-invalid output cannot win.",
      "Every round is scored on the SAME holdout so rounds are directly comparable.",
    ];

    const maxRounds = Math.max(1, Math.min(10, job.max_rounds || 1));
    const tuningSummary0 = summarizeReviewedRows(tuning.length > 0 ? tuning : labeledRows);
    // Distinct batch per iteration run against the same source, so re-running
    // never collides with a previous run's version labels.
    const iterationBatch = promptIterationRepository.countPriorJobsForSource(job.source_prompt_version_id, jobId) + 1;
    if (iterationBatch > 1) {
      repo.appendLog(jobId, "preparing", `Iteration batch #${iterationBatch} for this prompt — new versions are labelled -b${iterationBatch}- to stay distinct from prior runs.`);
    }

    // Evolving chain state — each round refines the BEST prompt found so far
    // (anchored), never a worse one, so rounds can't spiral downward. Pin the
    // model to the reviewed run's model so generation, evaluation, and every
    // saved version + run are tagged with the model actually being tuned.
    let currentPrompt: any = { ...sourcePrompt, model: modelUsed, prompt_structure: structure };
    let currentSourceVersionId = job.source_prompt_version_id;
    let currentSourceLabel = sourcePrompt.version_label;
    let prevContentKey = candidateContentKey({
      system_prompt: sourcePrompt.system_prompt,
      label_policy: baseLabelPolicy,
      decision_rubric: baseDecisionRubric,
    });
    // Anchor = best prompt so far. A round only becomes the new anchor if it is
    // eligible (parse-clean, respects the floor) AND beats the anchor's holdout
    // F1. Seeded with the ORIGINAL source at its baseline holdout F1, so rounds
    // never refine from something worse than where they started.
    let anchorPrompt: any = currentPrompt;
    let anchorVersionId = currentSourceVersionId;
    let anchorLabel = currentSourceLabel;
    let anchorContentKey = prevContentKey;
    let anchorF1 = baselineHoldoutCore.f1;

    const rounds: RoundSummary[] = [];
    const priorRounds: Array<{
      round: number;
      label: string;
      f1: number;
      precision: number;
      recall: number;
      target_failure_mode: string;
      rejected_reasons: string[];
    }> = [];
    // Complete history of every round's prompt + result, fed back to the AI each
    // round so it refines against all up-to-date lessons.
    const testedCandidates: Array<{
      round: number;
      label: string;
      kind: string;
      f1: number;
      precision: number;
      recall: number;
      parse_errors: number;
      promoted: boolean;
      rejected_reasons: string[];
      rubric_snippet?: string;
    }> = [];
    // One CandidateResult per round + a map back to its saved version/run so the
    // final winner (best across all rounds) can be resolved and linked.
    const allResults: CandidateResult[] = [];
    const savedByCandidate = new Map<
      string,
      { round: number; promptVersionId: string; runId: string; label: string; metrics: CoreMetrics; preds: EvalPrediction[]; candidate: PromptCandidate }
    >();
    // Cache by prompt content so an identical prompt is never re-evaluated.
    const evalCache = new Map<string, { result: CandidateResult; predictions: EvalPrediction[] }>();
    let lastRoundResults: CandidateResult[] = [];
    let usedAIAny = false;
    let totalEvaluated = 0;
    let liveBestF1 = -1;
    let consecutiveNoChange = 0;
    const NO_CHANGE_PATIENCE = 2;

    // A round's prompt can be the final winner only if it emits zero parse errors
    // and respects any explicit precision floor.
    const eligibleAsWinner = (r: CandidateResult) =>
      r.parse_errors === 0 && (job.precision_floor == null || r.metrics.precision >= job.precision_floor);

    if (!apiKey) {
      repo.appendLog(jobId, "evaluation", "No API key available — cannot evaluate prompts on the holdout.");
    }

    for (let round = 1; round <= maxRounds && apiKey; round++) {
      if (isCancelled()) return void finishCanceled(jobId);
      repo.updateJob(jobId, { current_round: round });
      const roundBase = ((round - 1) / maxRounds) * 88;
      const roundSpan = 88 / maxRounds;

      const roundStructure =
        currentPrompt.prompt_structure && typeof currentPrompt.prompt_structure === "object"
          ? (currentPrompt.prompt_structure as Record<string, unknown>)
          : structure;
      const roundLabelPolicy = String(roundStructure.label_policy || baseLabelPolicy);
      const roundDecisionRubric = String(roundStructure.decision_rubric || baseDecisionRubric);
      const roundUserAddendum = splitUserPromptTemplate(currentPrompt.user_prompt_template || "").addendum;

      setPhase("generation", Math.round(roundBase + roundSpan * 0.2), `Round ${round}/${maxRounds}: writing the next prompt`);
      const gen = await generateCandidates(
        {
          model: currentPrompt.model || modelUsed,
          detectionCode: detection.detection_code,
          detectionCategory: String(detection.detection_category || "general"),
          sourceVersionLabel: currentSourceLabel,
          baseLabelPolicy: roundLabelPolicy,
          baseDecisionRubric: roundDecisionRubric,
          baseSystemPrompt: currentPrompt.system_prompt || "",
          baseUserAddendum: roundUserAddendum,
          baseFixedGuidance: typeof roundStructure.fixed_guidance === "string" ? roundStructure.fixed_guidance : "",
          failureModes,
          tuningSummary: {
            total: tuningSummary0.labeled,
            positives: tuningSummary0.positives,
            negatives: tuningSummary0.negatives,
            fp: tuningSummary0.fp,
            fn: tuningSummary0.fn,
          },
          goalF1: job.goal_f1,
          maxCandidates: MAX_CANDIDATES,
          baselineParseErrors,
          round,
          priorRounds,
          testedCandidates,
          failureImages,
        },
        apiKey || null
      );
      usedAIAny = usedAIAny || gen.usedAI;
      const candidate = gen.candidates[0];
      if (!candidate) {
        repo.appendLog(jobId, "generation", `Round ${round}: no prompt generated — stopping.`);
        break;
      }
      repo.updateJob(jobId, { candidates_generated: round });
      repo.appendLog(
        jobId,
        "generation",
        `Round ${round}: wrote a new prompt ${gen.usedAI ? "via AI" : `via fallback${gen.error ? ` (AI unavailable: ${gen.error})` : ""}`} ("${candidate.label}").`
      );

      // Skip identical re-proposals (no change from the current chain head).
      const contentKey = candidateContentKey(candidate);
      if (contentKey === prevContentKey) {
        consecutiveNoChange += 1;
        repo.appendLog(jobId, "generation", `Round ${round}: the new prompt is identical to the current one — no change.`);
        if (consecutiveNoChange >= NO_CHANGE_PATIENCE) {
          repo.appendLog(jobId, "selection", `Stopping: ${consecutiveNoChange} consecutive rounds produced no change.`);
          break;
        }
        continue;
      }
      consecutiveNoChange = 0;

      // Evaluate this round's single prompt on the holdout (cached if identical).
      setPhase("evaluation", Math.round(roundBase + roundSpan * 0.55), `Round ${round}/${maxRounds}: evaluating the new prompt on the holdout`);
      let result: CandidateResult;
      let preds: EvalPrediction[];
      const cached = evalCache.get(contentKey);
      if (cached) {
        preds = cached.predictions;
        const changed = preds
          .filter((p) => (baselineByImageId.get(p.image_id) ?? null) !== p.predicted)
          .map((p) => p.image_id);
        result = { ...cached.result, candidate, changed_rows: changed, rejected_reasons: [] };
      } else {
        const out = await evaluateCandidate({
          candidate,
          sourcePrompt: currentPrompt,
          detectionCode: detection.detection_code,
          rows: evalHoldout,
          apiKey,
          baselineByImageId,
          isCancelled,
        });
        result = out.result;
        preds = out.predictions;
        evalCache.set(contentKey, { result: out.result, predictions: out.predictions });
      }
      totalEvaluated += 1;
      lastRoundResults = [result];
      allResults.push(result);
      testedCandidates.push({
        round,
        label: candidate.label,
        kind: candidate.kind,
        f1: result.metrics.f1,
        precision: result.metrics.precision,
        recall: result.metrics.recall,
        parse_errors: result.parse_errors,
        promoted: true,
        rejected_reasons: [],
        rubric_snippet: (candidate.decision_rubric || "").replace(/\s+/g, " ").trim().slice(0, 180),
      });

      // Always save this round's prompt as its own version + linked run.
      setPhase("saving", Math.round(roundBase + roundSpan - 2), `Round ${round}/${maxRounds}: saving prompt version`);
      const roundLabel = promptRepository.uniqueVersionLabel(
        job.detection_id,
        aiVersionLabel(sourcePrompt.version_label, round, iterationBatch)
      );
      const roundVersionId = uuid();
      const now = new Date().toISOString();
      const blurb = candidateBlurb(candidate);
      const effectiveUserTemplate = applyCandidateUserTemplate(currentPrompt.user_prompt_template || "", candidate);
      const promptTokens = estimatePromptTokens([
        candidate.system_prompt || currentPrompt.system_prompt,
        candidate.label_policy,
        candidate.decision_rubric,
        effectiveUserTemplate,
      ]);
      const roundNote = buildRoundObservationNote({
        round,
        candidate,
        result,
        baseline: baselineHoldoutCore,
        objectiveLabelText: objectiveLabel(objective),
        holdoutSize: evalHoldout.length,
        promptTokens,
        blurb,
      });
      promptRepository.createPromptVersion(
        buildPromptVersionInput({
          promptVersionId: roundVersionId,
          detectionId: job.detection_id,
          sourcePrompt: currentPrompt,
          candidate,
          newVersionLabel: roundLabel,
          changeNotes: `AI prompt iteration round ${round} from HIL run ${job.run_id.slice(0, 8)}.`,
          versionNotes: roundNote,
          createdAt: now,
          sourcePromptVersionId: currentSourceVersionId,
        })
      );
      const roundRunId = saveEvaluationRun({
        run,
        detectionId: job.detection_id,
        newPromptVersionId: roundVersionId,
        modelUsed,
        winnerPreds: preds,
      });

      rounds.push({
        round,
        prompt_version_id: roundVersionId,
        run_id: roundRunId,
        label: roundLabel,
        precision: result.metrics.precision,
        recall: result.metrics.recall,
        f1: result.metrics.f1,
        complexity: result.complexity,
        parse_errors: result.parse_errors,
        promoted: true,
        is_best: false,
        candidates_evaluated: 1,
        prompt_tokens: promptTokens,
        blurb,
      });
      savedByCandidate.set(candidate.id, {
        round,
        promptVersionId: roundVersionId,
        runId: roundRunId,
        label: roundLabel,
        metrics: result.metrics,
        preds,
        candidate,
      });
      priorRounds.push({
        round,
        label: roundLabel,
        f1: result.metrics.f1,
        precision: result.metrics.precision,
        recall: result.metrics.recall,
        target_failure_mode: candidate.target_failure_mode,
        rejected_reasons: result.rejected_reasons,
      });

      // Update the anchor only if this round is eligible AND beats the anchor's
      // holdout F1. Then the NEXT round refines the anchor (best-so-far), so a
      // bad round can't drag the chain downward.
      const advancedPrompt = buildCandidatePromptVersion(currentPrompt, candidate);
      if (eligibleAsWinner(result) && result.metrics.f1 > anchorF1) {
        anchorF1 = result.metrics.f1;
        anchorPrompt = advancedPrompt;
        anchorVersionId = roundVersionId;
        anchorLabel = roundLabel;
        anchorContentKey = contentKey;
        repo.appendLog(jobId, "generation", `Round ${round}: new best (F1 ${(result.metrics.f1 * 100).toFixed(1)}%) — future rounds build on it.`);
      } else {
        repo.appendLog(jobId, "generation", `Round ${round}: F1 ${(result.metrics.f1 * 100).toFixed(1)}% did not beat the current best (${(anchorF1 * 100).toFixed(1)}%) — next round rebuilds from the best, not this one.`);
      }
      // Anchor the next round on the best prompt found so far.
      currentPrompt = anchorPrompt;
      currentSourceVersionId = anchorVersionId;
      currentSourceLabel = anchorLabel;
      prevContentKey = anchorContentKey;

      if (eligibleAsWinner(result) && result.metrics.f1 > liveBestF1) {
        liveBestF1 = result.metrics.f1;
        repo.updateJob(jobId, {
          rounds,
          candidates: lastRoundResults,
          candidates_evaluated: totalEvaluated,
          best_f1: result.metrics.f1,
          best_precision: result.metrics.precision,
          best_recall: result.metrics.recall,
        });
      } else {
        repo.updateJob(jobId, { rounds, candidates: lastRoundResults, candidates_evaluated: totalEvaluated });
      }

      if (job.goal_f1 != null && eligibleAsWinner(result) && result.metrics.f1 >= job.goal_f1) {
        repo.appendLog(jobId, "selection", `Round ${round}: goal F1 ${(job.goal_f1 * 100).toFixed(1)}% reached — stopping.`);
        break;
      }
    }

    if (isCancelled()) return void finishCanceled(jobId);

    // ── Phase: selection — best prompt across ALL rounds vs the ORIGINAL baseline ─
    setPhase("selection", 92, "Selecting the best prompt across all rounds");
    const finalSelection = selectBestCandidate(baselineHoldoutCore, allResults, {
      goalF1: job.goal_f1,
      precisionFloor: job.precision_floor,
      precisionDropTolerance: DEFAULT_SELECTION_CONFIG.precisionDropTolerance,
      // Lean preference: the max F1 the operator will trade for a leaner prompt.
      // Larger window = leaner wins over more of an F1 gap. Falls back to default.
      minF1GainForComplexity: job.lean_preference ?? DEFAULT_SELECTION_CONFIG.minF1GainForComplexity,
      baselineComplexity: baseComplexity,
      objective,
      baselineScore: baselineObjectiveScore,
    });
    const best = finalSelection.selected
      ? savedByCandidate.get(finalSelection.selected.candidate.id) ?? null
      : null;
    if (best) {
      for (const r of rounds) r.is_best = r.prompt_version_id === best.promptVersionId;
    }
    const savedRounds = rounds.filter((r) => r.promoted).length;

    // ── Statistical promotion gate (size-adaptive) ────────────────────────────
    // A point-estimate F1 win on a small holdout can be one-image noise. Bootstrap
    // the paired ΔF1 (candidate − baseline) over the SAME holdout, resampling whole
    // near-duplicate groups, and require the improvement to be statistically stable
    // before calling it a confident promotion. On small samples the interval is
    // wide (few things pass → conservative); on large samples it tightens.
    let promotionTier: "NO_PROMOTION" | "RECOMMENDED_REVIEW" | "CONFIDENT" = "NO_PROMOTION";
    let bootstrap: ReturnType<typeof groupBootstrapDelta> | null = null;
    if (best) {
      const candByImageId = new Map<string, Decision | null>(best.preds.map((p) => [p.image_id, p.predicted]));
      const bootRows = evalHoldout.map((r) => ({
        group: nearDuplicateGroupKey(r.image_id),
        truth: r.finalized_ground_truth,
        base: baselineByImageId.get(r.image_id) ?? null,
        cand: candByImageId.get(r.image_id) ?? null,
      }));
      bootstrap = groupBootstrapDelta(bootRows, {
        iters: evalPlan.bootstrapIters,
        seed: `${job.run_id}:${best.promptVersionId}`,
        minGain: evalPlan.minEffectF1,
        objective,
      });
      promotionTier = bootstrap.probGain >= evalPlan.promotionConfidence ? "CONFIDENT" : "RECOMMENDED_REVIEW";
      repo.appendLog(
        jobId,
        "selection",
        `Best "${best.label}": Δ${objectiveLabel(objective)} ${(bootstrap.objective.mean * 100).toFixed(1)}% (90% CI ${(bootstrap.objective.lo * 100).toFixed(1)}…${(bootstrap.objective.hi * 100).toFixed(1)}%), P(Δ>${(evalPlan.minEffectF1 * 100).toFixed(0)}%)=${(bootstrap.probGain * 100).toFixed(0)}% → ${promotionTier === "CONFIDENT" ? "confident promotion" : "RECOMMENDED FOR REVIEW (improvement not statistically stable at this sample size)"}.`
      );
    }

    // ── Phase: reporting ──────────────────────────────────────────────────────
    setPhase("reporting", 96, "Writing final report");
    const regression = best
      ? computeRegressionCounts(evalHoldout, best.preds)
      : { fp_fixed: 0, fn_fixed: 0, new_false_positives: 0, new_false_negatives: 0 };
    const guardrails = [
      ...guardrailsBase,
      usedAIAny
        ? "AI wrote one prompt per round from cumulative history; avoids image-specific rules/ids/hex colors/layouts but MAY use generic corrosion color families tied to morphology."
        : "Deterministic fallback prompts use only generic morphology/behavior rules.",
    ];

    const report = generateIterationReport({
      sourceVersionLabel: sourcePrompt.version_label,
      newVersionLabel: best?.label ?? null,
      goalF1: job.goal_f1,
      baseline: baselineHoldoutCore,
      selection: finalSelection,
      candidates: allResults,
      failureModes,
      regression,
      guardrails,
      holdoutSize: evalHoldout.length,
      tuningSize: tuning.length,
      rounds,
      baselineParseErrors,
    });

    // Prepend the size-adaptive statistical promotion assessment so the decision
    // surface leads with uncertainty, not just a point estimate.
    const assessment = (() => {
      const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
      const lines = [
        "## Promotion assessment",
        `- Objective: **${objectiveLabel(objective)}** — baseline ${pct(baselineObjectiveScore)}.`,
        `- Sample regime: **${evalPlan.regime}** — ${labeledRows.length} labeled (${labeledPositives} pos / ${labeledRows.length - labeledPositives} neg); holdout ${evalHoldout.length}.`,
        `- ${evalPlan.note}`,
      ];
      if (best && bootstrap) {
        lines.push(
          `- Baseline holdout F1: ${pct(baselineHoldoutCore.f1)} · Candidate F1: ${pct(best.metrics.f1)}`,
          `- **Δ${objectiveLabel(objective)}: ${pct(bootstrap.objective.mean)}** (group-bootstrap 90% CI ${pct(bootstrap.objective.lo)} … ${pct(bootstrap.objective.hi)})`,
          `- ΔF1 ${pct(bootstrap.f1.mean)} [${pct(bootstrap.f1.lo)}…${pct(bootstrap.f1.hi)}]; ΔRecall ${pct(bootstrap.recall.mean)} [${pct(bootstrap.recall.lo)}…${pct(bootstrap.recall.hi)}]; ΔPrecision ${pct(bootstrap.precision.mean)} [${pct(bootstrap.precision.lo)}…${pct(bootstrap.precision.hi)}]`,
          `- P(Δobjective > required ${pct(evalPlan.minEffectF1)}) = ${(bootstrap.probGain * 100).toFixed(0)}% over ${bootstrap.iters} resamples of ${bootstrap.groups} groups.`,
          promotionTier === "CONFIDENT"
            ? "- **Decision: promote** — improvement is statistically stable at this sample size."
            : "- **Decision: recommended for review** — point estimate improved, but the gain is not statistically stable at this sample size. Confirm on more data / a gold set before trusting it.",
        );
      } else {
        lines.push("- No candidate beat the baseline under the guardrails — current prompt kept.");
      }
      return lines.join("\n");
    })();
    const fullReport = `${assessment}\n\n${report}`;

    if (best) {
      promptRepository.updateVersionNotes(
        best.promptVersionId,
        `★ Best of ${savedRounds} round(s).\n\n${fullReport}`
      );
      versionNoteEntryRepository.createEntry({
        entryId: uuid(),
        promptVersionId: best.promptVersionId,
        origin: "auto_hil",
        eventType: "ai_prompt_iteration",
        body: fullReport,
        metadata: {
          run_id: job.run_id,
          job_id: jobId,
          source_prompt_version_id: job.source_prompt_version_id,
          result_run_id: best.runId,
          baseline: baselineHoldoutCore,
          selected: best.metrics,
          promotion_tier: promotionTier,
          delta_f1: bootstrap ? bootstrap.f1 : null,
          delta_objective: bootstrap ? bootstrap.objective : null,
          objective: objectiveLabel(objective),
          prob_gain: bootstrap ? bootstrap.probGain : null,
          rounds,
        },
        createdBy: "system",
        createdAt: new Date().toISOString(),
      });
    } else {
      versionNoteEntryRepository.createEntry({
        entryId: uuid(),
        promptVersionId: job.source_prompt_version_id,
        origin: "auto_hil",
        eventType: "ai_prompt_iteration",
        body: fullReport,
        metadata: { run_id: job.run_id, job_id: jobId, promoted: false, rounds },
        createdBy: "system",
        createdAt: new Date().toISOString(),
      });
    }

    repo.updateJob(jobId, {
      status: "completed",
      phase: "done",
      progress: 100,
      candidates: allResults,
      rounds,
      report: fullReport,
      result_prompt_version_id: best?.promptVersionId ?? null,
      result_run_id: best?.runId ?? null,
      finished_at: new Date().toISOString(),
    });
    repo.appendLog(
      jobId,
      "done",
      best
        ? `Completed — best: ${best.label} (F1 ${(best.metrics.f1 * 100).toFixed(1)}%) of ${savedRounds} round(s)`
        : `Completed — ${savedRounds} prompt(s) saved; none beat the original baseline`
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Prompt iteration job failed", { jobId, error: msg });
    repo.updateJob(jobId, {
      status: "failed",
      error: msg,
      finished_at: new Date().toISOString(),
    });
    repo.appendLog(jobId, "done", `Failed: ${msg}`);
  } finally {
    iterationJobQueue.delete(jobId);
  }
}

function finishCanceled(jobId: string): void {
  promptIterationRepository.updateJob(jobId, {
    status: "canceled",
    finished_at: new Date().toISOString(),
  });
  promptIterationRepository.appendLog(jobId, "done", "Job canceled");
  iterationJobQueue.delete(jobId);
}

function saveEvaluationRun(params: {
  run: any;
  detectionId: string;
  newPromptVersionId: string;
  modelUsed: string;
  winnerPreds: EvalPrediction[];
}): string {
  const { run, detectionId, newPromptVersionId, modelUsed, winnerPreds } = params;
  const runId = uuid();
  const now = new Date().toISOString();
  runRepository.createRun({
    runId,
    detectionId,
    promptVersionId: newPromptVersionId,
    modelUsed,
    promptSnapshot: JSON.stringify({ source: "ai_prompt_iteration" }),
    decodingParams: JSON.stringify({ model: modelUsed }),
    datasetId: run.dataset_id,
    datasetHash: run.dataset_hash,
    splitType: run.split_type,
    createdAt: now,
    totalImages: winnerPreds.length,
  });

  const predictions: Prediction[] = winnerPreds.map((p) => ({
    prediction_id: uuid(),
    run_id: runId,
    image_id: p.image_id,
    image_uri: p.image_uri,
    ground_truth_label: p.truth,
    predicted_decision: p.predicted,
    confidence: p.confidence,
    evidence: p.evidence,
    parse_ok: p.parse_ok,
    raw_response: p.raw,
    parse_error_reason: p.parse_error_reason,
    parse_fix_suggestion: p.parse_fix_suggestion,
    inference_runtime_ms: p.runtime_ms,
    parse_retry_count: 0,
    corrected_label: null,
    error_tag: deriveEvalErrorTag(p),
    reviewer_note: null,
    corrected_at: null,
  }));
  for (const pred of predictions) {
    runRepository.insertPrediction(pred, pred.error_tag);
  }
  const metrics = computeMetrics(predictions);
  runRepository.updateRunCompletion(runId, JSON.stringify(metrics), "completed", predictions.length);
  return runId;
}

/**
 * Distinguish genuine schema parse failures from transient API/inference call
 * failures so the HIL "Parse Failures" filter counts them correctly. Only true
 * infra errors (raw starts with "ERROR:" or reason is a Model/API error) get
 * INFERENCE_CALL_FAILED; schema-invalid model output gets SCHEMA_VIOLATION.
 */
function deriveEvalErrorTag(p: EvalPrediction): ErrorTag | null {
  if (p.parse_ok) return null;
  const raw = String(p.raw || "");
  const reason = String(p.parse_error_reason || "");
  if (raw.startsWith("ERROR:") || reason.startsWith("Model/API error:")) {
    return "INFERENCE_CALL_FAILED";
  }
  return "SCHEMA_VIOLATION";
}
