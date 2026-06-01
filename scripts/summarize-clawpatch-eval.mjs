#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_THRESHOLDS = {
  f1: 0.8,
  cleanAccuracy: 0.95,
  schemaValidRate: 1,
  evidenceValidRate: 1,
};

const usage = `Usage:
  node scripts/summarize-clawpatch-eval.mjs --score <score.json> [--score <score.json> ...] [--threshold-f1 <number>] [--threshold-clean-accuracy <number>] [--threshold-schema-valid-rate <number>] [--threshold-evidence-valid-rate <number>] [--out <summary.json>] [--pretty]

Options:
  --score                         Score report from scripts/evaluate-clawpatch-predictions.mjs. Repeat for multiple reports.
  --threshold-f1                  Minimum finding F1 required per model. Default: ${DEFAULT_THRESHOLDS.f1}
  --threshold-clean-accuracy      Minimum clean-feature accuracy required per model. Default: ${DEFAULT_THRESHOLDS.cleanAccuracy}
  --threshold-schema-valid-rate   Minimum schema-valid row rate required per model. Default: ${DEFAULT_THRESHOLDS.schemaValidRate}
  --threshold-evidence-valid-rate Minimum evidence-valid row rate required per model. Default: ${DEFAULT_THRESHOLDS.evidenceValidRate}
  --out, -o                       Write the JSON summary to this path instead of stdout.
  --pretty                        Pretty-print JSON with two-space indentation.
  --help, -h                      Show this help.

The summary only reports aggregate counts, rates, metrics, and threshold results.
It does not print private prompts, raw predictions, row identifiers, or prediction paths.
`;

function parseArgs(argv) {
  const options = {
    scores: [],
    thresholds: { ...DEFAULT_THRESHOLDS },
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
      options.scores.push(requiredValue(argv, (index += 1), arg));
    } else if (arg.startsWith("--score=")) {
      options.scores.push(arg.slice("--score=".length));
    } else if (arg === "--threshold-f1") {
      options.thresholds.f1 = parseThreshold(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg.startsWith("--threshold-f1=")) {
      options.thresholds.f1 = parseThreshold(arg.slice("--threshold-f1=".length), "--threshold-f1");
    } else if (arg === "--threshold-clean-accuracy") {
      options.thresholds.cleanAccuracy = parseThreshold(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg.startsWith("--threshold-clean-accuracy=")) {
      options.thresholds.cleanAccuracy = parseThreshold(
        arg.slice("--threshold-clean-accuracy=".length),
        "--threshold-clean-accuracy",
      );
    } else if (arg === "--threshold-schema-valid-rate") {
      options.thresholds.schemaValidRate = parseThreshold(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg.startsWith("--threshold-schema-valid-rate=")) {
      options.thresholds.schemaValidRate = parseThreshold(
        arg.slice("--threshold-schema-valid-rate=".length),
        "--threshold-schema-valid-rate",
      );
    } else if (arg === "--threshold-evidence-valid-rate") {
      options.thresholds.evidenceValidRate = parseThreshold(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg.startsWith("--threshold-evidence-valid-rate=")) {
      options.thresholds.evidenceValidRate = parseThreshold(
        arg.slice("--threshold-evidence-valid-rate=".length),
        "--threshold-evidence-valid-rate",
      );
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

function parseThreshold(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be a number from 0 to 1`);
  }
  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function asOptionalNumber(value, field) {
  if (value === null || value === undefined) {
    return null;
  }
  return asNumber(value, field);
}

function asNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function ratio(numerator, denominator) {
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function thresholdResult(metric, actual, threshold) {
  return {
    metric,
    actual,
    threshold,
    passed: actual !== null && actual >= threshold,
  };
}

function summarizeLatency(latency, field) {
  if (!isPlainObject(latency)) {
    throw new Error(`${field} must be an object`);
  }
  return {
    presentRows: asNonNegativeInteger(latency.presentRows, `${field}.presentRows`),
    validRows: asNonNegativeInteger(latency.validRows, `${field}.validRows`),
    invalidRows: asNonNegativeInteger(latency.invalidRows, `${field}.invalidRows`),
    sum: asNumber(latency.sum, `${field}.sum`),
    avg: asOptionalNumber(latency.avg, `${field}.avg`),
    min: asOptionalNumber(latency.min, `${field}.min`),
    max: asOptionalNumber(latency.max, `${field}.max`),
  };
}

function summarizeModel(model, thresholds, modelIndex, reportField) {
  if (!isPlainObject(model)) {
    throw new Error(`${reportField}.models[${modelIndex}] must be an object`);
  }
  if (typeof model.label !== "string" || model.label.length === 0) {
    throw new Error(`${reportField}.models[${modelIndex}].label must be a non-empty string`);
  }
  const metrics = model.metrics;
  if (!isPlainObject(metrics)) {
    throw new Error(`${reportField}.models[${modelIndex}].metrics must be an object`);
  }

  const referenceRows = asNonNegativeInteger(metrics.referenceRows, `${reportField}.models[${modelIndex}].metrics.referenceRows`);
  const predictionRows = asNonNegativeInteger(metrics.predictionRows, `${reportField}.models[${modelIndex}].metrics.predictionRows`);
  const extraPredictionRows = asNonNegativeInteger(
    metrics.extraPredictionRows,
    `${reportField}.models[${modelIndex}].metrics.extraPredictionRows`,
  );
  const missingPredictionRows = asNonNegativeInteger(
    metrics.missingPredictionRows,
    `${reportField}.models[${modelIndex}].metrics.missingPredictionRows`,
  );
  const jsonLineErrors = asNonNegativeInteger(
    metrics.jsonLineErrors,
    `${reportField}.models[${modelIndex}].metrics.jsonLineErrors`,
  );
  const outputParseableRows = asNonNegativeInteger(
    metrics.outputParseableRows,
    `${reportField}.models[${modelIndex}].metrics.outputParseableRows`,
  );
  const schemaValidRows = asNonNegativeInteger(
    metrics.schemaValidRows,
    `${reportField}.models[${modelIndex}].metrics.schemaValidRows`,
  );
  const evidenceValidRows = asNonNegativeInteger(
    metrics.evidenceValidRows,
    `${reportField}.models[${modelIndex}].metrics.evidenceValidRows`,
  );
  const cleanReferenceRows = asNonNegativeInteger(
    metrics.cleanReferenceRows,
    `${reportField}.models[${modelIndex}].metrics.cleanReferenceRows`,
  );
  const cleanCorrectRows = asNonNegativeInteger(
    metrics.cleanCorrectRows,
    `${reportField}.models[${modelIndex}].metrics.cleanCorrectRows`,
  );
  const referenceFindings = asNonNegativeInteger(
    metrics.referenceFindings,
    `${reportField}.models[${modelIndex}].metrics.referenceFindings`,
  );
  const predictedFindings = asNonNegativeInteger(
    metrics.predictedFindings,
    `${reportField}.models[${modelIndex}].metrics.predictedFindings`,
  );
  const matchedFindings = asNonNegativeInteger(
    metrics.matchedFindings,
    `${reportField}.models[${modelIndex}].metrics.matchedFindings`,
  );

  const parseValidRate = ratio(outputParseableRows, referenceRows);
  const schemaValidRate = ratio(schemaValidRows, referenceRows);
  const evidenceValidRate = ratio(evidenceValidRows, referenceRows);
  const precision = asOptionalNumber(metrics.precision, `${reportField}.models[${modelIndex}].metrics.precision`);
  const recall = asOptionalNumber(metrics.recall, `${reportField}.models[${modelIndex}].metrics.recall`);
  const f1 = asOptionalNumber(metrics.f1, `${reportField}.models[${modelIndex}].metrics.f1`);
  const cleanAccuracy = asOptionalNumber(
    metrics.cleanAccuracy,
    `${reportField}.models[${modelIndex}].metrics.cleanAccuracy`,
  );

  const thresholdResults = [
    thresholdResult("f1", f1, thresholds.f1),
    thresholdResult("cleanAccuracy", cleanAccuracy, thresholds.cleanAccuracy),
    thresholdResult("schemaValidRate", schemaValidRate, thresholds.schemaValidRate),
    thresholdResult("evidenceValidRate", evidenceValidRate, thresholds.evidenceValidRate),
  ];

  return {
    label: model.label,
    rows: {
      reference: referenceRows,
      prediction: predictionRows,
      extraPrediction: extraPredictionRows,
      missingPrediction: missingPredictionRows,
      jsonLineErrors,
    },
    validity: {
      parse: {
        validRows: outputParseableRows,
        rate: parseValidRate,
      },
      schema: {
        validRows: schemaValidRows,
        rate: schemaValidRate,
      },
      evidence: {
        validRows: evidenceValidRows,
        rate: evidenceValidRate,
      },
    },
    findings: {
      reference: referenceFindings,
      predicted: predictedFindings,
      matched: matchedFindings,
    },
    metrics: {
      precision,
      recall,
      f1,
      cleanAccuracy,
      cleanReferenceRows,
      cleanCorrectRows,
    },
    latency: summarizeLatency(metrics.latency, `${reportField}.models[${modelIndex}].metrics.latency`),
    thresholds: Object.fromEntries(thresholdResults.map((result) => [result.metric, result])),
    passed: thresholdResults.every((result) => result.passed),
  };
}

function summarizeScoreReport(score, thresholds, reportIndex) {
  const reportField = `scoreReports[${reportIndex}]`;
  if (!isPlainObject(score)) {
    throw new Error(`${reportField} must be a JSON object`);
  }
  if (score.deterministic !== true) {
    throw new Error(`${reportField}.deterministic must be true`);
  }
  if (typeof score.operation !== "string" || score.operation.length === 0) {
    throw new Error(`${reportField}.operation must be a non-empty string`);
  }
  if (!Array.isArray(score.models) || score.models.length === 0) {
    throw new Error(`${reportField}.models must contain at least one model`);
  }

  const reference = isPlainObject(score.reference) ? score.reference : {};
  const models = score.models.map((model, modelIndex) => summarizeModel(model, thresholds, modelIndex, reportField));

  return {
    reportIndex,
    operation: score.operation,
    rows: {
      reference: asNonNegativeInteger(reference.rows, `${reportField}.reference.rows`),
      referenceJsonLineErrors: asNonNegativeInteger(
        reference.jsonLineErrors,
        `${reportField}.reference.jsonLineErrors`,
      ),
      referenceOutputParseable: asNonNegativeInteger(
        reference.outputParseableRows,
        `${reportField}.reference.outputParseableRows`,
      ),
      referenceSchemaValid: asNonNegativeInteger(reference.schemaValidRows, `${reportField}.reference.schemaValidRows`),
      cleanReference: asNonNegativeInteger(reference.cleanRows, `${reportField}.reference.cleanRows`),
      findingReference: asNonNegativeInteger(reference.findingRows, `${reportField}.reference.findingRows`),
    },
    models,
    passed: models.every((model) => model.passed),
  };
}

async function readScoreReport(scorePath) {
  const source = await readFile(scorePath, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${scorePath} is not valid JSON: ${message}`);
  }
}

async function writeOutput(outPath, text) {
  if (outPath === null) {
    process.stdout.write(text);
    return;
  }
  const directory = path.dirname(outPath);
  if (directory !== ".") {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(outPath, text, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (options.scores.length === 0) {
    throw new Error("at least one --score path is required");
  }

  const reports = [];
  for (let index = 0; index < options.scores.length; index += 1) {
    const scorePath = options.scores[index];
    const score = await readScoreReport(scorePath);
    reports.push(summarizeScoreReport(score, options.thresholds, index));
  }

  const summary = {
    schemaVersion: 1,
    deterministic: true,
    thresholds: options.thresholds,
    reports,
    passed: reports.every((report) => report.passed),
  };
  const body = `${JSON.stringify(summary, null, options.pretty ? 2 : 0)}\n`;
  await writeOutput(options.out, body);
  return summary.passed ? 0 : 1;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 2;
  });
