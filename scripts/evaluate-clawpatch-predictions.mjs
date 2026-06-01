#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const categories = new Set([
  "bug",
  "security",
  "performance",
  "concurrency",
  "api-contract",
  "data-loss",
  "test-gap",
  "docs-gap",
  "build-release",
  "maintainability",
]);
const severities = new Set(["critical", "high", "medium", "low"]);
const confidences = new Set(["high", "medium", "low"]);
const operations = new Set(["review", "map", "revalidate"]);
const featureKinds = new Set([
  "cli-command",
  "route",
  "ui-flow",
  "service",
  "job",
  "agent-tool",
  "library",
  "config",
  "release",
  "test-suite",
  "infra",
  "unknown",
]);
const trustBoundaries = new Set([
  "user-input",
  "network",
  "filesystem",
  "secrets",
  "process-exec",
  "database",
  "auth",
  "permissions",
  "concurrency",
  "external-api",
  "serialization",
]);
const revalidateOutcomes = new Set(["fixed", "open", "false-positive", "uncertain"]);
const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const usage = `Usage:
  node scripts/evaluate-clawpatch-predictions.mjs --reference <trl-split.jsonl> --prediction <label=predictions.jsonl> [--prediction <label=predictions.jsonl> ...] [--operation review|map|revalidate|auto] [--out <report.json>] [--pretty]

Options:
  --reference, -r     Reference TRL JSONL split with messages and assistant answers.
  --prediction, -p    Prediction JSONL file. Repeat for multiple models. Use label=path to name a model.
  --operation         Evaluation operation. Defaults to auto, inferred from reference metadata.operation.
  --out, -o           Write the JSON report to this path instead of stdout.
  --pretty            Pretty-print JSON with two-space indentation.
  --help, -h          Show this help.

Prediction rows are matched to reference rows by line number. Each prediction row may be:
  - a Clawpatch review, map, or revalidate object
  - a wrapper with prediction/output/response/completion/generated_text/content/text
  - a chat row with an assistant message in messages[]
`;

function parseArgs(argv) {
  const options = {
    reference: null,
    predictions: [],
    operation: "auto",
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
    } else if (arg === "--reference" || arg === "-r") {
      options.reference = requiredValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--reference=")) {
      options.reference = arg.slice("--reference=".length);
    } else if (arg === "--prediction" || arg === "-p") {
      options.predictions.push(parsePredictionArg(requiredValue(argv, (index += 1), arg)));
    } else if (arg.startsWith("--prediction=")) {
      options.predictions.push(parsePredictionArg(arg.slice("--prediction=".length)));
    } else if (arg === "--operation") {
      options.operation = parseOperation(requiredValue(argv, (index += 1), arg));
    } else if (arg.startsWith("--operation=")) {
      options.operation = parseOperation(arg.slice("--operation=".length));
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

function parseOperation(value) {
  if (value === "auto" || operations.has(value)) {
    return value;
  }
  throw new Error(`--operation must be one of: review, map, revalidate, auto`);
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePredictionArg(value) {
  const equals = value.indexOf("=");
  if (equals > 0) {
    return { label: value.slice(0, equals), path: value.slice(equals + 1) };
  }
  const parsed = path.parse(value);
  return { label: parsed.name || value, path: value };
}

async function readJsonl(filePath) {
  const source = await readFile(filePath, "utf8");
  const records = [];
  const jsonErrors = [];
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      continue;
    }
    try {
      records.push({ lineNumber: index + 1, value: JSON.parse(line) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      jsonErrors.push({
        line: index + 1,
        message,
      });
      records.push({ lineNumber: index + 1, value: null, jsonError: message });
    }
  }
  return { records, jsonErrors };
}

function parseJsonText(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractReference(row, rowIndex, operation) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {
      id: `row-${rowIndex + 1}`,
      metadata: {},
      operation,
      promptInfo: parseOperationPromptInfo("", operation),
      parse: { ok: false, message: "invalid reference JSONL row" },
      output: null,
      shape: invalidShape("invalid-reference-jsonl-row"),
    };
  }
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const user = messages.find((message) => message?.role === "user");
  const assistant = [...messages].reverse().find((message) => message?.role === "assistant");
  const prompt = typeof user?.content === "string" ? user.content : "";
  const assistantContent = typeof assistant?.content === "string" ? assistant.content : null;
  const parsed = assistantContent === null ? { ok: false, message: "missing assistant content" } : parseJsonText(assistantContent);
  const promptInfo = parseOperationPromptInfo(prompt, operation);
  return {
    id: referenceId(row, rowIndex),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    operation,
    promptInfo,
    parse: parsed,
    output: parsed.ok ? parsed.value : null,
    shape: parsed.ok ? validateOperationShape(parsed.value, operation, promptInfo) : invalidShape("unparseable-reference"),
  };
}

function resolveOperation(requestedOperation, referenceRecords) {
  if (requestedOperation !== "auto") {
    return requestedOperation;
  }
  const inferred = new Set();
  for (const record of referenceRecords) {
    const metadata =
      record.value && typeof record.value === "object" && !Array.isArray(record.value) ? record.value.metadata : null;
    const operation = metadata && typeof metadata.operation === "string" ? metadata.operation : null;
    if (operations.has(operation)) {
      inferred.add(operation);
    }
  }
  if (inferred.size === 1) {
    return [...inferred][0];
  }
  if (inferred.size === 0) {
    throw new Error("unable to infer --operation from reference metadata.operation");
  }
  throw new Error(`reference metadata contains mixed operations: ${[...inferred].sort().join(", ")}`);
}

function referenceId(row, rowIndex) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  for (const key of ["captureId", "featureId", "captureRunId"]) {
    if (typeof metadata[key] === "string" && metadata[key] !== "") {
      return metadata[key];
    }
  }
  return `row-${rowIndex + 1}`;
}

function parsePromptInfo(prompt) {
  const promptContext = parsePromptContext(prompt);
  const fileBlocks = parseFileBlocks(prompt);
  const explicitValidPaths = parseValidEvidencePaths(prompt);
  const contextPaths = Array.isArray(promptContext?.includedFiles)
    ? promptContext.includedFiles
        .filter((file) => file && file.readable !== false && typeof file.path === "string")
        .map((file) => file.path)
    : [];
  const blockPaths = [...fileBlocks.keys()];
  const allowedPaths =
    explicitValidPaths.length > 0
      ? explicitValidPaths
      : contextPaths.length > 0
        ? contextPaths
        : blockPaths;
  return {
    hasPrompt: prompt.length > 0,
    hasExplicitValidEvidencePaths: explicitValidPaths.length > 0,
    allowedPaths: [...new Set(allowedPaths.map(normalizePath))].sort(),
    promptContextValid: promptContext !== null,
    fileBlocks,
  };
}

function parseOperationPromptInfo(prompt, operation) {
  if (operation === "review") {
    return parsePromptInfo(prompt);
  }
  if (operation === "map") {
    return parseMapPromptInfo(prompt);
  }
  if (operation === "revalidate") {
    return parseRevalidatePromptInfo(prompt);
  }
  throw new Error(`unsupported operation: ${operation}`);
}

function parseMapPromptInfo(prompt) {
  const inventory = parseJsonSection(prompt, "Repository inventory:\n", "\n\nJSON shape:");
  const allowedPaths = inventory === null ? [] : inventoryPaths(inventory);
  return {
    hasPrompt: prompt.length > 0,
    promptContextValid: inventory !== null,
    allowedPaths: [...new Set(allowedPaths.map(normalizePath))].sort(),
    fileBlocks: new Map(),
  };
}

function parseRevalidatePromptInfo(prompt) {
  const finding = parseJsonSection(prompt, "Finding:\n", null);
  const evidencePaths = Array.isArray(finding?.evidence)
    ? finding.evidence
        .map((evidence) => (typeof evidence?.path === "string" ? evidence.path : null))
        .filter((pathValue) => pathValue !== null)
    : [];
  return {
    hasPrompt: prompt.length > 0,
    promptContextValid: finding !== null,
    allowedPaths: [...new Set(evidencePaths.map(normalizePath))].sort(),
    fileBlocks: new Map(),
  };
}

function parseJsonSection(prompt, startMarker, endMarker) {
  const start = prompt.indexOf(startMarker);
  if (start === -1) {
    return null;
  }
  const bodyStart = start + startMarker.length;
  const end = endMarker === null ? prompt.length : prompt.indexOf(endMarker, bodyStart);
  if (end === -1) {
    return null;
  }
  const parsed = parseJsonText(prompt.slice(bodyStart, end).trim());
  return parsed.ok ? parsed.value : null;
}

function inventoryPaths(value) {
  const paths = [];
  collectInventoryPaths(value, paths, 0);
  return paths.filter((pathValue) => pathValue !== "" && isSafeRelativePath(pathValue));
}

function collectInventoryPaths(value, paths, depth) {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const normalized = normalizePath(value);
    if (looksLikeRepositoryPath(normalized)) {
      paths.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectInventoryPaths(item, paths, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectInventoryPaths(item, paths, depth + 1);
    }
  }
}

function looksLikeRepositoryPath(value) {
  return (
    value.includes("/") ||
    value.startsWith(".") ||
    /\.[a-z0-9]+$/iu.test(value) ||
    ["README", "LICENSE", "COPYING", "UNLICENSE", "Makefile"].some((prefix) => value.startsWith(prefix))
  );
}

function parsePromptContext(prompt) {
  const marker = "\nPrompt context:\n";
  const start = prompt.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const bodyStart = start + marker.length;
  const endMarker = "\n\nJSON shape:";
  const end = prompt.indexOf(endMarker, bodyStart);
  if (end === -1) {
    return null;
  }
  const parsed = parseJsonText(prompt.slice(bodyStart, end).trim());
  return parsed.ok ? parsed.value : null;
}

function parseValidEvidencePaths(prompt) {
  const marker = "Valid evidence paths are exactly:\n";
  const start = prompt.indexOf(marker);
  if (start === -1) {
    return [];
  }
  const lines = prompt.slice(start + marker.length).split(/\n/u);
  const paths = [];
  for (const line of lines) {
    if (!line.startsWith("- ")) {
      break;
    }
    const value = line.slice(2).trim();
    if (value !== "") {
      paths.push(value);
    }
  }
  return paths;
}

function parseFileBlocks(prompt) {
  const marker = "\nFiles:\n";
  const start = prompt.indexOf(marker);
  const filesText = start === -1 ? "" : prompt.slice(start + marker.length);
  const matches = [...filesText.matchAll(/^--- (.+?) \((.+?)\)\n/gmu)];
  const blocks = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? filesText.length;
    const rawBody = filesText.slice(bodyStart, bodyEnd).trimEnd();
    const pathValue = normalizePath(match[1]);
    const numberedLines = [];
    const excerptTextLines = [];
    for (const line of rawBody.split(/\n/u)) {
      const numbered = /^(\d+) \| ?(.*)$/u.exec(line);
      if (numbered) {
        const lineNumber = Number(numbered[1]);
        numberedLines.push({ lineNumber, text: numbered[2] });
        excerptTextLines.push(numbered[2]);
      }
    }
    blocks.set(pathValue, {
      path: pathValue,
      descriptor: match[2],
      lineNumbers: new Set(numberedLines.map((line) => line.lineNumber)),
      ranges: compactRanges(numberedLines.map((line) => line.lineNumber)),
      numberedLines,
      excerptText: excerptTextLines.join("\n"),
    });
  }
  return blocks;
}

function compactRanges(numbers) {
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const ranges = [];
  for (const number of sorted) {
    const last = ranges.at(-1);
    if (last && last.endLine + 1 === number) {
      last.endLine = number;
    } else {
      ranges.push({ startLine: number, endLine: number });
    }
  }
  return ranges;
}

function extractPredictionOutput(row) {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    if (Array.isArray(row.messages)) {
      const assistant = [...row.messages].reverse().find((message) => message?.role === "assistant");
      if (typeof assistant?.content === "string") {
        const parsed = parseJsonText(assistant.content);
        return parsed.ok
          ? { parseable: true, output: parsed.value, source: "messages.assistant.content" }
          : { parseable: false, output: null, source: "messages.assistant.content", parseError: parsed.message };
      }
    }
    if (Array.isArray(row.choices) && row.choices.length > 0) {
      const choice = row.choices[0];
      const content =
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : typeof choice?.text === "string"
            ? choice.text
            : null;
      if (content !== null) {
        const parsed = parseJsonText(content);
        return parsed.ok
          ? { parseable: true, output: parsed.value, source: "choices[0]" }
          : { parseable: false, output: null, source: "choices[0]", parseError: parsed.message };
      }
    }
    for (const key of [
      "prediction",
      "output",
      "response",
      "completion",
      "generated_text",
      "content",
      "text",
      "assistant",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) {
        continue;
      }
      const value = row[key];
      if (typeof value === "string") {
        const parsed = parseJsonText(value);
        return parsed.ok
          ? { parseable: true, output: parsed.value, source: key }
          : { parseable: false, output: null, source: key, parseError: parsed.message };
      }
      if (value && typeof value === "object") {
        return { parseable: true, output: value, source: key };
      }
    }
    return { parseable: true, output: row, source: "row" };
  }
  return { parseable: false, output: null, source: "row", parseError: "prediction row is not an object" };
}

function validateOperationShape(output, operation, promptInfo) {
  if (operation === "review") {
    return validateReviewShape(output);
  }
  if (operation === "map") {
    return validateMapShape(output, promptInfo);
  }
  if (operation === "revalidate") {
    return validateRevalidateShape(output);
  }
  throw new Error(`unsupported operation: ${operation}`);
}

function validateReviewShape(output) {
  const issues = [];
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return invalidShape("review output is not an object");
  }
  const allowedTopLevel = new Set(["findings", "inspected"]);
  addUnknownKeys(issues, [], output, allowedTopLevel);
  if (!Array.isArray(output.findings)) {
    issues.push(issue("schema.missing-findings-array", []));
  }
  if (!output.inspected || typeof output.inspected !== "object" || Array.isArray(output.inspected)) {
    issues.push(issue("schema.missing-inspected-object", []));
  } else {
    addUnknownKeys(issues, ["inspected"], output.inspected, new Set(["files", "symbols", "notes"]));
    for (const key of ["files", "symbols", "notes"]) {
      if (!Array.isArray(output.inspected[key]) || !output.inspected[key].every((item) => typeof item === "string")) {
        issues.push(issue(`schema.invalid-inspected-${key}`, ["inspected", key]));
      }
    }
  }
  const findingIssues = [];
  if (Array.isArray(output.findings)) {
    output.findings.forEach((finding, findingIndex) => {
      const nextIssues = validateFindingShape(finding, findingIndex);
      findingIssues.push(...nextIssues);
      issues.push(...nextIssues);
    });
  }
  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues,
    findingIssues,
  };
}

function invalidShape(code) {
  return { valid: false, issueCount: 1, issues: [issue(code, [])], findingIssues: [] };
}

function validateFindingShape(finding, findingIndex) {
  const issues = [];
  const basePath = ["findings", findingIndex];
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return [issue("schema.finding-not-object", basePath)];
  }
  addUnknownKeys(
    issues,
    basePath,
    finding,
    new Set([
      "title",
      "category",
      "severity",
      "confidence",
      "evidence",
      "reasoning",
      "reproduction",
      "recommendation",
      "whyTestsDoNotAlreadyCoverThis",
      "suggestedRegressionTest",
      "minimumFixScope",
    ]),
  );
  requireString(issues, finding, "title", basePath);
  requireEnum(issues, finding, "category", categories, basePath);
  requireEnum(issues, finding, "severity", severities, basePath);
  requireEnum(issues, finding, "confidence", confidences, basePath);
  requireString(issues, finding, "reasoning", basePath);
  requireNullableString(issues, finding, "reproduction", basePath);
  requireString(issues, finding, "recommendation", basePath);
  requireString(issues, finding, "whyTestsDoNotAlreadyCoverThis", basePath);
  requireNullableString(issues, finding, "suggestedRegressionTest", basePath);
  requireString(issues, finding, "minimumFixScope", basePath);
  if (!Array.isArray(finding.evidence)) {
    issues.push(issue("schema.invalid-evidence-array", [...basePath, "evidence"]));
  } else {
    finding.evidence.forEach((evidence, evidenceIndex) => {
      issues.push(...validateEvidenceShape(evidence, [...basePath, "evidence", evidenceIndex]));
    });
  }
  return issues;
}

function validateEvidenceShape(evidence, basePath) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [issue("schema.evidence-not-object", basePath)];
  }
  addUnknownKeys(issues, basePath, evidence, new Set(["path", "startLine", "endLine", "symbol", "quote"]));
  requireString(issues, evidence, "path", basePath);
  requireNullableLine(issues, evidence, "startLine", basePath);
  requireNullableLine(issues, evidence, "endLine", basePath);
  requireNullableString(issues, evidence, "symbol", basePath);
  requireNullableString(issues, evidence, "quote", basePath);
  return issues;
}

function validateMapShape(output, promptInfo) {
  const issues = [];
  const featureIssues = [];
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { ...invalidShape("map output is not an object"), featureIssues };
  }
  addUnknownKeys(issues, [], output, new Set(["features", "notes", "created", "changed", "stale"]));
  if (!Array.isArray(output.features)) {
    issues.push(issue("schema.missing-features-array", ["features"]));
  } else {
    output.features.forEach((feature, featureIndex) => {
      const nextIssues = validateMapFeatureShape(feature, featureIndex, promptInfo);
      featureIssues.push(...nextIssues);
      issues.push(...nextIssues);
    });
  }
  if (Object.prototype.hasOwnProperty.call(output, "notes")) {
    requireStringArray(issues, output, "notes", []);
  }
  for (const key of ["created", "changed", "stale"]) {
    if (Object.prototype.hasOwnProperty.call(output, key) && (!Number.isInteger(output[key]) || output[key] < 0)) {
      issues.push(issue(`schema.invalid-${key}`, [key]));
    }
  }
  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues,
    featureIssues,
    findingIssues: [],
  };
}

function validateMapFeatureShape(feature, featureIndex, promptInfo) {
  const issues = [];
  const basePath = ["features", featureIndex];
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
    return [issue("schema.feature-not-object", basePath)];
  }
  addUnknownKeys(
    issues,
    basePath,
    feature,
    new Set([
      "schemaVersion",
      "featureId",
      "title",
      "summary",
      "kind",
      "source",
      "confidence",
      "entrypoints",
      "ownedFiles",
      "contextFiles",
      "tests",
      "status",
      "findingIds",
      "patchAttemptIds",
      "analysisHistory",
      "lock",
      "tags",
      "trustBoundaries",
      "reason",
      "createdAt",
      "updatedAt",
    ]),
  );
  requireString(issues, feature, "title", basePath);
  requireString(issues, feature, "summary", basePath);
  requireEnum(issues, feature, "kind", featureKinds, basePath);
  requireEnum(issues, feature, "confidence", confidences, basePath);
  requireArray(issues, feature, "entrypoints", basePath);
  requireArray(issues, feature, "ownedFiles", basePath);
  requireArray(issues, feature, "contextFiles", basePath);
  requireArray(issues, feature, "tests", basePath);
  requireStringArray(issues, feature, "tags", basePath);
  if (!Array.isArray(feature.trustBoundaries)) {
    issues.push(issue("schema.invalid-trustBoundaries", [...basePath, "trustBoundaries"]));
  } else {
    feature.trustBoundaries.forEach((boundary, boundaryIndex) => {
      if (typeof boundary !== "string" || !trustBoundaries.has(boundary)) {
        issues.push(issue("schema.invalid-trustBoundary", [...basePath, "trustBoundaries", boundaryIndex]));
      }
    });
  }
  if (Object.prototype.hasOwnProperty.call(feature, "reason") && typeof feature.reason !== "string") {
    issues.push(issue("schema.invalid-reason", [...basePath, "reason"]));
  }
  if (Array.isArray(feature.entrypoints)) {
    feature.entrypoints.forEach((entrypoint, index) =>
      issues.push(...validateMapEntrypointShape(entrypoint, [...basePath, "entrypoints", index], promptInfo)),
    );
  }
  for (const key of ["ownedFiles", "contextFiles"]) {
    if (Array.isArray(feature[key])) {
      feature[key].forEach((fileRef, index) =>
        issues.push(...validateMapFileRefShape(fileRef, [...basePath, key, index], promptInfo)),
      );
    }
  }
  if (Array.isArray(feature.tests)) {
    feature.tests.forEach((testRef, index) =>
      issues.push(...validateMapTestRefShape(testRef, [...basePath, "tests", index], promptInfo)),
    );
  }
  return issues;
}

function validateMapEntrypointShape(entrypoint, basePath, promptInfo) {
  const issues = [];
  if (!entrypoint || typeof entrypoint !== "object" || Array.isArray(entrypoint)) {
    return [issue("schema.entrypoint-not-object", basePath)];
  }
  addUnknownKeys(issues, basePath, entrypoint, new Set(["path", "symbol", "route", "command"]));
  requireString(issues, entrypoint, "path", basePath);
  requireNullableString(issues, entrypoint, "symbol", basePath);
  requireNullableString(issues, entrypoint, "route", basePath);
  requireNullableString(issues, entrypoint, "command", basePath);
  validateMapPathValue(issues, entrypoint.path, [...basePath, "path"], promptInfo);
  return issues;
}

function validateMapFileRefShape(fileRef, basePath, promptInfo) {
  const issues = [];
  if (!fileRef || typeof fileRef !== "object" || Array.isArray(fileRef)) {
    return [issue("schema.file-ref-not-object", basePath)];
  }
  addUnknownKeys(issues, basePath, fileRef, new Set(["path", "reason"]));
  requireString(issues, fileRef, "path", basePath);
  requireString(issues, fileRef, "reason", basePath);
  validateMapPathValue(issues, fileRef.path, [...basePath, "path"], promptInfo);
  return issues;
}

function validateMapTestRefShape(testRef, basePath, promptInfo) {
  const issues = [];
  if (!testRef || typeof testRef !== "object" || Array.isArray(testRef)) {
    return [issue("schema.test-ref-not-object", basePath)];
  }
  addUnknownKeys(issues, basePath, testRef, new Set(["path", "command"]));
  requireString(issues, testRef, "path", basePath);
  requireNullableString(issues, testRef, "command", basePath);
  validateMapPathValue(issues, testRef.path, [...basePath, "path"], promptInfo);
  return issues;
}

function validateMapPathValue(issues, pathValue, basePath, promptInfo) {
  if (typeof pathValue !== "string") {
    return;
  }
  const normalized = normalizePath(pathValue);
  if (!isSafeRelativePath(normalized)) {
    issues.push(issue("map.path-escapes-root", basePath, { path: normalized }));
  }
  if (promptInfo.allowedPaths.length > 0 && !promptInfo.allowedPaths.includes(normalized)) {
    issues.push(issue("map.path-not-in-inventory", basePath, { path: normalized }));
  }
}

function validateRevalidateShape(output) {
  const issues = [];
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return invalidShape("revalidate output is not an object");
  }
  addUnknownKeys(issues, [], output, new Set(["outcome", "reasoning", "commands"]));
  requireEnum(issues, output, "outcome", revalidateOutcomes, []);
  requireString(issues, output, "reasoning", []);
  requireStringArray(issues, output, "commands", []);
  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues,
    findingIssues: [],
  };
}

function addUnknownKeys(issues, basePath, object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      issues.push(issue("schema.unknown-key", [...basePath, key]));
    }
  }
}

function requireString(issues, object, key, basePath) {
  if (typeof object[key] !== "string") {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function requireNullableString(issues, object, key, basePath) {
  if (typeof object[key] !== "string" && object[key] !== null) {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function requireEnum(issues, object, key, values, basePath) {
  if (typeof object[key] !== "string" || !values.has(object[key])) {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function requireArray(issues, object, key, basePath) {
  if (!Array.isArray(object[key])) {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function requireStringArray(issues, object, key, basePath) {
  if (!Array.isArray(object[key]) || !object[key].every((item) => typeof item === "string")) {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function requireNullableLine(issues, object, key, basePath) {
  const value = object[key];
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    issues.push(issue(`schema.invalid-${key}`, [...basePath, key]));
  }
}

function validateEvidenceAgainstPrompt(output, promptInfo) {
  const issues = [];
  const findingResults = [];
  const allowedPaths = new Set(promptInfo.allowedPaths);
  const findings = Array.isArray(output?.findings) ? output.findings : [];
  findings.forEach((finding, findingIndex) => {
    const findingIssues = [];
    if (!Array.isArray(finding?.evidence) || finding.evidence.length === 0) {
      findingIssues.push(issue("evidence.missing", ["findings", findingIndex, "evidence"]));
    } else {
      finding.evidence.forEach((evidence, evidenceIndex) => {
        findingIssues.push(
          ...validateEvidenceRef(evidence, promptInfo, allowedPaths, [
            "findings",
            findingIndex,
            "evidence",
            evidenceIndex,
          ]),
        );
      });
    }
    issues.push(...findingIssues);
    findingResults.push({ findingIndex, valid: findingIssues.length === 0, issueCount: findingIssues.length });
  });
  return { valid: issues.length === 0, issueCount: issues.length, issues, findingResults };
}

function validateEvidenceRef(evidence, promptInfo, allowedPaths, basePath) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [issue("evidence.not-object", basePath)];
  }
  const normalizedPath = typeof evidence.path === "string" ? normalizePath(evidence.path) : null;
  if (normalizedPath === null) {
    issues.push(issue("evidence.invalid-path-type", [...basePath, "path"]));
    return issues;
  }
  if (!isSafeRelativePath(normalizedPath)) {
    issues.push(issue("evidence.path-escapes-root", [...basePath, "path"], { path: normalizedPath }));
  }
  if (!allowedPaths.has(normalizedPath)) {
    issues.push(issue("evidence.path-not-allowed", [...basePath, "path"], { path: normalizedPath }));
  }
  const block = promptInfo.fileBlocks.get(normalizedPath);
  if (!block) {
    issues.push(issue("evidence.path-not-in-files-section", [...basePath, "path"], { path: normalizedPath }));
  }
  const range = normalizedEvidenceRange(evidence);
  const quote = typeof evidence.quote === "string" && evidence.quote.trim() !== "" ? evidence.quote : null;
  if (range.error) {
    issues.push(issue(range.error, basePath, { path: normalizedPath }));
  } else if (range.startLine === null && quote === null) {
    issues.push(issue("evidence.needs-range-or-quote", basePath, { path: normalizedPath }));
  } else if (range.startLine !== null && block && !lineRangeInBlock(range.startLine, range.endLine, block)) {
    issues.push(
      issue("evidence.range-outside-files-section", basePath, {
        path: normalizedPath,
        startLine: range.startLine,
        endLine: range.endLine,
      }),
    );
  }
  if (quote !== null && block) {
    const target =
      range.startLine !== null
        ? block.numberedLines
            .filter((line) => line.lineNumber >= range.startLine && line.lineNumber <= range.endLine)
            .map((line) => line.text)
            .join("\n")
        : block.excerptText;
    if (!target.includes(quote) && !compactWhitespace(target).includes(compactWhitespace(quote))) {
      issues.push(issue("evidence.quote-outside-files-section", [...basePath, "quote"], { path: normalizedPath }));
    }
  }
  return issues;
}

function normalizedEvidenceRange(evidence) {
  const startLine = evidence.startLine === 0 ? null : evidence.startLine;
  const endLine = evidence.endLine === 0 ? null : evidence.endLine;
  if (startLine === null && endLine === null) {
    return { startLine: null, endLine: null };
  }
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return { error: "evidence.range-incomplete" };
  }
  if (startLine <= 0 || endLine <= 0) {
    return { error: "evidence.range-not-positive" };
  }
  if (startLine > endLine) {
    return { error: "evidence.range-inverted" };
  }
  return { startLine, endLine };
}

function lineRangeInBlock(startLine, endLine, block) {
  for (let line = startLine; line <= endLine; line += 1) {
    if (!block.lineNumbers.has(line)) {
      return false;
    }
  }
  return true;
}

function evaluateModel(predictionInput, referenceCases, operation) {
  if (operation === "review") {
    return evaluateReviewModel(predictionInput, referenceCases);
  }
  if (operation === "map") {
    return evaluateMapModel(predictionInput, referenceCases);
  }
  if (operation === "revalidate") {
    return evaluateRevalidateModel(predictionInput, referenceCases);
  }
  throw new Error(`unsupported operation: ${operation}`);
}

function evaluateReviewModel(predictionInput, referenceCases) {
  const caseResults = [];
  const metrics = createMetrics(referenceCases);
  const rowCount = predictionInput.records.length;
  for (let index = 0; index < referenceCases.length; index += 1) {
    const reference = referenceCases[index];
    const record = predictionInput.records[index] ?? null;
    const result = evaluateCase(record?.value ?? null, reference, index);
    caseResults.push(result);
    accumulateMetrics(metrics, result, reference);
  }
  metrics.predictionRows = rowCount;
  metrics.extraPredictionRows = Math.max(0, rowCount - referenceCases.length);
  metrics.missingPredictionRows = Math.max(0, referenceCases.length - rowCount);
  metrics.jsonLineErrors = predictionInput.jsonErrors.length;
  finalizeMetrics(metrics);
  return { caseResults, metrics };
}

function createMetrics(referenceCases) {
  return {
    referenceRows: referenceCases.length,
    predictionRows: 0,
    extraPredictionRows: 0,
    missingPredictionRows: 0,
    jsonLineErrors: 0,
    outputParseableRows: 0,
    schemaValidRows: 0,
    evidenceValidRows: 0,
    referenceFindings: 0,
    predictedFindings: 0,
    schemaValidPredictedFindings: 0,
    evidenceValidPredictedFindings: 0,
    matchedFindings: 0,
    cleanReferenceRows: 0,
    cleanCorrectRows: 0,
    cleanFalsePositiveRows: 0,
    nonCleanReferenceRows: 0,
    nonCleanAnyPredictionRows: 0,
    latency: metricAccumulator(),
    cost: metricAccumulator(),
    precision: 0,
    recall: 0,
    f1: 0,
    cleanAccuracy: 0,
    cleanFalsePositiveRate: 0,
  };
}

function evaluateCase(predictionRow, reference, rowIndex) {
  if (predictionRow === null) {
    return {
      rowIndex,
      referenceId: reference.id,
      parseable: false,
      parseError: "missing prediction row",
      shapeValid: false,
      evidenceValid: false,
      predictedFindings: 0,
      schemaValidPredictedFindings: 0,
      evidenceValidPredictedFindings: 0,
      referenceFindings: referenceFindings(reference).length,
      matches: [],
      issues: [issue("prediction.missing-row", [])],
      latency: absentField(),
      cost: absentField(),
    };
  }
  if (typeof predictionRow !== "object" || Array.isArray(predictionRow)) {
    return {
      rowIndex,
      referenceId: reference.id,
      parseable: false,
      parseError: "invalid prediction JSONL row",
      shapeValid: false,
      evidenceValid: false,
      predictedFindings: 0,
      schemaValidPredictedFindings: 0,
      evidenceValidPredictedFindings: 0,
      referenceFindings: referenceFindings(reference).length,
      matches: [],
      issues: [issue("prediction.invalid-jsonl-row", [])],
      latency: absentField(),
      cost: absentField(),
    };
  }
  const extracted = extractPredictionOutput(predictionRow);
  const shape = extracted.parseable ? validateReviewShape(extracted.output) : invalidShape("unparseable-prediction");
  const evidence = extracted.parseable
    ? validateEvidenceAgainstPrompt(extracted.output, reference.promptInfo)
    : { valid: false, issueCount: 1, issues: [issue("evidence.unparseable-prediction", [])], findingResults: [] };
  const findings = Array.isArray(extracted.output?.findings) ? extracted.output.findings : [];
  const schemaValidFindingIndexes = new Set(
    findings
      .map((_, findingIndex) => findingIndex)
      .filter((findingIndex) => !shape.findingIssues.some((next) => next.path[1] === findingIndex)),
  );
  const evidenceValidFindingIndexes = new Set(
    evidence.findingResults.filter((next) => next.valid).map((next) => next.findingIndex),
  );
  const matches =
    extracted.parseable && shape.valid
      ? matchFindings(referenceFindings(reference), findings, evidenceValidFindingIndexes)
      : [];
  return {
    rowIndex,
    referenceId: reference.id,
    parseable: extracted.parseable,
    parseError: extracted.parseError ?? null,
    extractionSource: extracted.source,
    shapeValid: shape.valid,
    evidenceValid: evidence.valid,
    predictedFindings: findings.length,
    schemaValidPredictedFindings: schemaValidFindingIndexes.size,
    evidenceValidPredictedFindings: evidenceValidFindingIndexes.size,
    referenceFindings: referenceFindings(reference).length,
    matches,
    issues: [...shape.issues, ...evidence.issues],
    latency: extractMetricField(predictionRow, ["latencyMs", "latency_ms", "durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]),
    cost: extractMetricField(predictionRow, ["costUsd", "cost_usd", "cost"]),
  };
}

function evaluateMapModel(predictionInput, referenceCases) {
  const caseResults = [];
  const metrics = createMapMetrics(referenceCases);
  const rowCount = predictionInput.records.length;
  for (let index = 0; index < referenceCases.length; index += 1) {
    const reference = referenceCases[index];
    const record = predictionInput.records[index] ?? null;
    const result = evaluateMapCase(record?.value ?? null, reference, index);
    caseResults.push(result);
    accumulateMapMetrics(metrics, result);
  }
  metrics.predictionRows = rowCount;
  metrics.extraPredictionRows = Math.max(0, rowCount - referenceCases.length);
  metrics.missingPredictionRows = Math.max(0, referenceCases.length - rowCount);
  metrics.jsonLineErrors = predictionInput.jsonErrors.length;
  finalizeMapMetrics(metrics);
  return { caseResults, metrics };
}

function evaluateMapCase(predictionRow, reference, rowIndex) {
  if (predictionRow === null) {
    return missingMapCase(rowIndex, reference, "missing prediction row", "prediction.missing-row");
  }
  if (typeof predictionRow !== "object" || Array.isArray(predictionRow)) {
    return missingMapCase(rowIndex, reference, "invalid prediction JSONL row", "prediction.invalid-jsonl-row");
  }
  const extracted = extractPredictionOutput(predictionRow);
  const shape = extracted.parseable ? validateMapShape(extracted.output, reference.promptInfo) : invalidShape("unparseable-prediction");
  const features = Array.isArray(extracted.output?.features) ? extracted.output.features : [];
  const schemaValidFeatureIndexes = new Set(
    features
      .map((_, featureIndex) => featureIndex)
      .filter((featureIndex) => !shape.featureIssues?.some((next) => next.path[1] === featureIndex)),
  );
  const matches =
    extracted.parseable && shape.valid ? matchMapFeatures(referenceFeatures(reference), features) : { exact: [], near: [] };
  return {
    rowIndex,
    referenceId: reference.id,
    parseable: extracted.parseable,
    parseError: extracted.parseError ?? null,
    extractionSource: extracted.source,
    shapeValid: shape.valid,
    predictedFeatures: features.length,
    schemaValidPredictedFeatures: schemaValidFeatureIndexes.size,
    referenceFeatures: referenceFeatures(reference).length,
    exactMatches: matches.exact,
    nearMatches: matches.near,
    issues: shape.issues,
    latency: extractMetricField(predictionRow, ["latencyMs", "latency_ms", "durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]),
    cost: extractMetricField(predictionRow, ["costUsd", "cost_usd", "cost"]),
  };
}

function missingMapCase(rowIndex, reference, parseError, code) {
  return {
    rowIndex,
    referenceId: reference.id,
    parseable: false,
    parseError,
    shapeValid: false,
    predictedFeatures: 0,
    schemaValidPredictedFeatures: 0,
    referenceFeatures: referenceFeatures(reference).length,
    exactMatches: [],
    nearMatches: [],
    issues: [issue(code, [])],
    latency: absentField(),
    cost: absentField(),
  };
}

function createMapMetrics(referenceCases) {
  return {
    referenceRows: referenceCases.length,
    predictionRows: 0,
    extraPredictionRows: 0,
    missingPredictionRows: 0,
    jsonLineErrors: 0,
    outputParseableRows: 0,
    schemaValidRows: 0,
    referenceFeatures: referenceCases.reduce((sum, item) => sum + referenceFeatures(item).length, 0),
    predictedFeatures: 0,
    schemaValidPredictedFeatures: 0,
    exactMatchedFeatures: 0,
    nearMatchedFeatures: 0,
    latency: metricAccumulator(),
    cost: metricAccumulator(),
    exactPrecision: 0,
    exactRecall: 0,
    exactF1: 0,
    nearPrecision: 0,
    nearRecall: 0,
    nearF1: 0,
  };
}

function accumulateMapMetrics(metrics, result) {
  metrics.predictedFeatures += result.predictedFeatures;
  metrics.schemaValidPredictedFeatures += result.schemaValidPredictedFeatures;
  metrics.exactMatchedFeatures += result.exactMatches.length;
  metrics.nearMatchedFeatures += result.nearMatches.length;
  if (result.parseable) {
    metrics.outputParseableRows += 1;
  }
  if (result.shapeValid) {
    metrics.schemaValidRows += 1;
  }
  addMetric(metrics.latency, result.latency);
  addMetric(metrics.cost, result.cost);
}

function finalizeMapMetrics(metrics) {
  const exactMatches = metrics.exactMatchedFeatures;
  const nearInclusiveMatches = metrics.exactMatchedFeatures + metrics.nearMatchedFeatures;
  metrics.exactPrecision = ratio(exactMatches, metrics.predictedFeatures);
  metrics.exactRecall = ratio(exactMatches, metrics.referenceFeatures);
  metrics.exactF1 = f1(metrics.exactPrecision, metrics.exactRecall);
  metrics.nearPrecision = ratio(nearInclusiveMatches, metrics.predictedFeatures);
  metrics.nearRecall = ratio(nearInclusiveMatches, metrics.referenceFeatures);
  metrics.nearF1 = f1(metrics.nearPrecision, metrics.nearRecall);
  metrics.latency = finalizeMetric(metrics.latency);
  metrics.cost = finalizeMetric(metrics.cost);
}

function evaluateRevalidateModel(predictionInput, referenceCases) {
  const caseResults = [];
  const metrics = createRevalidateMetrics(referenceCases);
  const rowCount = predictionInput.records.length;
  for (let index = 0; index < referenceCases.length; index += 1) {
    const reference = referenceCases[index];
    const record = predictionInput.records[index] ?? null;
    const result = evaluateRevalidateCase(record?.value ?? null, reference, index);
    caseResults.push(result);
    accumulateRevalidateMetrics(metrics, result);
  }
  metrics.predictionRows = rowCount;
  metrics.extraPredictionRows = Math.max(0, rowCount - referenceCases.length);
  metrics.missingPredictionRows = Math.max(0, referenceCases.length - rowCount);
  metrics.jsonLineErrors = predictionInput.jsonErrors.length;
  finalizeRevalidateMetrics(metrics);
  return { caseResults, metrics };
}

function evaluateRevalidateCase(predictionRow, reference, rowIndex) {
  if (predictionRow === null) {
    return missingRevalidateCase(rowIndex, reference, "missing prediction row", "prediction.missing-row");
  }
  if (typeof predictionRow !== "object" || Array.isArray(predictionRow)) {
    return missingRevalidateCase(rowIndex, reference, "invalid prediction JSONL row", "prediction.invalid-jsonl-row");
  }
  const extracted = extractPredictionOutput(predictionRow);
  const shape = extracted.parseable ? validateRevalidateShape(extracted.output) : invalidShape("unparseable-prediction");
  const predictedOutcome = typeof extracted.output?.outcome === "string" ? extracted.output.outcome : null;
  const refOutcome = referenceOutcome(reference);
  const exactOutcomeMatch = shape.valid && predictedOutcome === refOutcome;
  const nearOutcomeMatch = shape.valid && nearRevalidateOutcomeMatch(refOutcome, predictedOutcome);
  return {
    rowIndex,
    referenceId: reference.id,
    parseable: extracted.parseable,
    parseError: extracted.parseError ?? null,
    extractionSource: extracted.source,
    shapeValid: shape.valid,
    referenceOutcome: refOutcome,
    predictedOutcome,
    exactOutcomeMatch,
    nearOutcomeMatch,
    issues: shape.issues,
    latency: extractMetricField(predictionRow, ["latencyMs", "latency_ms", "durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]),
    cost: extractMetricField(predictionRow, ["costUsd", "cost_usd", "cost"]),
  };
}

function missingRevalidateCase(rowIndex, reference, parseError, code) {
  return {
    rowIndex,
    referenceId: reference.id,
    parseable: false,
    parseError,
    shapeValid: false,
    referenceOutcome: referenceOutcome(reference),
    predictedOutcome: null,
    exactOutcomeMatch: false,
    nearOutcomeMatch: false,
    issues: [issue(code, [])],
    latency: absentField(),
    cost: absentField(),
  };
}

function createRevalidateMetrics(referenceCases) {
  const referenceOutcomeCounts = outcomeCounts(referenceCases.map(referenceOutcome));
  return {
    referenceRows: referenceCases.length,
    predictionRows: 0,
    extraPredictionRows: 0,
    missingPredictionRows: 0,
    jsonLineErrors: 0,
    outputParseableRows: 0,
    schemaValidRows: 0,
    referenceOutcomeCounts,
    predictedOutcomeCounts: outcomeCounts([]),
    exactOutcomeMatches: 0,
    nearOutcomeMatches: 0,
    exactOutcomeAccuracy: 0,
    nearOutcomeAccuracy: 0,
    latency: metricAccumulator(),
    cost: metricAccumulator(),
  };
}

function accumulateRevalidateMetrics(metrics, result) {
  if (result.parseable) {
    metrics.outputParseableRows += 1;
  }
  if (result.shapeValid) {
    metrics.schemaValidRows += 1;
  }
  if (result.predictedOutcome !== null) {
    metrics.predictedOutcomeCounts[result.predictedOutcome] = (metrics.predictedOutcomeCounts[result.predictedOutcome] ?? 0) + 1;
  }
  if (result.exactOutcomeMatch) {
    metrics.exactOutcomeMatches += 1;
  }
  if (result.nearOutcomeMatch) {
    metrics.nearOutcomeMatches += 1;
  }
  addMetric(metrics.latency, result.latency);
  addMetric(metrics.cost, result.cost);
}

function finalizeRevalidateMetrics(metrics) {
  metrics.exactOutcomeAccuracy = ratio(metrics.exactOutcomeMatches, metrics.referenceRows);
  metrics.nearOutcomeAccuracy = ratio(metrics.nearOutcomeMatches, metrics.referenceRows);
  metrics.latency = finalizeMetric(metrics.latency);
  metrics.cost = finalizeMetric(metrics.cost);
}

function referenceFindings(reference) {
  return Array.isArray(reference.output?.findings) ? reference.output.findings : [];
}

function referenceFeatures(reference) {
  return Array.isArray(reference.output?.features) ? reference.output.features : [];
}

function referenceOutcome(reference) {
  return typeof reference.output?.outcome === "string" ? reference.output.outcome : null;
}

function accumulateMetrics(metrics, result, reference) {
  const refCount = result.referenceFindings;
  metrics.referenceFindings += refCount;
  metrics.predictedFindings += result.predictedFindings;
  metrics.schemaValidPredictedFindings += result.schemaValidPredictedFindings;
  metrics.evidenceValidPredictedFindings += result.evidenceValidPredictedFindings;
  metrics.matchedFindings += result.matches.length;
  if (result.parseable) {
    metrics.outputParseableRows += 1;
  }
  if (result.shapeValid) {
    metrics.schemaValidRows += 1;
  }
  if (result.evidenceValid) {
    metrics.evidenceValidRows += 1;
  }
  if (refCount === 0) {
    metrics.cleanReferenceRows += 1;
    if (result.predictedFindings === 0) {
      metrics.cleanCorrectRows += 1;
    } else {
      metrics.cleanFalsePositiveRows += 1;
    }
  } else {
    metrics.nonCleanReferenceRows += 1;
    if (result.predictedFindings > 0) {
      metrics.nonCleanAnyPredictionRows += 1;
    }
  }
  addMetric(metrics.latency, result.latency);
  addMetric(metrics.cost, result.cost);
  void reference;
}

function finalizeMetrics(metrics) {
  metrics.precision = ratio(metrics.matchedFindings, metrics.predictedFindings);
  metrics.recall = ratio(metrics.matchedFindings, metrics.referenceFindings);
  metrics.f1 =
    metrics.precision + metrics.recall === 0
      ? 0
      : roundMetric((2 * metrics.precision * metrics.recall) / (metrics.precision + metrics.recall));
  metrics.cleanAccuracy = ratio(metrics.cleanCorrectRows, metrics.cleanReferenceRows);
  metrics.cleanFalsePositiveRate = ratio(metrics.cleanFalsePositiveRows, metrics.cleanReferenceRows);
  metrics.latency = finalizeMetric(metrics.latency);
  metrics.cost = finalizeMetric(metrics.cost);
}

function matchFindings(referenceItems, predictedItems, evidenceValidFindingIndexes) {
  const candidates = [];
  for (let predictionIndex = 0; predictionIndex < predictedItems.length; predictionIndex += 1) {
    if (!evidenceValidFindingIndexes.has(predictionIndex)) {
      continue;
    }
    for (let referenceIndex = 0; referenceIndex < referenceItems.length; referenceIndex += 1) {
      const score = findingScore(referenceItems[referenceIndex], predictedItems[predictionIndex]);
      if (score.total >= 0.55) {
        candidates.push({ referenceIndex, predictionIndex, score: score.total, reasons: score.reasons });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.predictionIndex - right.predictionIndex ||
      left.referenceIndex - right.referenceIndex,
  );
  const usedReferences = new Set();
  const usedPredictions = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedReferences.has(candidate.referenceIndex) || usedPredictions.has(candidate.predictionIndex)) {
      continue;
    }
    usedReferences.add(candidate.referenceIndex);
    usedPredictions.add(candidate.predictionIndex);
    matches.push(candidate);
  }
  matches.sort((left, right) => left.referenceIndex - right.referenceIndex || left.predictionIndex - right.predictionIndex);
  return matches;
}

function matchMapFeatures(referenceItems, predictedItems) {
  const exactCandidates = [];
  const nearCandidates = [];
  for (let predictionIndex = 0; predictionIndex < predictedItems.length; predictionIndex += 1) {
    for (let referenceIndex = 0; referenceIndex < referenceItems.length; referenceIndex += 1) {
      const score = mapFeatureScore(referenceItems[referenceIndex], predictedItems[predictionIndex]);
      if (score.exact) {
        exactCandidates.push({
          referenceIndex,
          predictionIndex,
          score: 1,
          exactPriority: score.exactPriority ?? 1,
          reasons: score.reasons,
        });
        continue;
      }
      if (score.score >= 0.2) {
        nearCandidates.push({ referenceIndex, predictionIndex, score: score.score, reasons: score.reasons });
      }
    }
  }
  exactCandidates.sort(
    (left, right) =>
      left.exactPriority - right.exactPriority ||
      left.predictionIndex - right.predictionIndex ||
      left.referenceIndex - right.referenceIndex,
  );
  const uniqueExact = [];
  const usedExactReferences = new Set();
  const usedExactPredictions = new Set();
  for (const match of exactCandidates) {
    if (usedExactReferences.has(match.referenceIndex) || usedExactPredictions.has(match.predictionIndex)) {
      continue;
    }
    usedExactReferences.add(match.referenceIndex);
    usedExactPredictions.add(match.predictionIndex);
    uniqueExact.push(match);
  }
  nearCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.predictionIndex - right.predictionIndex ||
      left.referenceIndex - right.referenceIndex,
  );
  const near = [];
  const usedReferences = new Set([...usedExactReferences]);
  const usedPredictions = new Set([...usedExactPredictions]);
  for (const candidate of nearCandidates) {
    if (usedReferences.has(candidate.referenceIndex) || usedPredictions.has(candidate.predictionIndex)) {
      continue;
    }
    usedReferences.add(candidate.referenceIndex);
    usedPredictions.add(candidate.predictionIndex);
    near.push(candidate);
  }
  uniqueExact.sort((left, right) => left.referenceIndex - right.referenceIndex || left.predictionIndex - right.predictionIndex);
  near.sort((left, right) => left.referenceIndex - right.referenceIndex || left.predictionIndex - right.predictionIndex);
  return { exact: uniqueExact, near };
}

function mapFeatureScore(reference, prediction) {
  if (
    typeof reference?.featureId === "string" &&
    reference.featureId !== "" &&
    reference.featureId === prediction?.featureId
  ) {
    return { exact: true, exactPriority: 0, score: 1, reasons: ["feature-id-exact"] };
  }
  const referenceOwned = featurePathSet(reference, ["ownedFiles"]);
  const predictionOwned = featurePathSet(prediction, ["ownedFiles"]);
  const referenceAll = featurePathSet(reference, ["entrypoints", "ownedFiles", "contextFiles", "tests"]);
  const predictionAll = featurePathSet(prediction, ["entrypoints", "ownedFiles", "contextFiles", "tests"]);
  if (setEquals(referenceOwned, predictionOwned) && referenceOwned.size > 0) {
    return { exact: true, exactPriority: 1, score: 1, reasons: ["owned-files-exact"] };
  }
  const ownedOverlap = overlapStats(referenceOwned, predictionOwned);
  const allOverlap = overlapStats(referenceAll, predictionAll);
  const score = roundMetric(Math.max(ownedOverlap.jaccard, allOverlap.jaccard * 0.8));
  const reasons = [];
  if (ownedOverlap.intersection > 0) {
    reasons.push(`owned-overlap:${roundMetric(ownedOverlap.jaccard)}`);
  }
  if (allOverlap.intersection > 0) {
    reasons.push(`path-overlap:${roundMetric(allOverlap.jaccard)}`);
  }
  return { exact: false, score, reasons };
}

function featurePathSet(feature, keys) {
  const paths = [];
  for (const key of keys) {
    const refs = Array.isArray(feature?.[key]) ? feature[key] : [];
    for (const ref of refs) {
      if (typeof ref?.path === "string") {
        paths.push(normalizePath(ref.path));
      }
    }
  }
  return new Set(paths.filter((pathValue) => pathValue !== ""));
}

function setEquals(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}

function overlapStats(left, right) {
  if (left.size === 0 && right.size === 0) {
    return { intersection: 0, union: 0, jaccard: 0 };
  }
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }
  const union = new Set([...left, ...right]).size;
  return { intersection, union, jaccard: union === 0 ? 0 : intersection / union };
}

function nearRevalidateOutcomeMatch(referenceOutcomeValue, predictedOutcomeValue) {
  if (referenceOutcomeValue === predictedOutcomeValue) {
    return true;
  }
  const referenceClass = revalidateOutcomeClass(referenceOutcomeValue);
  const predictedClass = revalidateOutcomeClass(predictedOutcomeValue);
  return referenceClass !== null && referenceClass === predictedClass;
}

function revalidateOutcomeClass(value) {
  if (value === "open" || value === "uncertain") {
    return "needs-attention";
  }
  if (value === "fixed" || value === "false-positive") {
    return "not-open";
  }
  return null;
}

function findingScore(reference, prediction) {
  const evidence = evidenceScore(reference.evidence, prediction.evidence);
  const title = titleSimilarity(reference.title, prediction.title);
  const category = reference.category === prediction.category ? 0.15 : 0;
  const severity = reference.severity === prediction.severity ? 0.1 : 0;
  const total = roundMetric(Math.min(1, evidence.score + Math.min(0.2, title * 0.2) + category + severity));
  const reasons = [];
  if (evidence.score > 0) {
    reasons.push(evidence.reason);
  }
  if (title > 0) {
    reasons.push(`title:${roundMetric(title)}`);
  }
  if (category > 0) {
    reasons.push("category");
  }
  if (severity > 0) {
    reasons.push("severity");
  }
  return { total, reasons };
}

function evidenceScore(referenceEvidence, predictionEvidence) {
  let best = { score: 0, reason: "none" };
  for (const left of Array.isArray(referenceEvidence) ? referenceEvidence : []) {
    for (const right of Array.isArray(predictionEvidence) ? predictionEvidence : []) {
      const score = evidencePairScore(left, right);
      if (score.score > best.score) {
        best = score;
      }
    }
  }
  return best;
}

function evidencePairScore(reference, prediction) {
  if (normalizePath(reference?.path ?? "") !== normalizePath(prediction?.path ?? "")) {
    return { score: 0, reason: "none" };
  }
  const left = normalizedEvidenceRange(reference);
  const right = normalizedEvidenceRange(prediction);
  if (left.startLine !== null && right.startLine !== null) {
    const overlap = Math.max(0, Math.min(left.endLine, right.endLine) - Math.max(left.startLine, right.startLine) + 1);
    if (overlap > 0) {
      const leftLength = left.endLine - left.startLine + 1;
      const rightLength = right.endLine - right.startLine + 1;
      const overlapRatio = overlap / Math.max(leftLength, rightLength, 1);
      return { score: 0.55 + Math.min(0.15, overlapRatio * 0.15), reason: "evidence-overlap" };
    }
    const distance =
      right.endLine < left.startLine ? left.startLine - right.endLine : right.startLine - left.endLine;
    if (distance <= 5) {
      return { score: 0.4, reason: "evidence-nearby" };
    }
    if (distance <= 20) {
      return { score: 0.25, reason: "evidence-same-path" };
    }
  }
  return { score: 0.2, reason: "evidence-same-path" };
}

function titleSimilarity(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function titleTokens(value) {
  if (typeof value !== "string") {
    return new Set();
  }
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function extractMetricField(row, keys) {
  const values = [];
  collectMetricValues(row, keys, values, 0);
  if (values.length === 0) {
    return absentField();
  }
  const value = values[0];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { present: true, valid: false, value: null };
  }
  return { present: true, valid: true, value };
}

function collectMetricValues(value, keys, values, depth) {
  if (values.length > 0 || depth > 3 || !value || typeof value !== "object") {
    return;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      values.push(value[key]);
      return;
    }
  }
  for (const key of ["usage", "metrics", "timing", "metadata"]) {
    if (value[key] && typeof value[key] === "object") {
      collectMetricValues(value[key], keys, values, depth + 1);
    }
  }
}

function absentField() {
  return { present: false, valid: false, value: null };
}

function metricAccumulator() {
  return { presentRows: 0, validRows: 0, invalidRows: 0, sum: 0, min: null, max: null };
}

function addMetric(accumulator, field) {
  if (!field.present) {
    return;
  }
  accumulator.presentRows += 1;
  if (!field.valid) {
    accumulator.invalidRows += 1;
    return;
  }
  accumulator.validRows += 1;
  accumulator.sum += field.value;
  accumulator.min = accumulator.min === null ? field.value : Math.min(accumulator.min, field.value);
  accumulator.max = accumulator.max === null ? field.value : Math.max(accumulator.max, field.value);
}

function finalizeMetric(accumulator) {
  return {
    presentRows: accumulator.presentRows,
    validRows: accumulator.validRows,
    invalidRows: accumulator.invalidRows,
    sum: roundMetric(accumulator.sum),
    avg: accumulator.validRows === 0 ? null : roundMetric(accumulator.sum / accumulator.validRows),
    min: accumulator.min === null ? null : roundMetric(accumulator.min),
    max: accumulator.max === null ? null : roundMetric(accumulator.max),
  };
}

function buildPairwiseComparisons(models, referenceCases, operation) {
  const comparisons = [];
  for (let leftIndex = 0; leftIndex < models.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < models.length; rightIndex += 1) {
      const left = models[leftIndex];
      const right = models[rightIndex];
      comparisons.push(comparePair(left, right, referenceCases, operation));
    }
  }
  return comparisons;
}

function comparePair(left, right, referenceCases, operation) {
  if (operation === "map") {
    return compareMapPair(left, right);
  }
  if (operation === "revalidate") {
    return compareRevalidatePair(left, right);
  }
  const findingStats = {
    bothMatched: 0,
    leftOnlyMatched: 0,
    rightOnlyMatched: 0,
    neitherMatched: 0,
  };
  const cleanStats = {
    bothCleanCorrect: 0,
    leftOnlyCleanCorrect: 0,
    rightOnlyCleanCorrect: 0,
    neitherCleanCorrect: 0,
  };
  for (let rowIndex = 0; rowIndex < referenceCases.length; rowIndex += 1) {
    const reference = referenceCases[rowIndex];
    const leftMatches = new Set(left.caseResults[rowIndex]?.matches.map((match) => match.referenceIndex) ?? []);
    const rightMatches = new Set(right.caseResults[rowIndex]?.matches.map((match) => match.referenceIndex) ?? []);
    for (let referenceIndex = 0; referenceIndex < referenceFindings(reference).length; referenceIndex += 1) {
      const inLeft = leftMatches.has(referenceIndex);
      const inRight = rightMatches.has(referenceIndex);
      if (inLeft && inRight) {
        findingStats.bothMatched += 1;
      } else if (inLeft) {
        findingStats.leftOnlyMatched += 1;
      } else if (inRight) {
        findingStats.rightOnlyMatched += 1;
      } else {
        findingStats.neitherMatched += 1;
      }
    }
    if (referenceFindings(reference).length === 0) {
      const leftClean = (left.caseResults[rowIndex]?.predictedFindings ?? 1) === 0;
      const rightClean = (right.caseResults[rowIndex]?.predictedFindings ?? 1) === 0;
      if (leftClean && rightClean) {
        cleanStats.bothCleanCorrect += 1;
      } else if (leftClean) {
        cleanStats.leftOnlyCleanCorrect += 1;
      } else if (rightClean) {
        cleanStats.rightOnlyCleanCorrect += 1;
      } else {
        cleanStats.neitherCleanCorrect += 1;
      }
    }
  }
  return {
    left: left.label,
    right: right.label,
    metricDeltas: {
      precision: roundMetric(left.metrics.precision - right.metrics.precision),
      recall: roundMetric(left.metrics.recall - right.metrics.recall),
      f1: roundMetric(left.metrics.f1 - right.metrics.f1),
      cleanAccuracy: roundMetric(left.metrics.cleanAccuracy - right.metrics.cleanAccuracy),
      avgLatency: nullableDelta(left.metrics.latency.avg, right.metrics.latency.avg),
      totalCost: roundMetric(left.metrics.cost.sum - right.metrics.cost.sum),
    },
    findingOverlap: findingStats,
    cleanFeatureComparison: cleanStats,
  };
}

function compareMapPair(left, right) {
  return {
    left: left.label,
    right: right.label,
    metricDeltas: {
      exactPrecision: roundMetric(left.metrics.exactPrecision - right.metrics.exactPrecision),
      exactRecall: roundMetric(left.metrics.exactRecall - right.metrics.exactRecall),
      exactF1: roundMetric(left.metrics.exactF1 - right.metrics.exactF1),
      nearPrecision: roundMetric(left.metrics.nearPrecision - right.metrics.nearPrecision),
      nearRecall: roundMetric(left.metrics.nearRecall - right.metrics.nearRecall),
      nearF1: roundMetric(left.metrics.nearF1 - right.metrics.nearF1),
      avgLatency: nullableDelta(left.metrics.latency.avg, right.metrics.latency.avg),
      totalCost: roundMetric(left.metrics.cost.sum - right.metrics.cost.sum),
    },
  };
}

function compareRevalidatePair(left, right) {
  return {
    left: left.label,
    right: right.label,
    metricDeltas: {
      exactOutcomeAccuracy: roundMetric(left.metrics.exactOutcomeAccuracy - right.metrics.exactOutcomeAccuracy),
      nearOutcomeAccuracy: roundMetric(left.metrics.nearOutcomeAccuracy - right.metrics.nearOutcomeAccuracy),
      avgLatency: nullableDelta(left.metrics.latency.avg, right.metrics.latency.avg),
      totalCost: roundMetric(left.metrics.cost.sum - right.metrics.cost.sum),
    },
  };
}

function referenceSummary(referenceInput, referenceCases, operation) {
  if (operation === "map") {
    return mapReferenceSummary(referenceInput, referenceCases);
  }
  if (operation === "revalidate") {
    return revalidateReferenceSummary(referenceInput, referenceCases);
  }
  const parseableRows = referenceCases.filter((item) => item.parse.ok).length;
  const schemaValidRows = referenceCases.filter((item) => item.shape.valid).length;
  const findingCount = referenceCases.reduce((sum, item) => sum + referenceFindings(item).length, 0);
  return {
    path: referenceInput.path,
    rows: referenceCases.length,
    jsonLineErrors: referenceInput.jsonErrors.length,
    outputParseableRows: parseableRows,
    schemaValidRows,
    cleanRows: referenceCases.filter((item) => referenceFindings(item).length === 0).length,
    findingRows: referenceCases.filter((item) => referenceFindings(item).length > 0).length,
    findings: findingCount,
  };
}

function mapReferenceSummary(referenceInput, referenceCases) {
  const parseableRows = referenceCases.filter((item) => item.parse.ok).length;
  const schemaValidRows = referenceCases.filter((item) => item.shape.valid).length;
  return {
    path: referenceInput.path,
    operation: "map",
    rows: referenceCases.length,
    jsonLineErrors: referenceInput.jsonErrors.length,
    outputParseableRows: parseableRows,
    schemaValidRows,
    features: referenceCases.reduce((sum, item) => sum + referenceFeatures(item).length, 0),
  };
}

function revalidateReferenceSummary(referenceInput, referenceCases) {
  const parseableRows = referenceCases.filter((item) => item.parse.ok).length;
  const schemaValidRows = referenceCases.filter((item) => item.shape.valid).length;
  return {
    path: referenceInput.path,
    operation: "revalidate",
    rows: referenceCases.length,
    jsonLineErrors: referenceInput.jsonErrors.length,
    outputParseableRows: parseableRows,
    schemaValidRows,
    outcomeCounts: outcomeCounts(referenceCases.map(referenceOutcome)),
  };
}

function modelSummary(model) {
  return {
    label: model.label,
    path: model.path,
    rows: model.metrics.predictionRows,
    jsonLineErrors: model.metrics.jsonLineErrors,
    metrics: model.metrics,
    issueSummary: summarizeIssues(model.caseResults),
  };
}

function summarizeIssues(caseResults) {
  const counts = new Map();
  for (const result of caseResults) {
    if (!result.parseable && result.parseError !== null) {
      increment(counts, "prediction.output-json-parse");
    }
    for (const nextIssue of result.issues) {
      increment(counts, nextIssue.code);
    }
    if (result.latency.present && !result.latency.valid) {
      increment(counts, "latency.invalid");
    }
    if (result.cost.present && !result.cost.valid) {
      increment(counts, "cost.invalid");
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function issue(code, pathValue, extra = {}) {
  return { code, path: pathValue, ...extra };
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : roundMetric(numerator / denominator);
}

function f1(precision, recall) {
  return precision + recall === 0 ? 0 : roundMetric((2 * precision * recall) / (precision + recall));
}

function outcomeCounts(values) {
  const counts = Object.fromEntries([...revalidateOutcomes].map((outcome) => [outcome, 0]));
  for (const value of values) {
    if (typeof value === "string") {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return counts;
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function nullableDelta(left, right) {
  return left === null || right === null ? null : roundMetric(left - right);
}

function normalizePath(value) {
  return String(value).replace(/\\/gu, "/").replace(/^\.\/+/u, "");
}

function isSafeRelativePath(value) {
  return value !== "" && !value.startsWith("../") && !path.isAbsolute(value);
}

function compactWhitespace(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  if (options.reference === null) {
    throw new Error("--reference is required");
  }
  if (options.predictions.length === 0) {
    throw new Error("at least one --prediction is required");
  }

  const referenceJsonl = await readJsonl(options.reference);
  const referenceInput = { path: options.reference, ...referenceJsonl };
  const operation = resolveOperation(options.operation, referenceJsonl.records);
  const referenceCases = referenceJsonl.records.map((record, index) => extractReference(record.value, index, operation));
  const modelReports = [];
  for (const prediction of options.predictions) {
    const predictionInput = await readJsonl(prediction.path);
    const evaluated = evaluateModel(predictionInput, referenceCases, operation);
    modelReports.push({
      label: prediction.label,
      path: prediction.path,
      caseResults: evaluated.caseResults,
      metrics: evaluated.metrics,
    });
  }

  const report = {
    schemaVersion: 1,
    deterministic: true,
    operation,
    inputs: {
      reference: options.reference,
      predictions: options.predictions,
      operation: options.operation,
    },
    reference: referenceSummary(referenceInput, referenceCases, operation),
    models: modelReports.map(modelSummary),
    pairwiseComparisons: buildPairwiseComparisons(modelReports, referenceCases, operation),
  };
  const json = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out === null) {
    process.stdout.write(json);
  } else {
    await writeFile(options.out, json);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`evaluate-clawpatch-predictions: ${message}\n`);
  process.exitCode = 1;
});
