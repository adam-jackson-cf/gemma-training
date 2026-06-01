#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_TARGETS = {
  review: 500,
  revalidate: 100,
  map: 25,
};

const HELP = `Usage: node scripts/audit-corpus-coverage.mjs [options]

Offline deterministic audit of local Clawpatch corpus coverage.

Options:
  --dataset-root <path>   Dataset root to scan (default: datasets)
  --captures-root <path>  Captures root to scan (default: captures)
  --out <path>            Write JSON report to this file instead of stdout
  --pretty                Pretty-print JSON
  --help                  Show this help

The report uses summary files and JSONL metadata only. It does not emit raw
prompts, assistant messages, raw outputs, accepted outputs, schemas, or errors.
`;

const CONTENT_KEYS = new Set([
  "messages",
  "prompt",
  "schema",
  "rawOutput",
  "acceptedOutput",
  "rejectedOutput",
  "error",
]);

function parseArgs(argv) {
  const options = {
    datasetRoot: "datasets",
    capturesRoot: "captures",
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
    } else if (arg === "--dataset-root") {
      options.datasetRoot = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--captures-root") {
      options.capturesRoot = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = requireValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function resolveFromCwd(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const datasetRoot = resolveFromCwd(options.datasetRoot);
  const capturesRoot = resolveFromCwd(options.capturesRoot);
  const report = await buildReport({ datasetRoot, capturesRoot });
  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);

  if (options.out) {
    const outPath = resolveFromCwd(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${json}\n`, "utf8");
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function buildReport({ datasetRoot, capturesRoot }) {
  const datasetFiles = findFiles(datasetRoot, [".json", ".jsonl"]);
  const captureFiles = findFiles(capturesRoot, [".json", ".jsonl"]);

  const datasetSummaryFiles = datasetFiles.filter((file) => path.basename(file) === "summary.json");
  const captureSummaryFiles = captureFiles.filter((file) => path.basename(file) === "summary.json");
  const datasetJsonlFiles = datasetFiles.filter((file) => file.endsWith(".jsonl"));
  const captureJsonlFiles = captureFiles.filter((file) => file.endsWith(".jsonl"));

  const aggregate = createAggregate();
  const allSplitRows = new Map();

  const datasets = [];
  for (const datasetDir of sorted(unique(datasetFiles.map((file) => nearestDatasetDir(datasetRoot, file))))) {
    const files = datasetJsonlFiles.filter((file) => path.dirname(file) === datasetDir);
    const summaryPath = path.join(datasetDir, "summary.json");
    const datasetReport = {
      name: path.relative(datasetRoot, datasetDir) || path.basename(datasetDir),
      path: datasetDir,
      summary: fs.existsSync(summaryPath) ? readSanitizedJson(summaryPath) : null,
      files: [],
      counts: createAggregate(),
    };

    for (const file of sorted(files)) {
      const split = splitName(file);
      const fileReport = await auditDatasetJsonl(file, split);
      datasetReport.files.push(fileReport);
      mergeAggregate(datasetReport.counts, fileReport.counts);
      for (const row of fileReport.rowsForAggregate) {
        addRow(aggregate, row);
        if (split === "all") {
          allSplitRows.set(uniqueRecordKey(row), row);
        }
      }
      delete fileReport.rowsForAggregate;
    }

    datasets.push(datasetReport);
  }

  const captures = [];
  for (const captureDir of sorted(unique(captureFiles.map((file) => nearestDatasetDir(capturesRoot, file))))) {
    const files = captureJsonlFiles.filter((file) => path.dirname(file) === captureDir);
    const summaryPath = path.join(captureDir, "summary.json");
    const captureReport = {
      name: path.relative(capturesRoot, captureDir) || path.basename(captureDir),
      path: captureDir,
      summary: fs.existsSync(summaryPath) ? readSanitizedJson(summaryPath) : null,
      files: [],
      counts: createCaptureAggregate(),
    };

    for (const file of sorted(files)) {
      const fileReport = await auditCaptureJsonl(file);
      captureReport.files.push(fileReport);
      mergeCaptureAggregate(captureReport.counts, fileReport.counts);
    }

    captures.push(captureReport);
  }

  const deduplicatedAll = createAggregate();
  for (const row of allSplitRows.values()) {
    addRow(deduplicatedAll, row);
  }

  return {
    schemaVersion: 1,
    roots: {
      datasetRoot,
      capturesRoot,
    },
    targetMinimums: DEFAULT_TARGETS,
    gaps: buildGaps(deduplicatedAll.byOperation, DEFAULT_TARGETS),
    deduplicatedCorpus: {
      basis: "Unique operation/captureId records from dataset all.jsonl files.",
      counts: finalizeAggregate(deduplicatedAll),
    },
    aggregateDatasetRows: {
      basis: "Every local dataset JSONL row, including derivative datasets and split files.",
      counts: finalizeAggregate(aggregate),
    },
    datasets: datasets.map(finalizeDatasetReport),
    captures: captures.map(finalizeCaptureReport),
    scannedFiles: {
      datasetSummaries: sorted(datasetSummaryFiles),
      datasetJsonl: sorted(datasetJsonlFiles),
      captureSummaries: sorted(captureSummaryFiles),
      captureJsonl: sorted(captureJsonlFiles),
    },
    privacy: {
      emittedContentFields: [],
      excludedContentFields: sorted([...CONTENT_KEYS]),
    },
  };
}

function findFiles(root, extensions) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }
  return sorted(results);
}

function nearestDatasetDir(root, file) {
  const relative = path.relative(root, path.dirname(file));
  const [first] = relative.split(path.sep);
  return first ? path.join(root, first) : root;
}

function splitName(file) {
  return path.basename(file, ".jsonl");
}

async function auditDatasetJsonl(file, split) {
  const counts = createAggregate();
  const rowsForAggregate = [];
  let invalidRows = 0;
  let lineNumber = 0;

  for await (const record of readJsonl(file)) {
    lineNumber = record.lineNumber;
    if (!record.ok) {
      invalidRows += 1;
      continue;
    }

    const metadata = record.value?.metadata && typeof record.value.metadata === "object" ? record.value.metadata : {};
    const row = datasetMetadataRow(metadata, split);
    addRow(counts, row);
    rowsForAggregate.push(row);
  }

  return {
    path: file,
    split,
    lines: lineNumber,
    invalidRows,
    counts: finalizeAggregate(counts),
    rowsForAggregate,
  };
}

async function auditCaptureJsonl(file) {
  const counts = createCaptureAggregate();
  let invalidRows = 0;
  let lineNumber = 0;

  for await (const record of readJsonl(file)) {
    lineNumber = record.lineNumber;
    if (!record.ok) {
      invalidRows += 1;
      continue;
    }
    addCaptureRow(counts, captureMetadataRow(record.value));
  }

  return {
    path: file,
    lines: lineNumber,
    invalidRows,
    counts: finalizeCaptureAggregate(counts),
  };
}

async function* readJsonl(file) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    try {
      yield { ok: true, lineNumber, value: JSON.parse(line) };
    } catch (error) {
      yield { ok: false, lineNumber, error: error.message };
    }
  }
}

function datasetMetadataRow(metadata, split) {
  const operation = safeLabel(metadata.operation);
  const repo = safeRepoLabel(metadata.repo);
  const findingCount = Number.isFinite(metadata.findingCount) ? metadata.findingCount : null;
  const redacted = metadata.redacted === true;
  const metadataOnly = metadata.metadataOnly === true;

  return {
    id: safeLabel(metadata.captureId),
    operation,
    split,
    repo,
    findingCount,
    redacted,
    metadataOnly,
  };
}

function captureMetadataRow(row) {
  const repo = row?.repo && typeof row.repo === "object" ? row.repo.projectName : null;
  return {
    id: safeLabel(row?.captureId),
    operation: safeLabel(row?.operation),
    repo: safeLabel(repo),
    status: safeLabel(row?.status),
    validationStatus: safeLabel(row?.validationStatus),
    redacted: row?.redactionState?.redacted === true,
    metadataOnly: row?.redactionState?.metadataOnly === true,
  };
}

function createAggregate() {
  return {
    total: 0,
    byOperation: {},
    bySplit: {},
    byRepo: {},
    byOperationSplitRepo: {},
    reviewQuality: {
      clean: 0,
      nonEmpty: 0,
      unknown: 0,
    },
    redacted: 0,
    metadataOnly: 0,
  };
}

function addRow(counts, row) {
  counts.total += 1;
  increment(counts.byOperation, row.operation);
  increment(counts.bySplit, row.split);
  increment(counts.byRepo, row.repo);
  incrementNested(counts.byOperationSplitRepo, [row.operation, row.split, row.repo]);
  if (row.redacted) counts.redacted += 1;
  if (row.metadataOnly) counts.metadataOnly += 1;
  if (row.operation === "review") {
    if (row.findingCount === 0) {
      counts.reviewQuality.clean += 1;
    } else if (Number.isInteger(row.findingCount) && row.findingCount > 0) {
      counts.reviewQuality.nonEmpty += 1;
    } else {
      counts.reviewQuality.unknown += 1;
    }
  }
}

function mergeAggregate(target, source) {
  const finalized = source.total === undefined ? source : finalizeAggregate(source);
  target.total += finalized.total;
  mergeCounts(target.byOperation, finalized.byOperation);
  mergeCounts(target.bySplit, finalized.bySplit);
  mergeCounts(target.byRepo, finalized.byRepo);
  mergeNestedCounts(target.byOperationSplitRepo, finalized.byOperationSplitRepo);
  target.reviewQuality.clean += finalized.reviewQuality.clean;
  target.reviewQuality.nonEmpty += finalized.reviewQuality.nonEmpty;
  target.reviewQuality.unknown += finalized.reviewQuality.unknown;
  target.redacted += finalized.redacted;
  target.metadataOnly += finalized.metadataOnly;
}

function finalizeAggregate(counts) {
  return {
    total: counts.total,
    byOperation: sortObject(counts.byOperation),
    bySplit: sortObject(counts.bySplit),
    byRepo: sortObject(counts.byRepo),
    byOperationSplitRepo: sortNestedObject(counts.byOperationSplitRepo),
    reviewQuality: { ...counts.reviewQuality },
    redacted: counts.redacted,
    metadataOnly: counts.metadataOnly,
  };
}

function createCaptureAggregate() {
  return {
    total: 0,
    byOperation: {},
    byRepo: {},
    byStatus: {},
    byValidationStatus: {},
    redacted: 0,
    metadataOnly: 0,
  };
}

function addCaptureRow(counts, row) {
  counts.total += 1;
  increment(counts.byOperation, row.operation);
  increment(counts.byRepo, row.repo);
  increment(counts.byStatus, row.status);
  increment(counts.byValidationStatus, row.validationStatus);
  if (row.redacted) counts.redacted += 1;
  if (row.metadataOnly) counts.metadataOnly += 1;
}

function mergeCaptureAggregate(target, source) {
  const finalized = source.total === undefined ? source : finalizeCaptureAggregate(source);
  target.total += finalized.total;
  mergeCounts(target.byOperation, finalized.byOperation);
  mergeCounts(target.byRepo, finalized.byRepo);
  mergeCounts(target.byStatus, finalized.byStatus);
  mergeCounts(target.byValidationStatus, finalized.byValidationStatus);
  target.redacted += finalized.redacted;
  target.metadataOnly += finalized.metadataOnly;
}

function finalizeCaptureAggregate(counts) {
  return {
    total: counts.total,
    byOperation: sortObject(counts.byOperation),
    byRepo: sortObject(counts.byRepo),
    byStatus: sortObject(counts.byStatus),
    byValidationStatus: sortObject(counts.byValidationStatus),
    redacted: counts.redacted,
    metadataOnly: counts.metadataOnly,
  };
}

function buildGaps(byOperation, targets) {
  const result = {};
  for (const operation of sorted(Object.keys(targets))) {
    const current = byOperation[operation] || 0;
    result[operation] = {
      current,
      target: targets[operation],
      gap: Math.max(0, targets[operation] - current),
      met: current >= targets[operation],
    };
  }
  return result;
}

function finalizeDatasetReport(report) {
  return {
    ...report,
    counts: finalizeAggregate(report.counts),
  };
}

function finalizeCaptureReport(report) {
  return {
    ...report,
    counts: finalizeCaptureAggregate(report.counts),
  };
}

function readSanitizedJson(file) {
  return sanitizeJson(JSON.parse(fs.readFileSync(file, "utf8")));
}

function sanitizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (CONTENT_KEYS.has(key)) {
      continue;
    }
    result[key] = sanitizeJson(child);
  }
  return result;
}

function safeRepoLabel(value) {
  if (value && typeof value === "object") {
    return safeLabel(value.projectName || value.name);
  }
  return safeLabel(value);
}

function safeLabel(value) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "unknown";
}

function uniqueRecordKey(row) {
  return `${row.operation}\u0000${row.id}\u0000${row.repo}`;
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function incrementNested(target, keys) {
  let current = target;
  for (const key of keys.slice(0, -1)) {
    current[key] ||= {};
    current = current[key];
  }
  increment(current, keys.at(-1));
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

function mergeNestedCounts(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ||= {};
      mergeNestedCounts(target[key], value);
    } else {
      target[key] = (target[key] || 0) + value;
    }
  }
}

function sortObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function sortNestedObject(input) {
  const result = {};
  for (const [key, value] of Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) {
    result[key] = value && typeof value === "object" && !Array.isArray(value) ? sortNestedObject(value) : value;
  }
  return result;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function unique(values) {
  return [...new Set(values)];
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
