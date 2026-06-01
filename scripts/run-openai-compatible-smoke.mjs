#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const usage = `Usage: node scripts/run-openai-compatible-smoke.mjs [options]

Run a live Clawpatch map/review/revalidate smoke through the openai-compatible
provider. This script requires a real endpoint; it does not start or mock one.

Required environment:
  CLAWPATCH_OPENAI_COMPATIBLE_BASE_URL
  CLAWPATCH_OPENAI_COMPATIBLE_MODEL

Optional environment:
  CLAWPATCH_OPENAI_COMPATIBLE_API_KEY
  CLAWPATCH_OPENAI_COMPATIBLE_TIMEOUT_MS
  CLAWPATCH_OPENAI_COMPATIBLE_MAX_TOKENS

Options:
  --target-root <path>   Repository to smoke. Default: teacher-runs/click
  --capture-dir <path>   Capture output dir. Default: captures/<timestamp>-openai-compatible-smoke
  --feature <id>         Feature id to review after map. Default: first feature after map.
  --out <path>           Write aggregate JSON report. Default: <capture-dir>/openai-compatible-smoke-report.json
  --help                 Show this help text.

The report contains commands, exit codes, counts, and paths only. It does not
print prompts, raw provider output, captures, or secrets.
`;

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const targetRoot = path.resolve(options.targetRoot ?? path.join(root, "teacher-runs", "click"));
const captureDir = path.resolve(
  options.captureDir ?? path.join(root, "captures", `${timestamp()}-openai-compatible-smoke`),
);
const reportPath = path.resolve(options.out ?? path.join(captureDir, "openai-compatible-smoke-report.json"));
const clawpatchBin = path.join(root, "vendor", "clawpatch", "dist", "cli.js");

const requiredEnv = ["CLAWPATCH_OPENAI_COMPATIBLE_BASE_URL", "CLAWPATCH_OPENAI_COMPATIBLE_MODEL"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  throw new Error(`missing required environment: ${missingEnv.join(", ")}`);
}
if (!existsSync(targetRoot)) {
  throw new Error(`target root does not exist: ${targetRoot}`);
}
if (!existsSync(clawpatchBin)) {
  throw new Error(`missing built Clawpatch CLI: ${clawpatchBin}; run pnpm build in vendor/clawpatch first`);
}

await mkdir(captureDir, { recursive: true });

const env = {
  ...process.env,
  CLAWPATCH_PROVIDER: "openai-compatible",
};

const commands = [];
commands.push(
  runStep("map", [
    "node",
    clawpatchBin,
    "--root",
    targetRoot,
    "map",
    "--source",
    "agent",
    "--capture-dir",
    captureDir,
  ], env),
);

const featureId = options.feature ?? firstFeatureId(targetRoot);
commands.push(
  runStep("review", [
    "node",
    clawpatchBin,
    "--root",
    targetRoot,
    "review",
    "--feature",
    featureId,
    "--limit",
    "1",
    "--jobs",
    "1",
    "--capture-dir",
    captureDir,
  ], env),
);

commands.push(
  runStep("revalidate", [
    "node",
    clawpatchBin,
    "--root",
    targetRoot,
    "revalidate",
    "--all",
    "--limit",
    "1",
    "--capture-dir",
    captureDir,
  ], env),
);

const summary = captureSummary(captureDir);
const report = {
  schemaVersion: 1,
  provider: "openai-compatible",
  targetRoot,
  captureDir,
  reportPath,
  featureId,
  environmentPresence: {
    baseUrl: Boolean(process.env["CLAWPATCH_OPENAI_COMPATIBLE_BASE_URL"]),
    model: Boolean(process.env["CLAWPATCH_OPENAI_COMPATIBLE_MODEL"]),
    apiKey: Boolean(process.env["CLAWPATCH_OPENAI_COMPATIBLE_API_KEY"]),
  },
  commands,
  summary,
  passed: commands.every((command) => command.exitCode === 0) && (summary.byOperation.revalidate ?? 0) > 0,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ passed: report.passed, reportPath, summary }, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    targetRoot: null,
    captureDir: null,
    feature: null,
    out: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--target-root") {
      parsed.targetRoot = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--capture-dir") {
      parsed.captureDir = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--feature") {
      parsed.feature = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--out") {
      parsed.out = requiredValue(argv, (index += 1), arg);
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

function runStep(name, args, env) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: root,
    env,
    encoding: "utf8",
  });
  return {
    name,
    command: args.map((arg) => redactArg(arg)),
    exitCode: result.status ?? 1,
    signal: result.signal,
  };
}

function redactArg(value) {
  return value.includes("CLAWPATCH_OPENAI_COMPATIBLE_API_KEY") ? "<redacted>" : value;
}

function firstFeatureId(targetRoot) {
  const featuresDir = path.join(targetRoot, ".clawpatch", "features");
  if (!existsSync(featuresDir)) {
    throw new Error(`missing features directory after map: ${featuresDir}`);
  }
  const featureFile = readdirSync(featuresDir)
    .filter((file) => file.endsWith(".json"))
    .toSorted()[0];
  if (featureFile === undefined) {
    throw new Error("map produced no feature files");
  }
  return featureFile.slice(0, -".json".length);
}

function captureSummary(captureDir) {
  const capturesPath = path.join(captureDir, "captures.jsonl");
  if (!existsSync(capturesPath)) {
    return { captures: 0, accepted: 0, rejected: 0, byOperation: {} };
  }
  const rows = readFileSync(capturesPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const byOperation = {};
  for (const row of rows) {
    const operation = typeof row.operation === "string" ? row.operation : "unknown";
    byOperation[operation] = (byOperation[operation] ?? 0) + 1;
  }
  return {
    captures: rows.length,
    accepted: rows.filter((row) => row.status === "accepted").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
    metadataOnly: rows.filter((row) => row.redactionState?.metadataOnly === true).length,
    redacted: rows.filter((row) => row.redactionState?.redacted === true).length,
    byOperation,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/u, "Z");
}
