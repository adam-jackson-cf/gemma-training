#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const captureDirs = options.captureDirs.length === 0
  ? [path.join(root, "captures", "20260522T220000Z-pilot")]
  : options.captureDirs.map((dir) => path.resolve(dir));
const outputDir = path.resolve(options.outputDir ?? path.join(root, "datasets", "clawpatch-gemma-v0"));

const SYSTEM_PROMPT =
  "You are a Clawpatch provider. Return only JSON matching the requested schema. Do not include markdown fences or prose.";

const splitByRepo = new Map([
  ["click", "train"],
  ["hono", "train"],
  ["ripgrep", "validation"],
]);

function usage() {
  return `Usage: node scripts/curate-captures.mjs [--capture-dir <path> ...] [--output-dir <path>]

Curate accepted Clawpatch capture JSONL into TRL SFT dataset files. The script
does not print prompts, assistant content, raw captures, or record identifiers.

Options:
  --capture-dir <path>  Capture directory containing captures.jsonl. Repeatable.
  --output-dir <path>   Dataset output directory. Default: datasets/clawpatch-gemma-v0
  --help                Show this help text.
`;
}

function parseArgs(argv) {
  const parsed = {
    captureDirs: [],
    outputDir: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--capture-dir") {
      parsed.captureDirs.push(requiredValue(argv, (index += 1), arg));
    } else if (arg.startsWith("--capture-dir=")) {
      parsed.captureDirs.push(arg.slice("--capture-dir=".length));
    } else if (arg === "--output-dir") {
      parsed.outputDir = requiredValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = arg.slice("--output-dir=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseJsonl(source, label) {
  return source
    .split(/\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label}:${index + 1}: invalid JSONL row: ${error.message}`);
      }
    });
}

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function assistantContent(capture) {
  return JSON.stringify(capture.acceptedOutput);
}

function reviewFindingCount(capture) {
  return Array.isArray(capture.acceptedOutput?.findings) ? capture.acceptedOutput.findings.length : null;
}

function baseMetadata(capture) {
  return {
    captureId: capture.captureId,
    captureRunId: capture.captureRunId,
    operation: capture.operation,
    repo: capture.repo?.projectName ?? null,
    repoHeadSha: capture.repo?.headSha ?? null,
    provider: capture.provider?.name ?? null,
    providerModel: capture.provider?.model ?? "",
    validationStatus: capture.validationStatus,
    redacted: capture.redactionState?.redacted === true,
    metadataOnly: capture.redactionState?.metadataOnly === true,
    promptBytes: Buffer.byteLength(capture.prompt ?? "", "utf8"),
    assistantBytes: Buffer.byteLength(assistantContent(capture), "utf8"),
    featureId: capture.acceptedOutput?.featureId ?? "",
    findingCount: reviewFindingCount(capture) ?? -1,
    evalKind: "",
    triageStatus: "",
    triageReviewerOrMethod: "",
    triageNotes: "",
    expectedJsonParse: false,
    expectedSchemaValid: false,
    expectedEvidenceValid: false,
  };
}

function toSftRow(capture) {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: capture.prompt },
      { role: "assistant", content: assistantContent(capture) },
    ],
    metadata: baseMetadata(capture),
  };
}

function captureUsabilityIssue(capture) {
  if (capture.status !== "accepted") {
    return "non-accepted-status";
  }
  if (capture.validationStatus !== "schema-valid-operation-valid") {
    return "not-schema-valid-operation-valid";
  }
  if (capture.redactionState?.metadataOnly === true) {
    return "metadata-only";
  }
  if (typeof capture.prompt !== "string" || capture.prompt.length === 0) {
    return "missing-prompt";
  }
  if (capture.acceptedOutput === null || typeof capture.acceptedOutput !== "object") {
    return "missing-accepted-output";
  }
  JSON.parse(assistantContent(capture));
  return null;
}

function splitCapture(capture, repoOrdinal) {
  const repo = capture.repo?.projectName ?? "";
  if (splitByRepo.has(repo)) {
    const split = splitByRepo.get(repo);
    if (split === "validation" && capture.operation === "review") {
      return repoOrdinal % 2 === 0 ? "validation" : "test";
    }
    return split;
  }
  return "test";
}

function sortedRows(rows) {
  return rows.toSorted((left, right) => {
    const a = `${left.metadata.repo}:${left.metadata.operation}:${left.metadata.captureId}`;
    const b = `${right.metadata.repo}:${right.metadata.operation}:${right.metadata.captureId}`;
    return a.localeCompare(b);
  });
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function buildHardBoundaryRows(rows, triageById) {
  const candidates = rows.filter((row) => triageById.has(row.metadata.captureId));
  const reviewClean = candidates.filter(
    (row) => row.metadata.operation === "review" && row.metadata.findingCount === 0,
  );
  const reviewNonEmpty = candidates.filter(
    (row) => row.metadata.operation === "review" && Number(row.metadata.findingCount) > 0,
  );
  const nonReview = candidates.filter((row) => row.metadata.operation !== "review");
  return [...nonReview, ...reviewClean.slice(0, 8), ...reviewNonEmpty.slice(0, 18)].map((row) => ({
    ...row,
    metadata: {
      ...row.metadata,
      evalKind: "hard_boundary",
      triageStatus: triageById.get(row.metadata.captureId)?.triageStatus ?? "",
      triageReviewerOrMethod: triageById.get(row.metadata.captureId)?.triageReviewerOrMethod ?? "",
      triageNotes: triageById.get(row.metadata.captureId)?.triageNotes ?? "",
      expectedJsonParse: true,
      expectedSchemaValid: true,
      expectedEvidenceValid: true,
    },
  }));
}

function summarize(rowsBySplit, allRows, hardBoundaryRows, sourceCaptureSummary) {
  const counts = {};
  for (const [split, rows] of Object.entries(rowsBySplit)) {
    counts[split] = {
      total: rows.length,
      byOperation: {},
      byRepo: {},
      cleanReview: 0,
      nonEmptyReview: 0,
      redacted: 0,
    };
    for (const row of rows) {
      counts[split].byOperation[row.metadata.operation] =
        (counts[split].byOperation[row.metadata.operation] ?? 0) + 1;
      counts[split].byRepo[row.metadata.repo] = (counts[split].byRepo[row.metadata.repo] ?? 0) + 1;
      if (row.metadata.operation === "review" && row.metadata.findingCount === 0) {
        counts[split].cleanReview += 1;
      }
      if (row.metadata.operation === "review" && Number(row.metadata.findingCount) > 0) {
        counts[split].nonEmptyReview += 1;
      }
      if (row.metadata.redacted) {
        counts[split].redacted += 1;
      }
    }
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceCaptureDir: captureDirs.length === 1 ? captureDirs[0] : null,
    sourceCaptureDirs: captureDirs,
    sourceCaptureRows: sourceCaptureSummary.total,
    excludedCaptureRows: sourceCaptureSummary.excluded,
    excludedCaptureRowsByReason: sourceCaptureSummary.excludedByReason,
    systemPromptHash: stableHash(SYSTEM_PROMPT),
    totalRows: allRows.length,
    hardBoundaryRows: hardBoundaryRows.length,
    counts,
    splitPolicy:
      "Repository-aware split: click and hono are train; ripgrep review captures alternate validation/test; non-review ripgrep captures stay validation. Hard-boundary rows come from the retained triage subset.",
    privacy:
      "Rows are derived only from accepted capture records. Records marked metadata-only are excluded. Redacted records remain marked in metadata.",
  };
}

function datasetCard(summary) {
  const sourceLines =
    summary.sourceCaptureDirs.length === 1
      ? `- Source: ${summary.sourceCaptureDirs[0]}`
      : ["- Sources:", ...summary.sourceCaptureDirs.map((dir) => `  - ${dir}`)].join("\n");
  return `---
license: other
task_categories:
- text-generation
language:
- en
pretty_name: Clawpatch Gemma Review v0
size_categories:
- n<1K
---

# Clawpatch Gemma Review v0

Private pilot dataset for supervised fine-tuning Clawpatch provider calls from validated teacher captures.

## Scope

${sourceLines}
- Rows: ${summary.totalRows}
- Hard-boundary eval rows: ${summary.hardBoundaryRows}
- Operations: map, review, revalidate
- Teacher provider: Codex
- Accepted criteria: schema-valid and Clawpatch operation-valid captures only
- Excluded scope: fix provider calls

## Splits

\`\`\`json
${JSON.stringify(summary.counts, null, 2)}
\`\`\`

## Format

Each row is TRL conversational SFT JSONL:

\`\`\`json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "<exact Clawpatch prompt>"},
    {"role": "assistant", "content": "<validated JSON output>"}
  ],
  "metadata": {"operation": "review", "validationStatus": "schema-valid-operation-valid"}
}
\`\`\`

## Privacy

This dataset is private training material. The capture pipeline scanned prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and summaries for common secrets before persistence. Rows preserve the redaction marker in metadata.
`;
}

if (options.help) {
  process.stdout.write(usage());
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

const captures = [];
const triageRows = [];
for (const captureDir of captureDirs) {
  const capturesPath = path.join(captureDir, "captures.jsonl");
  if (!existsSync(capturesPath)) {
    throw new Error(`${capturesPath}: missing captures.jsonl`);
  }
  captures.push(...parseJsonl(await readFile(capturesPath, "utf8"), capturesPath));
  const triagePath = path.join(captureDir, "triage-subset.jsonl");
  if (existsSync(triagePath)) {
    triageRows.push(...parseJsonl(await readFile(triagePath, "utf8"), triagePath));
  }
}
const triageById = new Map(triageRows.map((row) => [row.captureId, row]));

const usableCaptures = [];
const excludedByReason = {};
for (const capture of captures) {
  const issue = captureUsabilityIssue(capture);
  if (issue === null) {
    usableCaptures.push(capture);
  } else {
    excludedByReason[issue] = (excludedByReason[issue] ?? 0) + 1;
  }
}

const repoOrdinals = new Map();
const rowsBySplit = { train: [], validation: [], test: [] };

for (const capture of usableCaptures) {
  const repoKey = `${capture.repo?.projectName ?? "unknown"}:${capture.operation}`;
  const ordinal = repoOrdinals.get(repoKey) ?? 0;
  repoOrdinals.set(repoKey, ordinal + 1);
  const split = splitCapture(capture, ordinal);
  rowsBySplit[split].push(toSftRow(capture));
}

for (const split of Object.keys(rowsBySplit)) {
  rowsBySplit[split] = sortedRows(rowsBySplit[split]);
}

const allRows = sortedRows([...rowsBySplit.train, ...rowsBySplit.validation, ...rowsBySplit.test]);
const hardBoundaryRows = sortedRows(buildHardBoundaryRows(allRows, triageById));
const summary = summarize(rowsBySplit, allRows, hardBoundaryRows, {
  total: captures.length,
  excluded: captures.length - usableCaptures.length,
  excludedByReason,
});

await writeFile(path.join(outputDir, "train.jsonl"), jsonl(rowsBySplit.train));
await writeFile(path.join(outputDir, "validation.jsonl"), jsonl(rowsBySplit.validation));
await writeFile(path.join(outputDir, "test.jsonl"), jsonl(rowsBySplit.test));
await writeFile(path.join(outputDir, "hard_boundary.jsonl"), jsonl(hardBoundaryRows));
await writeFile(path.join(outputDir, "all.jsonl"), jsonl(allRows));
await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputDir, "README.md"), datasetCard(summary));

console.log(JSON.stringify(summary, null, 2));
