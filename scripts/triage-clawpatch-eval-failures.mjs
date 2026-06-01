#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = `Usage:
  node scripts/triage-clawpatch-eval-failures.mjs --score <score.json> [--out <failure-triage.json>] [--pretty]

Options:
  --score            Score report from scripts/evaluate-clawpatch-predictions.mjs.
  --out, -o          Write the deterministic JSON report to this path instead of stdout.
  --pretty           Pretty-print JSON with two-space indentation.
  --help, -h         Show this help.

The triage report omits private prompts, raw predictions, row identifiers, and prediction/reference paths.
`;

function parseArgs(argv) {
  const options = {
    score: null,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--score") {
      options.score = requiredValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--score=")) {
      options.score = arg.slice("--score=".length);
    } else if (arg === "--out" || arg === "-o") {
      options.out = requiredValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readScoreReport(scorePath) {
  let source;
  try {
    source = await readFile(scorePath, "utf8");
  } catch {
    throw new Error("unable to read --score file");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("unable to parse --score JSON");
  }
}

function buildTriage(scoreReport) {
  validateScoreReport(scoreReport);
  const operation = typeof scoreReport.operation === "string" ? scoreReport.operation : "unknown";
  const models = scoreReport.models.map((model) => summarizeModel(model, operation));
  return {
    schemaVersion: 1,
    deterministic: true,
    source: "scripts/evaluate-clawpatch-predictions.mjs",
    operation,
    scoreSchemaVersion: numberOrNull(scoreReport.schemaVersion),
    modelCount: models.length,
    models,
  };
}

function validateScoreReport(scoreReport) {
  if (!scoreReport || typeof scoreReport !== "object" || Array.isArray(scoreReport)) {
    throw new Error("--score must contain a JSON object");
  }
  if (!Array.isArray(scoreReport.models)) {
    throw new Error("--score must contain a models array");
  }
}

function summarizeModel(model, operation) {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("--score models must contain objects");
  }
  const metrics = objectOrEmpty(model.metrics);
  const issueSummary = sortedNumericObject(model.issueSummary);
  return {
    label: safeLabel(model.label),
    issueSummary,
    issueCategorySummary: issueCategorySummary(issueSummary),
    thresholdRelevantMetrics: thresholdRelevantMetrics(metrics, operation),
    likelyRemediationAreas: likelyRemediationAreas(metrics, issueSummary, operation),
  };
}

function thresholdRelevantMetrics(metrics, operation) {
  const common = {
    referenceRows: numberOrZero(metrics.referenceRows),
    predictionRows: numberOrZero(metrics.predictionRows),
    extraPredictionRows: numberOrZero(metrics.extraPredictionRows),
    missingPredictionRows: numberOrZero(metrics.missingPredictionRows),
    jsonLineErrors: numberOrZero(metrics.jsonLineErrors),
    outputParseableRows: numberOrZero(metrics.outputParseableRows),
    outputParseableRate: ratio(metrics.outputParseableRows, metrics.referenceRows),
    schemaValidRows: numberOrZero(metrics.schemaValidRows),
    schemaValidRate: ratio(metrics.schemaValidRows, metrics.referenceRows),
  };

  if (operation === "review") {
    return {
      ...common,
      evidenceValidRows: numberOrZero(metrics.evidenceValidRows),
      evidenceValidRate: ratio(metrics.evidenceValidRows, metrics.referenceRows),
      referenceFindings: numberOrZero(metrics.referenceFindings),
      predictedFindings: numberOrZero(metrics.predictedFindings),
      schemaValidPredictedFindings: numberOrZero(metrics.schemaValidPredictedFindings),
      schemaValidPredictedFindingRate: ratio(metrics.schemaValidPredictedFindings, metrics.predictedFindings),
      evidenceValidPredictedFindings: numberOrZero(metrics.evidenceValidPredictedFindings),
      evidenceValidPredictedFindingRate: ratio(metrics.evidenceValidPredictedFindings, metrics.predictedFindings),
      matchedFindings: numberOrZero(metrics.matchedFindings),
      precision: numberOrZero(metrics.precision),
      recall: numberOrZero(metrics.recall),
      f1: numberOrZero(metrics.f1),
      cleanReferenceRows: numberOrZero(metrics.cleanReferenceRows),
      cleanCorrectRows: numberOrZero(metrics.cleanCorrectRows),
      cleanFalsePositiveRows: numberOrZero(metrics.cleanFalsePositiveRows),
      cleanAccuracy: numberOrZero(metrics.cleanAccuracy),
      cleanFalsePositiveRate: numberOrZero(metrics.cleanFalsePositiveRate),
      nonCleanReferenceRows: numberOrZero(metrics.nonCleanReferenceRows),
      nonCleanAnyPredictionRows: numberOrZero(metrics.nonCleanAnyPredictionRows),
      nonCleanAnyPredictionRate: ratio(metrics.nonCleanAnyPredictionRows, metrics.nonCleanReferenceRows),
    };
  }

  if (operation === "map") {
    return {
      ...common,
      referenceFeatures: numberOrZero(metrics.referenceFeatures),
      predictedFeatures: numberOrZero(metrics.predictedFeatures),
      schemaValidPredictedFeatures: numberOrZero(metrics.schemaValidPredictedFeatures),
      schemaValidPredictedFeatureRate: ratio(metrics.schemaValidPredictedFeatures, metrics.predictedFeatures),
      exactMatchedFeatures: numberOrZero(metrics.exactMatchedFeatures),
      nearMatchedFeatures: numberOrZero(metrics.nearMatchedFeatures),
      exactPrecision: numberOrZero(metrics.exactPrecision),
      exactRecall: numberOrZero(metrics.exactRecall),
      exactF1: numberOrZero(metrics.exactF1),
      nearPrecision: numberOrZero(metrics.nearPrecision),
      nearRecall: numberOrZero(metrics.nearRecall),
      nearF1: numberOrZero(metrics.nearF1),
    };
  }

  if (operation === "revalidate") {
    return {
      ...common,
      exactOutcomeMatches: numberOrZero(metrics.exactOutcomeMatches),
      nearOutcomeMatches: numberOrZero(metrics.nearOutcomeMatches),
      exactOutcomeAccuracy: numberOrZero(metrics.exactOutcomeAccuracy),
      nearOutcomeAccuracy: numberOrZero(metrics.nearOutcomeAccuracy),
      referenceOutcomeCounts: sortedNumericObject(metrics.referenceOutcomeCounts),
      predictedOutcomeCounts: sortedNumericObject(metrics.predictedOutcomeCounts),
    };
  }

  return common;
}

function likelyRemediationAreas(metrics, issueSummary, operation) {
  return {
    schemaDiscipline: schemaDiscipline(metrics, issueSummary, operation),
    evidenceValidity: evidenceValidity(metrics, issueSummary, operation),
    cleanFalsePositives: cleanFalsePositives(metrics),
    recallGaps: recallGaps(metrics, operation),
  };
}

function schemaDiscipline(metrics, issueSummary, operation) {
  const predictedItems =
    operation === "map" ? numberOrZero(metrics.predictedFeatures) : numberOrZero(metrics.predictedFindings);
  const schemaValidPredictedItems =
    operation === "map"
      ? numberOrZero(metrics.schemaValidPredictedFeatures)
      : numberOrZero(metrics.schemaValidPredictedFindings);
  const schemaIssueCount = issueCountByPrefix(issueSummary, "schema.");
  const invalidRows = boundedGap(metrics.referenceRows, metrics.schemaValidRows);
  const invalidPredictedItems = boundedGap(predictedItems, schemaValidPredictedItems);
  return {
    issueCount: schemaIssueCount + numberOrZero(metrics.jsonLineErrors),
    issuesPerReferenceRow: ratio(schemaIssueCount + numberOrZero(metrics.jsonLineErrors), metrics.referenceRows),
    jsonLineErrors: numberOrZero(metrics.jsonLineErrors),
    unparseableRows: boundedGap(metrics.referenceRows, metrics.outputParseableRows),
    invalidSchemaRows: invalidRows,
    invalidSchemaRowRate: ratio(invalidRows, metrics.referenceRows),
    invalidSchemaPredictedItems: invalidPredictedItems,
    invalidSchemaPredictedItemRate: ratio(invalidPredictedItems, predictedItems),
  };
}

function evidenceValidity(metrics, issueSummary, operation) {
  const evidenceIssueCount = issueCountByPrefix(issueSummary, "evidence.");
  const predictedFindings = numberOrZero(metrics.predictedFindings);
  const invalidEvidenceRows = operation === "review" ? boundedGap(metrics.referenceRows, metrics.evidenceValidRows) : 0;
  const invalidEvidenceFindings =
    operation === "review" ? boundedGap(metrics.predictedFindings, metrics.evidenceValidPredictedFindings) : 0;
  return {
    issueCount: evidenceIssueCount,
    issuesPerReferenceRow: ratio(evidenceIssueCount, metrics.referenceRows),
    invalidEvidenceRows,
    invalidEvidenceRowRate: ratio(invalidEvidenceRows, metrics.referenceRows),
    invalidEvidenceFindings,
    invalidEvidenceFindingRate: ratio(invalidEvidenceFindings, predictedFindings),
  };
}

function cleanFalsePositives(metrics) {
  return {
    cleanReferenceRows: numberOrZero(metrics.cleanReferenceRows),
    cleanCorrectRows: numberOrZero(metrics.cleanCorrectRows),
    cleanFalsePositiveRows: numberOrZero(metrics.cleanFalsePositiveRows),
    cleanFalsePositiveRate: numberOrZero(metrics.cleanFalsePositiveRate),
    cleanAccuracy: numberOrZero(metrics.cleanAccuracy),
  };
}

function recallGaps(metrics, operation) {
  if (operation === "map") {
    const nearMatched = numberOrZero(metrics.exactMatchedFeatures) + numberOrZero(metrics.nearMatchedFeatures);
    const exactMissed = boundedGap(metrics.referenceFeatures, metrics.exactMatchedFeatures);
    const nearMissed = boundedGap(metrics.referenceFeatures, nearMatched);
    return {
      referenceItems: numberOrZero(metrics.referenceFeatures),
      exactMatchedItems: numberOrZero(metrics.exactMatchedFeatures),
      exactMissedItems: exactMissed,
      exactMissedItemRate: ratio(exactMissed, metrics.referenceFeatures),
      nearMatchedItems: nearMatched,
      nearMissedItems: nearMissed,
      nearMissedItemRate: ratio(nearMissed, metrics.referenceFeatures),
      exactRecall: numberOrZero(metrics.exactRecall),
      nearRecall: numberOrZero(metrics.nearRecall),
    };
  }

  if (operation === "revalidate") {
    const exactMissed = boundedGap(metrics.referenceRows, metrics.exactOutcomeMatches);
    const nearMissed = boundedGap(metrics.referenceRows, metrics.nearOutcomeMatches);
    return {
      referenceItems: numberOrZero(metrics.referenceRows),
      exactMatchedItems: numberOrZero(metrics.exactOutcomeMatches),
      exactMissedItems: exactMissed,
      exactMissedItemRate: ratio(exactMissed, metrics.referenceRows),
      nearMatchedItems: numberOrZero(metrics.nearOutcomeMatches),
      nearMissedItems: nearMissed,
      nearMissedItemRate: ratio(nearMissed, metrics.referenceRows),
      exactOutcomeAccuracy: numberOrZero(metrics.exactOutcomeAccuracy),
      nearOutcomeAccuracy: numberOrZero(metrics.nearOutcomeAccuracy),
    };
  }

  const missedFindings = boundedGap(metrics.referenceFindings, metrics.matchedFindings);
  const nonCleanNoPredictionRows = boundedGap(metrics.nonCleanReferenceRows, metrics.nonCleanAnyPredictionRows);
  return {
    referenceItems: numberOrZero(metrics.referenceFindings),
    matchedItems: numberOrZero(metrics.matchedFindings),
    missedItems: missedFindings,
    missedItemRate: ratio(missedFindings, metrics.referenceFindings),
    recall: numberOrZero(metrics.recall),
    nonCleanReferenceRows: numberOrZero(metrics.nonCleanReferenceRows),
    nonCleanAnyPredictionRows: numberOrZero(metrics.nonCleanAnyPredictionRows),
    nonCleanNoPredictionRows,
    nonCleanNoPredictionRate: ratio(nonCleanNoPredictionRows, metrics.nonCleanReferenceRows),
  };
}

function issueCategorySummary(issueSummary) {
  const categories = new Map();
  for (const [code, count] of Object.entries(issueSummary)) {
    const category = code.includes(".") ? code.slice(0, code.indexOf(".")) : code;
    categories.set(category, (categories.get(category) ?? 0) + count);
  }
  return Object.fromEntries([...categories.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function issueCountByPrefix(issueSummary, prefix) {
  return Object.entries(issueSummary)
    .filter(([code]) => code.startsWith(prefix))
    .reduce((sum, [, count]) => sum + count, 0);
}

function sortedNumericObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, next]) => typeof next === "number" && Number.isFinite(next))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeLabel(value) {
  return typeof value === "string" && value !== "" ? value : "model";
}

function boundedGap(total, covered) {
  return Math.max(0, numberOrZero(total) - numberOrZero(covered));
}

function ratio(numerator, denominator) {
  const divisor = numberOrZero(denominator);
  return divisor === 0 ? 0 : roundMetric(numberOrZero(numerator) / divisor);
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  if (options.score === null) {
    throw new Error("--score is required");
  }

  const scoreReport = await readScoreReport(options.score);
  const triage = buildTriage(scoreReport);
  const json = `${JSON.stringify(triage, null, options.pretty ? 2 : 0)}\n`;
  if (options.out === null) {
    process.stdout.write(json);
    return;
  }

  const outputDirectory = path.dirname(options.out);
  if (outputDirectory !== ".") {
    try {
      await mkdir(outputDirectory, { recursive: true });
    } catch {
      throw new Error("unable to create --out directory");
    }
  }
  try {
    await writeFile(options.out, json);
  } catch {
    throw new Error("unable to write --out file");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
