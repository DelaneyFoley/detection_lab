import crypto from "crypto";
import type { QaSample, QaLog, AnnotatorMetrics, MetricsSnapshot, DatasetMetric } from "@/types";
import { dataStore } from "@/lib/services";

export class QaRepository {
  // ============ Dataset QA operations ============

  updateQaStatus(datasetId: string, newStatus: string): void {
    dataStore.run(
      "UPDATE datasets SET qa_status = ?, updated_at = ? WHERE dataset_id = ?",
      newStatus,
      new Date().toISOString(),
      datasetId
    );
  }

  assignDataset(datasetId: string, assignedTo: string | null): void {
    dataStore.run(
      "UPDATE datasets SET assigned_to = ?, updated_at = ? WHERE dataset_id = ?",
      assignedTo,
      new Date().toISOString(),
      datasetId
    );
  }

  linkDatasets(datasetIdA: string, datasetIdB: string): void {
    const now = new Date().toISOString();
    dataStore.run(
      "UPDATE datasets SET linked_dataset_id = ?, updated_at = ? WHERE dataset_id = ?",
      datasetIdB,
      now,
      datasetIdA
    );
    dataStore.run(
      "UPDATE datasets SET linked_dataset_id = ?, updated_at = ? WHERE dataset_id = ?",
      datasetIdA,
      now,
      datasetIdB
    );
  }

  unlinkDatasets(datasetIdA: string, datasetIdB: string): void {
    const now = new Date().toISOString();
    dataStore.run(
      "UPDATE datasets SET linked_dataset_id = NULL, updated_at = ? WHERE dataset_id = ?",
      now,
      datasetIdA
    );
    dataStore.run(
      "UPDATE datasets SET linked_dataset_id = NULL, updated_at = ? WHERE dataset_id = ?",
      now,
      datasetIdB
    );
  }

  getDatasetsWithQaInfo(filters: {
    qaStatus?: string | string[];
    detectionId?: string | string[];
    assignedTo?: string | string[];
  }): any[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    const addFilter = (column: string, value: string | string[] | undefined) => {
      if (value === undefined) return;
      const values = Array.isArray(value) ? value.filter((v) => v !== "") : (value === "" ? [] : [value]);
      if (values.length === 0) return;
      const placeholders = values.map(() => "?").join(", ");
      clauses.push(`${column} IN (${placeholders})`);
      params.push(...values);
    };

    addFilter("qa_status", filters.qaStatus);
    addFilter("detection_id", filters.detectionId);
    addFilter("assigned_to", filters.assignedTo);

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return dataStore.all<any>(
      `SELECT d.*, (
        SELECT ql.created_at FROM qa_logs ql
        WHERE ql.dataset_id = d.dataset_id AND ql.action = 'assigned'
        ORDER BY ql.created_at DESC LIMIT 1
      ) AS assigned_at
      FROM datasets d ${where} ORDER BY assigned_at DESC`,
      ...params
    );
  }

  getKnownAnnotators(): string[] {
    const rows = dataStore.all<{ name: string }>(
      "SELECT name FROM annotators ORDER BY name"
    );
    if (rows.length > 0) return rows.map((r) => r.name);
    const fallback = dataStore.all<{ assigned_to: string }>(
      "SELECT DISTINCT assigned_to FROM datasets WHERE assigned_to IS NOT NULL AND assigned_to != ''"
    );
    return fallback.map((r) => r.assigned_to);
  }

  addAnnotator(name: string): void {
    dataStore.run(
      "INSERT OR IGNORE INTO annotators (name, created_at) VALUES (?, ?)",
      name,
      new Date().toISOString()
    );
  }

  removeAnnotator(name: string): void {
    dataStore.run("DELETE FROM annotators WHERE name = ?", name);
  }

  getAnnotatorsAlreadyAssigned(parentId: string): string[] {
    const rows = dataStore.all<{ assigned_to: string }>(
      "SELECT assigned_to FROM datasets WHERE linked_dataset_id = ? AND assigned_to IS NOT NULL",
      parentId
    );
    return rows.map((r) => r.assigned_to);
  }

  // ============ Discrepancy operations ============

  getDiscrepancies(datasetIdA: string, datasetIdB: string): any[] {
    return dataStore.all<any>(
      `SELECT
        a.image_id,
        a.image_uri,
        a.ground_truth_label AS label_a,
        b.ground_truth_label AS label_b,
        a.segment_tags AS tags_a,
        b.segment_tags AS tags_b,
        a.item_id AS item_id_a,
        b.item_id AS item_id_b,
        CASE WHEN COALESCE(a.ground_truth_label,'') != COALESCE(b.ground_truth_label,'') THEN 1 ELSE 0 END AS label_mismatch,
        CASE WHEN COALESCE(a.segment_tags,'[]') != COALESCE(b.segment_tags,'[]') THEN 1 ELSE 0 END AS tags_mismatch
      FROM dataset_items a
      INNER JOIN dataset_items b ON a.image_id = b.image_id
      WHERE a.dataset_id = ? AND b.dataset_id = ?
        AND (a.ground_truth_label IS NOT NULL OR b.ground_truth_label IS NOT NULL)
        AND (
          (a.ground_truth_label IS NOT NULL AND b.ground_truth_label IS NOT NULL AND a.ground_truth_label != b.ground_truth_label)
          OR (COALESCE(a.segment_tags, '[]') != COALESCE(b.segment_tags, '[]'))
        )
      ORDER BY a.image_id`,
      datasetIdA,
      datasetIdB
    );
  }

  getOverlapCount(datasetIdA: string, datasetIdB: string): number {
    const row = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM dataset_items a
       INNER JOIN dataset_items b ON a.image_id = b.image_id
       WHERE a.dataset_id = ? AND b.dataset_id = ?`,
      datasetIdA,
      datasetIdB
    );
    return row?.count ?? 0;
  }

  getResolvedDiscrepancies(datasetIdA: string, datasetIdB: string): any[] {
    const logs = dataStore.all<{ details: string; actor: string | null; created_at: string }>(
      `SELECT details, actor, created_at FROM qa_logs
       WHERE action = 'discrepancy_resolved' AND dataset_id = ?
       ORDER BY created_at DESC`,
      datasetIdA
    );
    return logs
      .map((log) => {
        const details = JSON.parse(log.details || "{}");
        if (!details.image_id) return null;
        const item = dataStore.get<{ image_uri: string }>(
          "SELECT image_uri FROM dataset_items WHERE dataset_id = ? AND image_id = ? LIMIT 1",
          datasetIdA,
          details.image_id
        );
        return {
          image_id: details.image_id,
          image_uri: item?.image_uri || null,
          resolution: details.resolution,
          resolved_label: details.resolved_label || null,
          corrected_tags: details.corrected_tags || null,
          actor: log.actor,
          resolved_at: log.created_at,
        };
      })
      .filter((d) => d !== null);
  }

  getResolvedDiscrepancyLog(datasetIdA: string, imageId: string): { details: string; actor: string | null; created_at: string } | undefined {
    return dataStore.get<{ details: string; actor: string | null; created_at: string }>(
      `SELECT details, actor, created_at FROM qa_logs
       WHERE action = 'discrepancy_resolved' AND dataset_id = ? AND json_extract(details, '$.image_id') = ?
       ORDER BY created_at DESC LIMIT 1`,
      datasetIdA,
      imageId
    );
  }

  deleteResolvedDiscrepancyLog(datasetIdA: string, imageId: string): void {
    dataStore.run(
      `DELETE FROM qa_logs
       WHERE action = 'discrepancy_resolved' AND dataset_id = ? AND json_extract(details, '$.image_id') = ?`,
      datasetIdA,
      imageId
    );
  }

  // ============ QA Samples ============

  clearSamples(datasetId: string): void {
    dataStore.run("DELETE FROM qa_samples WHERE dataset_id = ?", datasetId);
  }

  acceptSamples(datasetId: string): void {
    dataStore.run(
      "UPDATE qa_samples SET status = 'accepted' WHERE dataset_id = ? AND status = 'reviewed'",
      datasetId
    );
  }

  areSamplesAccepted(datasetId: string): boolean {
    const row = dataStore.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM qa_samples WHERE dataset_id = ? AND status = 'accepted'",
      datasetId
    );
    return (row?.count ?? 0) > 0;
  }

  createSamples(input: {
    datasetId: string;
    method: string;
    count: number;
    stratifyBy?: string;
    reviewer?: string;
  }): string[] {
    const now = new Date().toISOString();
    const currentAttempt = this.getMaxAttempt(input.datasetId) + 1;

    const previousItemIds = dataStore.all<{ item_id: string }>(
      "SELECT DISTINCT item_id FROM qa_samples WHERE dataset_id = ?",
      input.datasetId
    ).map((r) => r.item_id);
    const exclusionSet = new Set(previousItemIds);

    let items: { item_id: string }[];

    if (input.method === "stratified" && input.stratifyBy === "label") {
      const detected = dataStore.all<{ item_id: string }>(
        "SELECT item_id FROM dataset_items WHERE dataset_id = ? AND ground_truth_label = 'DETECTED' ORDER BY RANDOM()",
        input.datasetId
      );
      const notDetected = dataStore.all<{ item_id: string }>(
        "SELECT item_id FROM dataset_items WHERE dataset_id = ? AND ground_truth_label = 'NOT_DETECTED' ORDER BY RANDOM()",
        input.datasetId
      );
      const total = detected.length + notDetected.length;
      if (total === 0) return [];
      const detectedCount = Math.round((detected.length / total) * input.count);
      const notDetectedCount = input.count - detectedCount;

      const freshDetected = detected.filter((i) => !exclusionSet.has(i.item_id));
      const freshNotDetected = notDetected.filter((i) => !exclusionSet.has(i.item_id));
      const usedDetected = detected.filter((i) => exclusionSet.has(i.item_id));
      const usedNotDetected = notDetected.filter((i) => exclusionSet.has(i.item_id));

      const selectedDetected = freshDetected.slice(0, detectedCount);
      if (selectedDetected.length < detectedCount) {
        selectedDetected.push(...usedDetected.slice(0, detectedCount - selectedDetected.length));
      }
      const selectedNotDetected = freshNotDetected.slice(0, notDetectedCount);
      if (selectedNotDetected.length < notDetectedCount) {
        selectedNotDetected.push(...usedNotDetected.slice(0, notDetectedCount - selectedNotDetected.length));
      }
      items = [...selectedDetected, ...selectedNotDetected];
    } else {
      const allItems = dataStore.all<{ item_id: string }>(
        "SELECT item_id FROM dataset_items WHERE dataset_id = ? ORDER BY RANDOM()",
        input.datasetId
      );
      const fresh = allItems.filter((i) => !exclusionSet.has(i.item_id));
      const used = allItems.filter((i) => exclusionSet.has(i.item_id));
      items = fresh.slice(0, input.count);
      if (items.length < input.count) {
        items.push(...used.slice(0, input.count - items.length));
      }
    }

    const sampleIds: string[] = [];
    for (const item of items) {
      const sampleId = crypto.randomUUID();
      sampleIds.push(sampleId);
      dataStore.run(
        `INSERT INTO qa_samples (sample_id, dataset_id, item_id, sample_method, reviewer, status, created_at, attempt_number)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        sampleId,
        input.datasetId,
        item.item_id,
        input.method,
        input.reviewer || null,
        now,
        currentAttempt
      );
    }
    return sampleIds;
  }

  getMaxAttempt(datasetId: string): number {
    const row = dataStore.get<{ max_attempt: number }>(
      "SELECT COALESCE(MAX(attempt_number), 0) as max_attempt FROM qa_samples WHERE dataset_id = ?",
      datasetId
    );
    return row?.max_attempt ?? 0;
  }

  getSamplesByDataset(datasetId: string, status?: string, attemptNumber?: number): any[] {
    const clauses: string[] = ["qs.dataset_id = ?"];
    const params: (string | number)[] = [datasetId];
    if (status) { clauses.push("qs.status = ?"); params.push(status); }
    if (attemptNumber) { clauses.push("qs.attempt_number = ?"); params.push(attemptNumber); }
    return dataStore.all<any>(
      `SELECT qs.*, di.image_uri, di.image_id, di.ground_truth_label, di.segment_tags, di.image_description
       FROM qa_samples qs
       LEFT JOIN dataset_items di ON qs.item_id = di.item_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY qs.created_at DESC`,
      ...params
    );
  }

  reviewSample(
    sampleId: string,
    outcome: string,
    note: string | null,
    reviewer?: string,
    corrections?: { originalLabel?: string | null; originalTags?: string[] | null; correctedLabel?: string | null; correctedTags?: string[] | null }
  ): void {
    const now = new Date().toISOString();
    dataStore.run(
      `UPDATE qa_samples SET status = 'reviewed', outcome = ?, note = ?, reviewed_at = ?, reviewer = COALESCE(?, reviewer),
       original_label = COALESCE(?, original_label), original_tags = COALESCE(?, original_tags),
       corrected_label = COALESCE(?, corrected_label), corrected_tags = COALESCE(?, corrected_tags)
       WHERE sample_id = ?`,
      outcome,
      note,
      now,
      reviewer || null,
      corrections?.originalLabel ?? null,
      corrections?.originalTags ? JSON.stringify(corrections.originalTags) : null,
      corrections?.correctedLabel ?? null,
      corrections?.correctedTags ? JSON.stringify(corrections.correctedTags) : null,
      sampleId
    );
  }

  getSampleById(sampleId: string): QaSample | undefined {
    return dataStore.get<QaSample>("SELECT * FROM qa_samples WHERE sample_id = ?", sampleId);
  }

  getSampleStats(datasetId: string, attemptNumber?: number): { total: number; reviewed: number; correct: number; incorrect: number; ambiguous: number } {
    const clauses = ["dataset_id = ?"];
    const params: (string | number)[] = [datasetId];
    if (attemptNumber) { clauses.push("attempt_number = ?"); params.push(attemptNumber); }
    const row = dataStore.get<any>(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('reviewed','accepted') THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN outcome IN ('label_corrected','attributes_corrected','both_corrected') THEN 1 ELSE 0 END) as incorrect,
        0 as ambiguous
      FROM qa_samples WHERE ${clauses.join(" AND ")}`,
      ...params
    );
    return {
      total: row?.total ?? 0,
      reviewed: row?.reviewed ?? 0,
      correct: row?.correct ?? 0,
      incorrect: row?.incorrect ?? 0,
      ambiguous: row?.ambiguous ?? 0,
    };
  }

  getSampleHistory(datasetId: string, excludeAttempt?: number): any[] {
    const clauses = ["qs.dataset_id = ?"];
    const params: (string | number)[] = [datasetId];
    if (excludeAttempt) { clauses.push("qs.attempt_number != ?"); params.push(excludeAttempt); }
    return dataStore.all<any>(
      `SELECT qs.*, di.image_uri, di.image_id, di.ground_truth_label, di.segment_tags
       FROM qa_samples qs
       LEFT JOIN dataset_items di ON qs.item_id = di.item_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY qs.attempt_number DESC, qs.created_at DESC`,
      ...params
    );
  }

  // ============ QA Logs ============

  createLog(input: {
    datasetId: string;
    action: string;
    actor?: string;
    details?: Record<string, unknown>;
  }): void {
    dataStore.run(
      `INSERT INTO qa_logs (log_id, dataset_id, action, actor, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      input.datasetId,
      input.action,
      input.actor || null,
      JSON.stringify(input.details || {}),
      new Date().toISOString()
    );
  }

  getLogs(filters: {
    datasetId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): { logs: QaLog[]; total: number } {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filters.datasetId) {
      clauses.push("dataset_id = ?");
      params.push(filters.datasetId);
    }
    if (filters.action) {
      clauses.push("action = ?");
      params.push(filters.action);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalRow = dataStore.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM qa_logs ${where}`,
      ...params
    );

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const logs = dataStore.all<QaLog>(
      `SELECT * FROM qa_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );

    return { logs, total: totalRow?.count ?? 0 };
  }

  // ============ Annotator Metrics ============

  getAnnotatorMetrics(filters: {
    annotator?: string;
    detectionId?: string;
  }): { metrics: AnnotatorMetrics[]; totals: AnnotatorMetrics } {
    const annotators = filters.annotator
      ? [filters.annotator]
      : this.getKnownAnnotators();

    let totalDatasetsAssigned = 0;
    let totalDatasetsCompleted = 0;
    let totalItemsLabeled = 0;
    let totalFlags = 0;
    let totalLabelMatches = 0;
    let totalLabelsCompared = 0;
    let totalAttrMatches = 0;
    let totalAttrCount = 0;

    const metrics = annotators.map((annotator) => {
      const datasetFilter = filters.detectionId
        ? "AND detection_id = ?"
        : "";
      const datasetParams: (string | number)[] = filters.detectionId
        ? [annotator, filters.detectionId]
        : [annotator];

      const datasets = dataStore.all<{ dataset_id: string; items_labeled: number; qa_status: string; linked_dataset_id: string | null }>(
        `SELECT dataset_id, COALESCE(items_labeled, size, 0) as items_labeled, qa_status, linked_dataset_id FROM datasets WHERE assigned_to = ? ${datasetFilter}`,
        ...datasetParams
      );

      const datasetsAssigned = datasets.length;
      const datasetsCompleted = datasets.filter((d) => d.qa_status === "approved" || d.qa_status === "finalized").length;
      const itemsLabeled = datasets.reduce((sum, d) => sum + d.items_labeled, 0);

      totalDatasetsAssigned += datasetsAssigned;
      totalDatasetsCompleted += datasetsCompleted;
      totalItemsLabeled += itemsLabeled;

      const datasetIds = datasets.map((d) => d.dataset_id);

      let flagRate: number | null = null;
      if (datasetIds.length > 0 && itemsLabeled > 0) {
        const placeholders = datasetIds.map(() => "?").join(",");
        const flagCount = dataStore.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM review_flags
           WHERE dataset_item_id IN (SELECT item_id FROM dataset_items WHERE dataset_id IN (${placeholders}))
           AND status IN ('open','resolved')`,
          ...datasetIds
        );
        const flags = flagCount?.count ?? 0;
        totalFlags += flags;
        flagRate = flags / itemsLabeled;
      }

      let labelError: number | null = null;
      let attributeError: number | null = null;
      let accuracy: number | null = null;
      let correction: number | null = null;

      const linkedFinalized = datasets.filter(
        (d) => d.linked_dataset_id != null
      );

      if (linkedFinalized.length > 0) {
        let annotatorLabelMatches = 0;
        let annotatorLabelsCompared = 0;
        let annotatorAttrMatches = 0;
        let annotatorAttrCount = 0;

        for (const ds of linkedFinalized) {
          const refStatus = dataStore.get<{ qa_status: string; exclude_attributes: number | null }>(
            "SELECT qa_status, exclude_attributes FROM datasets WHERE dataset_id = ?",
            ds.linked_dataset_id!
          );
          if (!refStatus || refStatus.qa_status !== "finalized") continue;

          // When the parent's discrepancy review excluded attribute tags, they
          // do not count for or against the annotator — only labels are scored.
          const excludeAttributes = !!refStatus.exclude_attributes;

          // Full attribute taxonomy for this dataset's detection. Every compared
          // image contributes one apply/omit decision per taxonomy attribute, so
          // the attribute denominator is (compared images × taxonomy size) and
          // both correct applications (true positives) and correct omissions
          // (true negatives) count toward accuracy.
          const detRow = dataStore.get<{ segment_taxonomy: string | null }>(
            `SELECT det.segment_taxonomy AS segment_taxonomy
             FROM datasets d
             JOIN detections det ON det.detection_id = d.detection_id
             WHERE d.dataset_id = ?`,
            ds.dataset_id
          );
          const taxonomy = parseTags(detRow?.segment_taxonomy ?? null);

          const pairs = dataStore.all<{
            ann_label: string | null;
            ref_label: string | null;
            ann_tags: string | null;
            ref_tags: string | null;
          }>(
            `SELECT
              a.ground_truth_label AS ann_label,
              b.ground_truth_label AS ref_label,
              a.segment_tags AS ann_tags,
              b.segment_tags AS ref_tags
            FROM dataset_items a
            INNER JOIN dataset_items b ON a.image_id = b.image_id
            WHERE a.dataset_id = ? AND b.dataset_id = ?`,
            ds.dataset_id,
            ds.linked_dataset_id!
          );

          for (const pair of pairs) {
            // Only score images that were actually annotated in the finalized reference.
            if (!pair.ref_label) continue;

            annotatorLabelsCompared++;
            if (pair.ann_label === pair.ref_label) {
              annotatorLabelMatches++;
            }

            if (taxonomy.length > 0 && !excludeAttributes) {
              const refTags = parseTags(pair.ref_tags);
              const annTags = parseTags(pair.ann_tags);
              annotatorAttrCount += taxonomy.length;
              for (const attr of taxonomy) {
                // Correct when the annotator's apply/omit decision matches the
                // reference — a correct application or a correct omission.
                if (refTags.includes(attr) === annTags.includes(attr)) {
                  annotatorAttrMatches++;
                }
              }
            }
          }
        }

        totalLabelMatches += annotatorLabelMatches;
        totalLabelsCompared += annotatorLabelsCompared;
        totalAttrMatches += annotatorAttrMatches;
        totalAttrCount += annotatorAttrCount;

        if (annotatorLabelsCompared > 0) {
          labelError = annotatorLabelMatches / annotatorLabelsCompared;
        }
        if (annotatorAttrCount > 0) {
          attributeError = annotatorAttrMatches / annotatorAttrCount;
        }
        const totalCorrect = annotatorLabelMatches + annotatorAttrMatches;
        const totalPossible = annotatorLabelsCompared + annotatorAttrCount;
        if (totalPossible > 0) {
          accuracy = totalCorrect / totalPossible;
          correction = 1 - accuracy;
        }
      }

      return {
        annotator,
        datasets_assigned: datasetsAssigned,
        datasets_completed: datasetsCompleted,
        items_labeled: itemsLabeled,
        flag_rate: flagRate,
        attribute_error: attributeError,
        label_error: labelError,
        accuracy,
        correction,
      };
    });

    const totalCorrectAll = totalLabelMatches + totalAttrMatches;
    const totalPossibleAll = totalLabelsCompared + totalAttrCount;

    const totals: AnnotatorMetrics = {
      annotator: "Total",
      datasets_assigned: totalDatasetsAssigned,
      datasets_completed: totalDatasetsCompleted,
      items_labeled: totalItemsLabeled,
      flag_rate: totalItemsLabeled > 0 ? totalFlags / totalItemsLabeled : null,
      attribute_error: totalAttrCount > 0 ? totalAttrMatches / totalAttrCount : null,
      label_error: totalLabelsCompared > 0 ? totalLabelMatches / totalLabelsCompared : null,
      accuracy: totalPossibleAll > 0 ? totalCorrectAll / totalPossibleAll : null,
      correction: totalPossibleAll > 0 ? 1 - (totalCorrectAll / totalPossibleAll) : null,
    };

    return { metrics, totals };
  }

  /**
   * Persist a point-in-time metrics snapshot for every known annotator.
   *
   * This is the production snapshot-generation path. It delegates all metric
   * math to {@link getAnnotatorMetrics} so the trend chart (which reads
   * `metrics_snapshots`) and the live performance table share a single source
   * of truth. Snapshots are written at weekly granularity by default; the
   * monthly chart view rolls these weekly rows up in {@link getMetricsHistory}.
   */
  generateMetricsSnapshot(options: { periodType?: "week" | "month"; date?: Date } = {}): {
    period_start: string;
    period_end: string;
    period_type: "week" | "month";
    count: number;
  } {
    const periodType = options.periodType || "week";
    const { periodStart, periodEnd } = getPeriodBounds(options.date || new Date(), periodType);

    // Single source of truth: current metric values per annotator.
    const { metrics } = this.getAnnotatorMetrics({});
    const now = new Date().toISOString();

    for (const m of metrics) {
      // Upsert on (annotator, period_start, period_type): re-running the job for
      // the same period overwrites the prior snapshot rather than duplicating it.
      dataStore.run(
        "DELETE FROM metrics_snapshots WHERE annotator = ? AND period_start = ? AND period_type = ?",
        m.annotator,
        periodStart,
        periodType
      );
      dataStore.run(
        `INSERT INTO metrics_snapshots
          (snapshot_id, annotator, period_start, period_end, period_type,
           datasets_assigned, datasets_completed, items_labeled,
           flag_rate, attribute_error, label_error, accuracy, correction, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        m.annotator,
        periodStart,
        periodEnd,
        periodType,
        m.datasets_assigned,
        m.datasets_completed,
        m.items_labeled,
        m.flag_rate,
        m.attribute_error,
        m.label_error,
        m.accuracy,
        m.correction,
        now
      );
    }

    return { period_start: periodStart, period_end: periodEnd, period_type: periodType, count: metrics.length };
  }

  getMetricsHistory(filters: {
    annotator?: string;
    periodType?: "week" | "month";
    count?: number;
  }): MetricsSnapshot[] {
    const periodType = filters.periodType || "week";
    const limit = filters.count || 12;

    if (periodType === "week") {
      const clauses: string[] = ["period_type = 'week'"];
      const params: (string | number)[] = [];
      if (filters.annotator) {
        clauses.push("annotator = ?");
        params.push(filters.annotator);
      }
      const where = `WHERE ${clauses.join(" AND ")}`;
      const periodClauses = [...clauses];
      const periodParams = [...params];
      const periodWhere = `WHERE ${periodClauses.join(" AND ")}`;
      const periods = dataStore.all<{ period_start: string }>(
        `SELECT DISTINCT period_start FROM metrics_snapshots ${periodWhere} ORDER BY period_start DESC LIMIT ?`,
        ...periodParams,
        limit
      ).map((r) => r.period_start);
      if (!periods.length) return [];
      const placeholders = periods.map(() => "?").join(",");
      clauses.push(`period_start IN (${placeholders})`);
      params.push(...periods);
      const finalWhere = `WHERE ${clauses.join(" AND ")}`;
      return dataStore.all<MetricsSnapshot>(
        `SELECT * FROM metrics_snapshots ${finalWhere} ORDER BY period_start ASC`,
        ...params
      );
    }

    const clauses: string[] = ["period_type = 'week'"];
    const params: (string | number)[] = [];
    if (filters.annotator) {
      clauses.push("annotator = ?");
      params.push(filters.annotator);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = dataStore.all<MetricsSnapshot>(
      `SELECT * FROM metrics_snapshots ${where} ORDER BY period_start ASC`,
      ...params
    );

    const grouped = new Map<string, MetricsSnapshot[]>();
    for (const row of rows) {
      const month = row.period_start.substring(0, 7);
      const key = `${row.annotator}|${month}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    const results: MetricsSnapshot[] = [];
    for (const [key, snapshots] of grouped) {
      const [annotator, month] = key.split("|");
      const last = snapshots[snapshots.length - 1];
      const sumField = (field: keyof MetricsSnapshot) =>
        snapshots.reduce((sum, s) => sum + ((s[field] as number) || 0), 0);
      // Rate metrics roll up weighted by items labeled so a low-volume week does
      // not count the same as a high-volume one.
      const weightedByItems = (field: keyof MetricsSnapshot) => {
        let num = 0;
        let den = 0;
        for (const s of snapshots) {
          const v = s[field] as number | null;
          const w = (s.items_labeled as number) || 0;
          if (v !== null && v !== undefined && w > 0) {
            num += v * w;
            den += w;
          }
        }
        return den > 0 ? num / den : null;
      };
      results.push({
        snapshot_id: last.snapshot_id,
        annotator,
        period_start: `${month}-01`,
        period_end: last.period_end,
        period_type: "month",
        datasets_assigned: sumField("datasets_assigned"),
        datasets_completed: sumField("datasets_completed"),
        items_labeled: sumField("items_labeled"),
        flag_rate: weightedByItems("flag_rate"),
        attribute_error: weightedByItems("attribute_error"),
        label_error: weightedByItems("label_error"),
        accuracy: weightedByItems("accuracy"),
        correction: weightedByItems("correction"),
      });
    }

    results.sort((a, b) => a.period_start.localeCompare(b.period_start));
    const distinctPeriods = [...new Set(results.map((r) => r.period_start))];
    const limitedPeriods = new Set(distinctPeriods.slice(-limit));
    return results.filter((r) => limitedPeriods.has(r.period_start));
  }

  getItemWithPrediction(itemId: string): { item: any | null; prediction: any | null } {
    const item = dataStore.get<any>(
      "SELECT * FROM dataset_items WHERE item_id = ?",
      itemId
    );
    let prediction = null;
    if (item) {
      prediction = dataStore.get<any>(
        "SELECT * FROM predictions WHERE image_id = ? ORDER BY rowid DESC LIMIT 1",
        item.image_id
      );
    }
    return { item, prediction };
  }

  getItemByPredictionId(predictionId: string): { item: any | null; prediction: any | null } {
    const prediction = dataStore.get<any>(
      "SELECT * FROM predictions WHERE prediction_id = ?",
      predictionId
    );
    if (!prediction) return { item: null, prediction: null };
    const item = dataStore.get<any>(
      "SELECT * FROM dataset_items WHERE image_id = ? ORDER BY rowid DESC LIMIT 1",
      prediction.image_id
    );
    return { item, prediction };
  }

  getDatasetMetrics(annotator: string): DatasetMetric[] {
    return dataStore.all<DatasetMetric>(
      "SELECT * FROM dataset_metrics WHERE annotator = ? ORDER BY dataset_name ASC",
      annotator
    );
  }
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Period boundaries for a snapshot. Weeks run Monday–Sunday; months run from
 * the 1st to the last day. Dates are returned as YYYY-MM-DD (local).
 */
function getPeriodBounds(date: Date, periodType: "week" | "month"): { periodStart: string; periodEnd: string } {
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  if (periodType === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { periodStart: fmt(start), periodEnd: fmt(end) };
  }

  // Week: Monday–Sunday containing `date`.
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { periodStart: fmt(monday), periodEnd: fmt(sunday) };
}

export const qaRepository = new QaRepository();
