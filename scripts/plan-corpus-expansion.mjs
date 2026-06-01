#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_COVERAGE_PATH = "reports/clawpatch-corpus-coverage.json";
const DEFAULT_DATASET_ROOT = "datasets";
const DEFAULT_CAPTURES_ROOT = "captures";
const DEFAULT_TARGETS = {
  review: 500,
  revalidate: 100,
  map: 25,
};

const PLANNING_ASSUMPTIONS = {
  acceptedReviewCapturesPerReviewHeavyRepository: 43,
  usefulRevalidateCapturesPerReviewHeavyRepository: 16,
  mapCapturesPerNewRepository: 1,
};

const OPERATION_ORDER = ["review", "revalidate", "map"];
const HELP = `Usage: node scripts/plan-corpus-expansion.mjs [options]

Plan a bounded Phase 2 Clawpatch corpus expansion batch.

Options:
  --coverage <path>  Coverage report to read (default: reports/clawpatch-corpus-coverage.json)
  --out <path>       Write JSON plan to this file instead of stdout
  --pretty           Pretty-print JSON
  --help             Show this help

If the coverage report is absent, the planner derives sanitized counts from
local datasets/ and captures/ metadata. It does not emit private prompts,
assistant content, raw captures, raw outputs, schemas, or record identifiers.
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const coveragePath = resolveFromCwd(options.coverage);
  const coverage = fs.existsSync(coveragePath)
    ? readCoverageReport(coveragePath)
    : await deriveCoverageFromLocalMetadata({
        datasetRoot: resolveFromCwd(DEFAULT_DATASET_ROOT),
        capturesRoot: resolveFromCwd(DEFAULT_CAPTURES_ROOT),
      });

  const plan = buildPlan({ coverage, coveragePath });
  const json = JSON.stringify(plan, null, options.pretty ? 2 : 0);

  if (options.out) {
    const outPath = resolveFromCwd(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${json}\n`, "utf8");
  } else {
    process.stdout.write(`${json}\n`);
  }
}

function parseArgs(argv) {
  const options = {
    coverage: DEFAULT_COVERAGE_PATH,
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
    } else if (arg === "--coverage") {
      options.coverage = requireValue(argv, index, arg);
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

function readCoverageReport(coveragePath) {
  const report = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  const counts = report?.deduplicatedCorpus?.counts || {};
  return {
    source: "coverage-report",
    sourcePaths: {
      coverage: coveragePath,
    },
    targets: normalizeTargets(report.targetMinimums),
    counts: normalizeCounts(counts),
  };
}

async function deriveCoverageFromLocalMetadata({ datasetRoot, capturesRoot }) {
  const datasetCounts = createDatasetCounts();
  const allRows = new Map();
  const datasetFiles = findFiles(datasetRoot, [".jsonl"]);

  for (const file of datasetFiles.filter((candidate) => path.basename(candidate) === "all.jsonl")) {
    for await (const record of readJsonl(file)) {
      if (!record.ok) continue;
      const metadata = record.value?.metadata && typeof record.value.metadata === "object" ? record.value.metadata : {};
      const row = datasetMetadataRow(metadata);
      allRows.set(uniqueInternalRowKey(row), row);
    }
  }

  for (const row of allRows.values()) {
    addDatasetRow(datasetCounts, row);
  }

  const captureCounts = createCaptureCounts();
  const captureFiles = findFiles(capturesRoot, [".jsonl"]);
  for (const file of captureFiles) {
    for await (const record of readJsonl(file)) {
      if (!record.ok) continue;
      addCaptureRow(captureCounts, captureMetadataRow(record.value));
    }
  }

  return {
    source: "local-metadata-scan",
    sourcePaths: {
      coverage: null,
      datasets: datasetRoot,
      captures: capturesRoot,
    },
    targets: normalizeTargets(DEFAULT_TARGETS),
    counts: normalizeCounts({
      ...finalizeDatasetCounts(datasetCounts),
      captureRows: finalizeCaptureCounts(captureCounts),
    }),
  };
}

function buildPlan({ coverage, coveragePath }) {
  const currentCounts = coverage.counts;
  const targets = coverage.targets;
  const gaps = buildGaps(currentCounts.byOperation, targets);
  const findingBacklogExists = currentCounts.reviewQuality.nonEmpty > 0;
  const prioritizedOperations = buildPrioritizedOperations({ gaps, currentCounts, findingBacklogExists });
  const recommendation = recommendMinimumNewRepositories({
    gaps,
    currentRepositoryCount: currentCounts.repositories.known,
    findingBacklogExists,
  });
  const nextCaptureBatchShape = buildNextCaptureBatchShape({
    gaps,
    recommendedMinimumNewRepositoryCount: recommendation.count,
    findingBacklogExists,
  });

  return sortNestedObject({
    schemaVersion: 1,
    planner: {
      name: "bounded-phase-2-corpus-expansion",
      coverageSource: coverage.source,
      sourcePaths: sortNestedObject(coverage.sourcePaths),
      deterministic: true,
    },
    privacy: {
      emittedValues: ["counts", "paths"],
      omittedValues: [
        "assistant content",
        "private prompts",
        "raw captures",
        "raw outputs",
        "record identifiers",
        "schemas",
      ],
    },
    currentCounts,
    targets,
    gaps,
    prioritizedOperations,
    recommendedMinimumNewRepositoryCount: recommendation,
    nextCaptureBatchShape,
    notes: [
      `The planner reads ${coverage.source === "coverage-report" ? coveragePath : "local metadata"} and emits no raw capture content.`,
      "Review remains first because it is the primary model-quality target; revalidate depends on review findings; map closes repository inventory coverage.",
    ],
  });
}

function normalizeTargets(input) {
  const targets = {};
  for (const operation of OPERATION_ORDER) {
    targets[operation] = nonNegativeInteger(input?.[operation], DEFAULT_TARGETS[operation]);
  }
  return targets;
}

function normalizeCounts(input) {
  const byOperation = normalizeOperationCounts(input.byOperation);
  const bySplit = sortObject(numberObject(input.bySplit || {}));
  const repositoryCounts = repositorySummary(input.byRepo || {});
  return {
    total: nonNegativeInteger(input.total, sumObject(byOperation)),
    byOperation,
    bySplit,
    repositories: repositoryCounts,
    reviewQuality: {
      clean: nonNegativeInteger(input.reviewQuality?.clean, 0),
      nonEmpty: nonNegativeInteger(input.reviewQuality?.nonEmpty, 0),
      unknown: nonNegativeInteger(input.reviewQuality?.unknown, 0),
    },
    redacted: nonNegativeInteger(input.redacted, 0),
    metadataOnly: nonNegativeInteger(input.metadataOnly, 0),
  };
}

function normalizeOperationCounts(input) {
  const result = {};
  for (const operation of OPERATION_ORDER) {
    result[operation] = nonNegativeInteger(input?.[operation], 0);
  }
  return result;
}

function repositorySummary(byRepo) {
  let known = 0;
  let unknownRows = 0;
  let rows = 0;

  for (const [repo, count] of Object.entries(byRepo)) {
    const numericCount = nonNegativeInteger(count, 0);
    rows += numericCount;
    if (repo === "unknown") {
      unknownRows += numericCount;
    } else {
      known += 1;
    }
  }

  return {
    known,
    unknownRows,
    rows,
  };
}

function buildGaps(byOperation, targets) {
  const result = {};
  for (const operation of OPERATION_ORDER) {
    const current = byOperation[operation] || 0;
    const target = targets[operation];
    result[operation] = {
      current,
      target,
      gap: Math.max(0, target - current),
      met: current >= target,
    };
  }
  return result;
}

function buildPrioritizedOperations({ gaps, currentCounts, findingBacklogExists }) {
  const rows = [
    {
      operation: "review",
      priority: 1,
      current: gaps.review.current,
      target: gaps.review.target,
      gap: gaps.review.gap,
      reason: "Primary model-quality target and largest accepted-example shortfall.",
    },
    {
      operation: "revalidate",
      priority: 2,
      current: gaps.revalidate.current,
      target: gaps.revalidate.target,
      gap: gaps.revalidate.gap,
      reason: findingBacklogExists
        ? "Second-stage target can use existing non-empty review findings plus new review findings."
        : "Second-stage target is blocked until review findings exist.",
    },
    {
      operation: "map",
      priority: 3,
      current: gaps.map.current,
      target: gaps.map.target,
      gap: gaps.map.gap,
      reason: `Repository inventory coverage should expand beyond the current ${currentCounts.repositories.known} known repositories.`,
    },
  ];

  return rows.map((row) => ({
    ...row,
    blocked: row.operation === "revalidate" && !findingBacklogExists,
  }));
}

function recommendMinimumNewRepositories({ gaps, currentRepositoryCount, findingBacklogExists }) {
  const reviewHeavyRepositories = ceilDivide(
    gaps.review.gap,
    PLANNING_ASSUMPTIONS.acceptedReviewCapturesPerReviewHeavyRepository,
  );
  const revalidateHeavyRepositories = findingBacklogExists
    ? ceilDivide(gaps.revalidate.gap, PLANNING_ASSUMPTIONS.usefulRevalidateCapturesPerReviewHeavyRepository)
    : 0;
  const mapRepositories = ceilDivide(gaps.map.gap, PLANNING_ASSUMPTIONS.mapCapturesPerNewRepository);
  const diversityRepositories = Math.max(0, 5 - currentRepositoryCount);
  const count = Math.max(reviewHeavyRepositories, revalidateHeavyRepositories, mapRepositories, diversityRepositories);

  return {
    count,
    basis: "Minimum new repositories needed under bounded per-repository capture assumptions.",
    components: {
      reviewHeavyRepositories,
      revalidateHeavyRepositories,
      mapRepositories,
      diversityRepositories,
    },
    assumptions: { ...PLANNING_ASSUMPTIONS },
  };
}

function buildNextCaptureBatchShape({ gaps, recommendedMinimumNewRepositoryCount, findingBacklogExists }) {
  const reviewHeavyRepositories = Math.min(
    recommendedMinimumNewRepositoryCount,
    Math.max(
      ceilDivide(gaps.review.gap, PLANNING_ASSUMPTIONS.acceptedReviewCapturesPerReviewHeavyRepository),
      findingBacklogExists
        ? ceilDivide(gaps.revalidate.gap, PLANNING_ASSUMPTIONS.usefulRevalidateCapturesPerReviewHeavyRepository)
        : 0,
    ),
  );
  const mapOnlyRepositories = Math.max(0, recommendedMinimumNewRepositoryCount - reviewHeavyRepositories);
  const reviewTarget = Math.min(
    gaps.review.gap,
    reviewHeavyRepositories * PLANNING_ASSUMPTIONS.acceptedReviewCapturesPerReviewHeavyRepository,
  );
  const revalidateTarget = findingBacklogExists
    ? Math.min(
        gaps.revalidate.gap,
        reviewHeavyRepositories * PLANNING_ASSUMPTIONS.usefulRevalidateCapturesPerReviewHeavyRepository,
      )
    : 0;
  const mapTarget = Math.min(
    gaps.map.gap,
    recommendedMinimumNewRepositoryCount * PLANNING_ASSUMPTIONS.mapCapturesPerNewRepository,
  );

  return {
    repositoryCount: recommendedMinimumNewRepositoryCount,
    layout: {
      reviewHeavyRepositories,
      mapOnlyRepositories,
    },
    operationTargets: {
      review: reviewTarget,
      revalidate: revalidateTarget,
      map: mapTarget,
    },
    perRepositoryShape: {
      reviewHeavy: {
        repositoryCount: reviewHeavyRepositories,
        mapCapturesPerRepository: PLANNING_ASSUMPTIONS.mapCapturesPerNewRepository,
        acceptedReviewCapturesPerRepository: distributeEvenly(reviewTarget, reviewHeavyRepositories),
        usefulRevalidateCapturesPerRepository: distributeEvenly(revalidateTarget, reviewHeavyRepositories),
        needs: ["map", "review", "revalidate"],
      },
      mapOnly: {
        repositoryCount: mapOnlyRepositories,
        mapCapturesPerRepository: PLANNING_ASSUMPTIONS.mapCapturesPerNewRepository,
        needs: ["map"],
      },
    },
    revalidatePrerequisite:
      "Revalidate requires findings to exist before useful revalidation captures can be generated.",
    expectedRemainingGapsAfterBatch: {
      review: Math.max(0, gaps.review.gap - reviewTarget),
      revalidate: Math.max(0, gaps.revalidate.gap - revalidateTarget),
      map: Math.max(0, gaps.map.gap - mapTarget),
    },
  };
}

function distributeEvenly(total, buckets) {
  if (buckets <= 0) {
    return {
      min: 0,
      max: 0,
    };
  }
  const min = Math.floor(total / buckets);
  const remainder = total % buckets;
  return {
    min,
    max: min + (remainder > 0 ? 1 : 0),
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

async function* readJsonl(file) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield { ok: true, value: JSON.parse(line) };
    } catch {
      yield { ok: false };
    }
  }
}

function datasetMetadataRow(metadata) {
  return {
    internalId: safeLabel(metadata.captureId),
    operation: safeOperation(metadata.operation),
    repo: safeRepoLabel(metadata.repo),
    findingCount: Number.isInteger(metadata.findingCount) ? metadata.findingCount : null,
    redacted: metadata.redacted === true,
    metadataOnly: metadata.metadataOnly === true,
  };
}

function captureMetadataRow(row) {
  const repo = row?.repo && typeof row.repo === "object" ? row.repo.projectName : null;
  return {
    operation: safeOperation(row?.operation),
    repo: safeRepoLabel(repo),
    status: safeLabel(row?.status),
    redacted: row?.redactionState?.redacted === true,
    metadataOnly: row?.redactionState?.metadataOnly === true,
  };
}

function createDatasetCounts() {
  return {
    total: 0,
    byOperation: {},
    byRepo: {},
    reviewQuality: {
      clean: 0,
      nonEmpty: 0,
      unknown: 0,
    },
    redacted: 0,
    metadataOnly: 0,
  };
}

function createCaptureCounts() {
  return {
    total: 0,
    byOperation: {},
    byRepo: {},
    byStatus: {},
    redacted: 0,
    metadataOnly: 0,
  };
}

function addDatasetRow(counts, row) {
  counts.total += 1;
  increment(counts.byOperation, row.operation);
  increment(counts.byRepo, row.repo);
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

function addCaptureRow(counts, row) {
  counts.total += 1;
  increment(counts.byOperation, row.operation);
  increment(counts.byRepo, row.repo);
  increment(counts.byStatus, row.status);
  if (row.redacted) counts.redacted += 1;
  if (row.metadataOnly) counts.metadataOnly += 1;
}

function finalizeDatasetCounts(counts) {
  return {
    total: counts.total,
    byOperation: sortObject(counts.byOperation),
    byRepo: sortObject(counts.byRepo),
    reviewQuality: { ...counts.reviewQuality },
    redacted: counts.redacted,
    metadataOnly: counts.metadataOnly,
  };
}

function finalizeCaptureCounts(counts) {
  return {
    total: counts.total,
    byOperation: sortObject(counts.byOperation),
    byRepo: sortObject(counts.byRepo),
    byStatus: sortObject(counts.byStatus),
    redacted: counts.redacted,
    metadataOnly: counts.metadataOnly,
  };
}

function safeOperation(value) {
  return OPERATION_ORDER.includes(value) ? value : "unknown";
}

function safeRepoLabel(value) {
  if (value && typeof value === "object") {
    return safeLabel(value.projectName || value.name);
  }
  return safeLabel(value);
}

function safeLabel(value) {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function uniqueInternalRowKey(row) {
  return `${row.operation}\u0000${row.internalId}\u0000${row.repo}`;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function ceilDivide(numerator, denominator) {
  if (numerator <= 0 || denominator <= 0) {
    return 0;
  }
  return Math.ceil(numerator / denominator);
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function numberObject(input) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = nonNegativeInteger(value, 0);
  }
  return result;
}

function sumObject(input) {
  return Object.values(input).reduce((total, value) => total + value, 0);
}

function sortObject(input) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function sortNestedObject(input) {
  if (Array.isArray(input)) {
    return input.map((value) => (value && typeof value === "object" ? sortNestedObject(value) : value));
  }
  if (!input || typeof input !== "object") {
    return input;
  }

  const result = {};
  for (const [key, value] of Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) {
    result[key] = value && typeof value === "object" ? sortNestedObject(value) : value;
  }
  return result;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
