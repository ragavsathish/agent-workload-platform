import { createHash } from "node:crypto";

export const JOURNAL_TYPES = Object.freeze([
  "thought",
  "idea",
  "question",
  "decision",
  "goal",
  "learning",
  "unclassified",
]);

export const JOURNAL_SPLITS = Object.freeze([
  "development",
  "challenge",
  "locked_holdout",
  "production_shadow",
]);

const MATCH_THRESHOLD = 0.9;
const TYPE_SET = new Set(JOURNAL_TYPES);
const SPLIT_SET = new Set(JOURNAL_SPLITS);

function asObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function normalizeJournalText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function normalizedSimilarity(left, right) {
  const normalizedLeft = normalizeJournalText(left);
  const normalizedRight = normalizeJournalText(right);
  const width = Math.max(normalizedLeft.length, normalizedRight.length);
  if (width === 0) return 1;
  return 1 - (levenshteinDistance(normalizedLeft, normalizedRight) / width);
}

function validateExpectedEntry(value, caseIndex, entryIndex, transcript) {
  const path = `cases[${caseIndex}].expectedEntries[${entryIndex}]`;
  const entry = asObject(value, path);
  const type = requiredString(entry.type, `${path}.type`);
  if (!TYPE_SET.has(type)) throw new Error(`${path}.type is unsupported`);
  const text = requiredString(entry.text, `${path}.text`);
  const evidenceQuote = requiredString(entry.evidenceQuote, `${path}.evidenceQuote`);
  if (!transcript.includes(evidenceQuote)) {
    throw new Error(`${path}.evidenceQuote must be an exact contiguous transcript quote`);
  }
  if (entry.topics !== undefined) {
    if (!Array.isArray(entry.topics) || entry.topics.length > 8) {
      throw new Error(`${path}.topics must be an array with at most 8 values`);
    }
    entry.topics.forEach((topic, topicIndex) => requiredString(topic, `${path}.topics[${topicIndex}]`));
  }
  return { type, text, evidenceQuote, topics: entry.topics ?? [] };
}

export function validateReviewedManifest(value) {
  const manifest = asObject(value, "manifest");
  if (manifest.formatVersion !== 1) throw new Error("formatVersion must be 1");
  requiredString(manifest.datasetId, "datasetId");
  const privacyReview = asObject(manifest.privacyReview, "privacyReview");
  if (privacyReview.status !== "passed") throw new Error("privacyReview.status must be passed");
  const reviewedAt = requiredString(privacyReview.reviewedAt, "privacyReview.reviewedAt");
  if (Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error("privacyReview.reviewedAt must be an ISO date-time");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error("cases must be a non-empty array");
  }

  const caseIds = new Set();
  const familySplits = new Map();
  const transcriptSplits = new Map();
  const cases = manifest.cases.map((rawCase, caseIndex) => {
    const path = `cases[${caseIndex}]`;
    const item = asObject(rawCase, path);
    const id = requiredString(item.id, `${path}.id`);
    if (caseIds.has(id)) throw new Error(`${path}.id must be unique`);
    caseIds.add(id);
    const semanticFamilyId = requiredString(item.semanticFamilyId, `${path}.semanticFamilyId`);
    const split = requiredString(item.split, `${path}.split`);
    if (!SPLIT_SET.has(split)) throw new Error(`${path}.split is unsupported`);
    const existingFamilySplit = familySplits.get(semanticFamilyId);
    if (existingFamilySplit && existingFamilySplit !== split) {
      throw new Error(`semantic family ${semanticFamilyId} crosses splits`);
    }
    familySplits.set(semanticFamilyId, split);
    const sourceKind = requiredString(item.sourceKind, `${path}.sourceKind`);
    const errorSlice = requiredString(item.errorSlice, `${path}.errorSlice`);
    if (!["reviewed", "adjudicated"].includes(item.annotationStatus)) {
      throw new Error(`${path}.annotationStatus must be reviewed or adjudicated`);
    }
    const transcript = requiredString(item.transcript, `${path}.transcript`);
    const transcriptKey = normalizeJournalText(transcript);
    const existingTranscriptSplit = transcriptSplits.get(transcriptKey);
    if (existingTranscriptSplit && existingTranscriptSplit !== split) {
      throw new Error(`normalized duplicate transcript crosses splits at ${path}`);
    }
    transcriptSplits.set(transcriptKey, split);
    if (!Array.isArray(item.expectedEntries)) {
      throw new Error(`${path}.expectedEntries must be an array; use [] for reviewed empty cases`);
    }
    const expectedEntries = item.expectedEntries.map((entry, entryIndex) => (
      validateExpectedEntry(entry, caseIndex, entryIndex, transcript)
    ));
    return {
      id,
      semanticFamilyId,
      split,
      sourceKind,
      errorSlice,
      annotationStatus: item.annotationStatus,
      transcript,
      expectedEntries,
    };
  });

  return {
    formatVersion: 1,
    datasetId: manifest.datasetId,
    privacyReview: { status: "passed", reviewedAt },
    cases,
  };
}

function rawEntryForPrediction(prediction, rawEntries, usedRawIndexes) {
  const exactIndex = rawEntries.findIndex((entry, index) => !usedRawIndexes.has(index)
    && entry.type === prediction.type
    && normalizeJournalText(entry.text ?? "") === normalizeJournalText(prediction.text));
  if (exactIndex < 0) return {};
  usedRawIndexes.add(exactIndex);
  return { entry: rawEntries[exactIndex], index: exactIndex };
}

function enrichPredictions(predictions, rawEntries, transcript) {
  const usedRawIndexes = new Set();
  const accepted = predictions.map((prediction, index) => {
    const raw = rawEntryForPrediction(prediction, rawEntries, usedRawIndexes);
    const evidenceQuote = typeof raw.entry?.evidenceQuote === "string" ? raw.entry.evidenceQuote : undefined;
    return {
      predictionIndex: index,
      type: prediction.type,
      text: prediction.text,
      topics: prediction.topics ?? [],
      evidenceQuote,
      evidenceExact: evidenceQuote !== undefined && transcript.includes(evidenceQuote),
      rawIndex: raw.index,
    };
  });
  const rejected = rawEntries.flatMap((entry, rawIndex) => {
    if (usedRawIndexes.has(rawIndex)) return [];
    const evidenceQuote = typeof entry.evidenceQuote === "string" ? entry.evidenceQuote : "";
    return [{
      rawIndex,
      type: entry.type,
      text: entry.text,
      evidenceQuote,
      status: evidenceQuote && !transcript.includes(evidenceQuote)
        ? "unsupported_prediction"
        : "post_filter_rejection",
    }];
  });
  return { accepted, rejected };
}

function pairRank(expected, predicted) {
  const evidenceMatch = Boolean(predicted.evidenceQuote) && predicted.evidenceQuote === expected.evidenceQuote;
  const similarity = normalizedSimilarity(expected.text, predicted.text);
  const exactText = normalizeJournalText(expected.text) === normalizeJournalText(predicted.text);
  if (!evidenceMatch && !exactText && similarity < MATCH_THRESHOLD) return undefined;
  return {
    evidenceMatch,
    exactText,
    similarity,
    score: Number(evidenceMatch) * 4 + Number(exactText) * 3
      + Number(expected.type === predicted.type) * 2 + similarity,
  };
}

function matchEntries(expectedEntries, predictions) {
  const candidates = [];
  expectedEntries.forEach((expected, expectedIndex) => {
    predictions.forEach((predicted, predictionIndex) => {
      const rank = pairRank(expected, predicted);
      if (rank) candidates.push({ expectedIndex, predictionIndex, ...rank });
    });
  });
  candidates.sort((left, right) => right.score - left.score
    || left.expectedIndex - right.expectedIndex
    || left.predictionIndex - right.predictionIndex);
  const usedExpected = new Set();
  const usedPredictions = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedExpected.has(candidate.expectedIndex) || usedPredictions.has(candidate.predictionIndex)) continue;
    usedExpected.add(candidate.expectedIndex);
    usedPredictions.add(candidate.predictionIndex);
    matches.push(candidate);
  }
  return { matches, usedExpected, usedPredictions };
}

export function compareReviewedCase(item, observation) {
  const eligibleTranscript = observation.eligibleTranscript ?? "";
  const predictions = Array.isArray(observation.entries) ? observation.entries : [];
  const rawEntries = Array.isArray(observation.rawEntries) ? observation.rawEntries : [];
  const { accepted, rejected } = enrichPredictions(predictions, rawEntries, item.transcript);
  const { matches, usedExpected, usedPredictions } = matchEntries(item.expectedEntries, accepted);
  const rows = [];

  for (const match of matches) {
    const expected = item.expectedEntries[match.expectedIndex];
    const predicted = accepted[match.predictionIndex];
    const status = expected.type !== predicted.type
      ? "wrong_type"
      : match.exactText ? "exact_match" : "near_text_match";
    rows.push({
      caseId: item.id,
      semanticFamilyId: item.semanticFamilyId,
      split: item.split,
      sourceKind: item.sourceKind,
      errorSlice: item.errorSlice,
      status,
      expected,
      predicted,
      textSimilarity: match.similarity,
      normalizedEditDistance: 1 - match.similarity,
    });
  }

  item.expectedEntries.forEach((expected, expectedIndex) => {
    if (usedExpected.has(expectedIndex)) return;
    rows.push({
      caseId: item.id,
      semanticFamilyId: item.semanticFamilyId,
      split: item.split,
      sourceKind: item.sourceKind,
      errorSlice: item.errorSlice,
      status: eligibleTranscript.includes(expected.evidenceQuote)
        ? "missing_prediction_good_input"
        : "missing_prediction_bad_input",
      expected,
    });
  });

  accepted.forEach((predicted, predictionIndex) => {
    if (usedPredictions.has(predictionIndex)) return;
    rows.push({
      caseId: item.id,
      semanticFamilyId: item.semanticFamilyId,
      split: item.split,
      sourceKind: item.sourceKind,
      errorSlice: item.errorSlice,
      status: "false_capture",
      predicted,
    });
  });

  for (const rawPrediction of rejected) {
    rows.push({
      caseId: item.id,
      semanticFamilyId: item.semanticFamilyId,
      split: item.split,
      sourceKind: item.sourceKind,
      errorSlice: item.errorSlice,
      status: rawPrediction.status,
      rawPrediction,
    });
  }

  return {
    caseId: item.id,
    split: item.split,
    expectedCount: item.expectedEntries.length,
    predictedCount: accepted.length,
    rawPredictionCount: rawEntries.length,
    latencyMs: observation.latencyMs ?? 0,
    error: observation.error,
    rows,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentage / 100) * ordered.length) - 1);
  return ordered[index];
}

function summarizeRows(rows) {
  const correct = rows.filter((row) => ["exact_match", "near_text_match"].includes(row.status)).length;
  const expected = rows.filter((row) => row.expected).length;
  const predicted = rows.filter((row) => row.predicted).length;
  const falseCaptures = rows.filter((row) => row.status === "false_capture").length;
  const misses = rows.filter((row) => row.status.startsWith("missing_prediction_")).length;
  return {
    expectedEntries: expected,
    predictedEntries: predicted,
    correctTypeMatches: correct,
    entryPrecision: ratio(correct, predicted),
    entryRecall: ratio(correct, expected),
    entryF1: correct === 0 ? (expected + predicted === 0 ? 1 : 0) : (2 * correct) / (expected + predicted),
    falseDurableCaptureRate: ratio(falseCaptures, predicted),
    missedEntryRate: ratio(misses, expected),
  };
}

function groupMetrics(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupedRows]) => [key, summarizeRows(groupedRows)]));
}

function perTypeMetrics(rows) {
  const metrics = {};
  for (const type of JOURNAL_TYPES) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const row of rows) {
      const expectedType = row.expected?.type;
      const predictedType = row.predicted?.type;
      if (expectedType === type && predictedType === type
        && ["exact_match", "near_text_match"].includes(row.status)) {
        truePositive += 1;
      } else {
        if (predictedType === type) falsePositive += 1;
        if (expectedType === type) falseNegative += 1;
      }
    }
    metrics[type] = {
      support: truePositive + falseNegative,
      precision: ratio(truePositive, truePositive + falsePositive),
      recall: ratio(truePositive, truePositive + falseNegative),
      f1: truePositive === 0
        ? (falsePositive + falseNegative === 0 ? null : 0)
        : (2 * truePositive) / ((2 * truePositive) + falsePositive + falseNegative),
    };
  }
  return metrics;
}

export function buildReviewedMetrics(manifest, caseResults, runMetadata = {}) {
  const rows = caseResults.flatMap((result) => result.rows);
  const acceptedRows = rows.filter((row) => row.predicted);
  const rawDiagnosticRows = rows.filter((row) => row.rawPrediction);
  const expectedPositiveCases = caseResults.filter((result) => result.expectedCount > 0);
  const predictedPositiveCases = caseResults.filter((result) => result.predictedCount > 0);
  const truePositiveCases = caseResults.filter((result) => result.expectedCount > 0 && result.predictedCount > 0);
  const trueNegativeCases = caseResults.filter((result) => result.expectedCount === 0 && result.predictedCount === 0);
  const matchedRows = rows.filter((row) => row.expected && row.predicted);
  const statusCounts = Object.fromEntries([...new Set(rows.map((row) => row.status))].sort()
    .map((status) => [status, rows.filter((row) => row.status === status).length]));
  const summary = summarizeRows(rows);
  const editDistances = matchedRows.map((row) => row.normalizedEditDistance ?? 0);
  const confusion = {};
  for (const row of rows.filter((candidate) => candidate.expected || candidate.predicted)) {
    const expected = row.expected?.type ?? "none";
    const predicted = row.predicted?.type ?? "none";
    confusion[expected] ??= {};
    confusion[expected][predicted] = (confusion[expected][predicted] ?? 0) + 1;
  }

  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    datasetId: manifest.datasetId,
    split: runMetadata.split,
    digests: runMetadata.digests ?? {},
    configuration: runMetadata.configuration ?? {},
    readiness: {
      privacyReview: manifest.privacyReview.status,
      semanticFamiliesDisjoint: true,
      normalizedDuplicatesCrossSplits: 0,
      reviewedCases: manifest.cases.length,
    },
    operational: {
      evaluatedCases: caseResults.length,
      successfulCases: caseResults.filter((result) => !result.error).length,
      runtimeErrors: caseResults.filter((result) => result.error).length,
      medianLatencyMs: percentile(caseResults.map((result) => result.latencyMs), 50),
      p95LatencyMs: percentile(caseResults.map((result) => result.latencyMs), 95),
    },
    capture: {
      expectedPositive: expectedPositiveCases.length,
      predictedPositive: predictedPositiveCases.length,
      precision: ratio(truePositiveCases.length, predictedPositiveCases.length),
      recall: ratio(truePositiveCases.length, expectedPositiveCases.length),
      negativeRejectionRate: ratio(
        trueNegativeCases.length,
        caseResults.filter((result) => result.expectedCount === 0).length,
      ),
      overSegmentedCases: caseResults.filter((result) => result.predictedCount > result.expectedCount).length,
      underSegmentedCases: caseResults.filter((result) => result.predictedCount < result.expectedCount).length,
    },
    entry: {
      ...summary,
      exactTextMatchRate: ratio(statusCounts.exact_match ?? 0, matchedRows.length),
      textEditRate: ratio(matchedRows.filter((row) => row.status !== "exact_match").length, matchedRows.length),
      meanNormalizedEditDistance: editDistances.length === 0
        ? null
        : editDistances.reduce((sum, value) => sum + value, 0) / editDistances.length,
      exactEvidenceValidityRate: ratio(
        acceptedRows.filter((row) => row.predicted.evidenceExact).length,
        acceptedRows.length,
      ),
      rawUnsupportedRate: ratio(
        rawDiagnosticRows.filter((row) => row.status === "unsupported_prediction").length,
        caseResults.reduce((sum, result) => sum + result.rawPredictionCount, 0),
      ),
      statusCounts,
      perType: perTypeMetrics(rows),
      confusionMatrix: confusion,
    },
    slices: {
      byErrorSlice: groupMetrics(rows, "errorSlice"),
      bySourceKind: groupMetrics(rows, "sourceKind"),
    },
  };
}
