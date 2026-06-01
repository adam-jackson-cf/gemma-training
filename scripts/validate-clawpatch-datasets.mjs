#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const DATASETS = [
  {
    name: "clawpatch-gemma-v0",
    path: "datasets/clawpatch-gemma-v0",
    allowedOperations: new Set(["map", "revalidate", "review"]),
  },
  {
    name: "clawpatch-gemma-windowed-v0",
    path: "datasets/clawpatch-gemma-windowed-v0",
    allowedOperations: new Set(["map", "revalidate", "review"]),
  },
  {
    name: "clawpatch-gemma-map-v0",
    path: "datasets/clawpatch-gemma-map-v0",
    allowedOperations: new Set(["map"]),
  },
  {
    name: "clawpatch-gemma-revalidate-v0",
    path: "datasets/clawpatch-gemma-revalidate-v0",
    allowedOperations: new Set(["revalidate"]),
  },
];

const SPLITS = ["train", "validation", "test", "hard_boundary", "all"];
const REGULAR_SPLITS = ["train", "validation", "test"];

const SCHEMAS = {
  map: {
    required: {
      features: "array",
      created: "number",
      changed: "number",
      stale: "number",
    },
  },
  revalidate: {
    required: {
      outcome: "string",
      reasoning: "string",
      commands: "array",
    },
  },
  review: {
    required: {
      findings: "array",
      inspected: "object",
    },
  },
};

function usage() {
  return `Usage: node scripts/validate-clawpatch-datasets.mjs [--pretty] [--out <path>]

Validate local Clawpatch Gemma JSONL datasets without printing private prompts,
assistant content, raw captures, or record identifiers.

Options:
  --pretty      Pretty-print the JSON report.
  --out <path>  Write the JSON report to the given path.
  --help        Show this help text.
`;
}

function parseArgs(argv) {
  const options = {
    pretty: false,
    out: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--out requires a path");
      }
      options.out = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (isPlainObject(value)) {
    return "object";
  }
  return typeof value;
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function fingerprint(row) {
  const material = JSON.stringify(row);
  return createHash("sha256").update(material).digest("hex");
}

function recordKey(row) {
  const captureId = row.metadata?.captureId;
  if (typeof captureId === "string" && captureId.length > 0) {
    return `capture:${captureId}`;
  }
  return `hash:${fingerprint(row)}`;
}

function compactCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function addIssue(report, dataset, split, line, code, message) {
  report.issues.push({
    dataset,
    split,
    ...(line === null ? {} : { line }),
    code,
    message,
  });
}

function checkAssistantSchema(report, dataset, split, line, operation, assistantJson) {
  const schema = SCHEMAS[operation];
  if (!schema) {
    addIssue(
      report,
      dataset,
      split,
      line,
      "unknown_operation_schema",
      "metadata.operation has no known assistant schema",
    );
    return;
  }

  if (!isPlainObject(assistantJson)) {
    addIssue(report, dataset, split, line, "assistant_schema_type", "assistant JSON must be an object");
    return;
  }

  for (const [field, expectedType] of Object.entries(schema.required)) {
    if (!(field in assistantJson)) {
      addIssue(report, dataset, split, line, "assistant_schema_missing_field", `assistant JSON missing ${field}`);
      continue;
    }

    const actualType = valueType(assistantJson[field]);
    if (actualType !== expectedType) {
      addIssue(
        report,
        dataset,
        split,
        line,
        "assistant_schema_field_type",
        `assistant JSON field ${field} must be ${expectedType}`,
      );
    }
  }
}

function validateRecord(report, datasetConfig, split, line, row, fileSummary) {
  if (!isPlainObject(row)) {
    addIssue(report, datasetConfig.name, split, line, "record_type", "JSONL row must be an object");
    return null;
  }

  if (!Array.isArray(row.messages)) {
    addIssue(report, datasetConfig.name, split, line, "messages_missing", "row missing messages array");
  } else {
    const roles = row.messages.map((message) => message?.role).filter((role) => typeof role === "string");
    for (const role of ["system", "user", "assistant"]) {
      if (!roles.includes(role)) {
        addIssue(report, datasetConfig.name, split, line, "message_role_missing", `messages missing ${role} role`);
      }
    }
  }

  if (!isPlainObject(row.metadata)) {
    addIssue(report, datasetConfig.name, split, line, "metadata_missing", "row missing metadata object");
  }

  const operation = row.metadata?.operation;
  if (typeof operation !== "string" || operation.length === 0) {
    addIssue(report, datasetConfig.name, split, line, "operation_missing", "metadata.operation must be present");
  } else {
    increment(fileSummary.operationCounts, operation);
    if (!datasetConfig.allowedOperations.has(operation)) {
      addIssue(
        report,
        datasetConfig.name,
        split,
        line,
        "operation_not_allowed",
        "metadata.operation is not allowed for this dataset",
      );
    }
  }

  if (typeof row.metadata?.captureId !== "string" || row.metadata.captureId.length === 0) {
    addIssue(report, datasetConfig.name, split, line, "capture_id_missing", "metadata.captureId must be present");
  }

  const assistantMessages = Array.isArray(row.messages)
    ? row.messages.filter((message) => message?.role === "assistant")
    : [];
  if (assistantMessages.length !== 1) {
    addIssue(
      report,
      datasetConfig.name,
      split,
      line,
      "assistant_message_count",
      "row must contain exactly one assistant message",
    );
    return {
      key: recordKey(row),
      operation,
    };
  }

  const assistantContent = assistantMessages[0].content;
  if (typeof assistantContent !== "string") {
    addIssue(
      report,
      datasetConfig.name,
      split,
      line,
      "assistant_content_type",
      "assistant content must be a JSON string",
    );
    return {
      key: recordKey(row),
      operation,
    };
  }

  let assistantJson;
  try {
    assistantJson = JSON.parse(assistantContent);
  } catch {
    addIssue(
      report,
      datasetConfig.name,
      split,
      line,
      "assistant_json_parse",
      "assistant content must parse as JSON",
    );
    return {
      key: recordKey(row),
      operation,
    };
  }

  const assistantKeys = isPlainObject(assistantJson) ? Object.keys(assistantJson).sort().join(",") : valueType(assistantJson);
  increment(fileSummary.assistantKeySets, assistantKeys);

  if (typeof operation === "string" && operation.length > 0) {
    checkAssistantSchema(report, datasetConfig.name, split, line, operation, assistantJson);
  }

  return {
    key: recordKey(row),
    operation,
  };
}

async function readJsonl(report, datasetConfig, split) {
  const relativePath = path.join(datasetConfig.path, `${split}.jsonl`);
  const summary = {
    path: relativePath,
    exists: false,
    rows: 0,
    blankLines: 0,
    operationCounts: {},
    assistantKeySets: {},
    records: [],
  };

  let text;
  try {
    text = await readFile(relativePath, "utf8");
    summary.exists = true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      addIssue(report, datasetConfig.name, split, null, "file_missing", "required JSONL file is missing");
    } else {
      addIssue(report, datasetConfig.name, split, null, "file_read", "required JSONL file could not be read");
    }
    return summary;
  }

  const lines = text.split(/\r?\n/u);
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.trim().length === 0) {
      summary.blankLines += 1;
      continue;
    }

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      addIssue(report, datasetConfig.name, split, lineNumber, "jsonl_parse", "JSONL line must parse as JSON");
      continue;
    }

    summary.rows += 1;
    const record = validateRecord(report, datasetConfig, split, lineNumber, row, summary);
    if (record) {
      summary.records.push(record);
    }
  }

  summary.operationCounts = compactCounts(summary.operationCounts);
  summary.assistantKeySets = compactCounts(summary.assistantKeySets);
  return summary;
}

function countDuplicateKeys(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.key, (counts.get(record.key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function keySet(records) {
  return new Set(records.map((record) => record.key));
}

function validateConsistency(report, datasetSummary) {
  const consistency = {
    allRows: datasetSummary.files.all?.rows ?? 0,
    regularRows: 0,
    regularUniqueRows: 0,
    hardBoundaryRows: datasetSummary.files.hard_boundary?.rows ?? 0,
    hardBoundaryUniqueRows: 0,
    extraRegularRows: 0,
    missingRegularRows: 0,
    extraHardBoundaryRows: 0,
    duplicateRowsInAll: 0,
    duplicateRowsBySplit: {},
    overlappingRegularRows: 0,
  };

  const allRecords = datasetSummary.files.all?.records ?? [];
  const allKeys = keySet(allRecords);
  consistency.duplicateRowsInAll = countDuplicateKeys(allRecords);
  if (consistency.duplicateRowsInAll > 0) {
    addIssue(report, datasetSummary.name, "all", null, "all_duplicate_rows", "all.jsonl contains duplicate row identities");
  }

  const regularRecords = [];
  const regularCounts = new Map();
  for (const split of REGULAR_SPLITS) {
    const records = datasetSummary.files[split]?.records ?? [];
    regularRecords.push(...records);
    const duplicateCount = countDuplicateKeys(records);
    consistency.duplicateRowsBySplit[split] = duplicateCount;
    if (duplicateCount > 0) {
      addIssue(report, datasetSummary.name, split, null, "split_duplicate_rows", "split contains duplicate row identities");
    }

    for (const record of records) {
      regularCounts.set(record.key, (regularCounts.get(record.key) ?? 0) + 1);
      if (!allKeys.has(record.key)) {
        consistency.extraRegularRows += 1;
      }
    }
  }

  consistency.regularRows = regularRecords.length;
  consistency.regularUniqueRows = regularCounts.size;
  consistency.overlappingRegularRows = [...regularCounts.values()].filter((count) => count > 1).length;
  if (consistency.extraRegularRows > 0) {
    addIssue(
      report,
      datasetSummary.name,
      "train/validation/test",
      null,
      "regular_split_extra_rows",
      "regular split rows must be present in all.jsonl",
    );
  }
  if (consistency.overlappingRegularRows > 0) {
    addIssue(
      report,
      datasetSummary.name,
      "train/validation/test",
      null,
      "regular_split_overlap",
      "regular split row identities must be disjoint",
    );
  }

  for (const record of allRecords) {
    if (!regularCounts.has(record.key)) {
      consistency.missingRegularRows += 1;
    }
  }
  if (consistency.missingRegularRows > 0) {
    addIssue(
      report,
      datasetSummary.name,
      "train/validation/test",
      null,
      "regular_split_missing_rows",
      "all.jsonl rows must be represented in regular splits",
    );
  }

  const hardBoundaryRecords = datasetSummary.files.hard_boundary?.records ?? [];
  const hardBoundaryKeys = keySet(hardBoundaryRecords);
  consistency.hardBoundaryUniqueRows = hardBoundaryKeys.size;
  consistency.duplicateRowsBySplit.hard_boundary = countDuplicateKeys(hardBoundaryRecords);
  if (consistency.duplicateRowsBySplit.hard_boundary > 0) {
    addIssue(
      report,
      datasetSummary.name,
      "hard_boundary",
      null,
      "split_duplicate_rows",
      "split contains duplicate row identities",
    );
  }
  for (const record of hardBoundaryRecords) {
    if (!allKeys.has(record.key)) {
      consistency.extraHardBoundaryRows += 1;
    }
  }
  if (consistency.extraHardBoundaryRows > 0) {
    addIssue(
      report,
      datasetSummary.name,
      "hard_boundary",
      null,
      "hard_boundary_extra_rows",
      "hard_boundary rows must be present in all.jsonl",
    );
  }

  datasetSummary.consistency = consistency;
}

function stripPrivateWorkingData(datasetSummary) {
  for (const split of SPLITS) {
    if (datasetSummary.files[split]) {
      delete datasetSummary.files[split].records;
    }
  }
}

async function validate() {
  const report = {
    schemaVersion: 1,
    ok: false,
    datasets: [],
    totals: {
      datasets: DATASETS.length,
      files: 0,
      rows: 0,
      issues: 0,
    },
    issues: [],
  };

  for (const datasetConfig of DATASETS) {
    const datasetSummary = {
      name: datasetConfig.name,
      path: datasetConfig.path,
      allowedOperations: [...datasetConfig.allowedOperations].sort(),
      files: {},
      consistency: {},
      issueCount: 0,
    };
    const issueStart = report.issues.length;

    for (const split of SPLITS) {
      const fileSummary = await readJsonl(report, datasetConfig, split);
      datasetSummary.files[split] = fileSummary;
      report.totals.files += 1;
      report.totals.rows += fileSummary.rows;
    }

    validateConsistency(report, datasetSummary);
    datasetSummary.issueCount = report.issues.length - issueStart;
    stripPrivateWorkingData(datasetSummary);
    report.datasets.push(datasetSummary);
  }

  report.totals.issues = report.issues.length;
  report.ok = report.totals.issues === 0;
  return report;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const report = await validate();
  const text = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;

  if (options.out) {
    const outPath = path.resolve(options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, text);
  }

  process.stdout.write(text);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

await main();
