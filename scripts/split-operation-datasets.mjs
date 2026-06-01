#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "datasets", "clawpatch-gemma-v0");
const operations = new Set(["map", "revalidate"]);

function parseJsonl(text) {
  return text
    .split(/\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

for (const operation of operations) {
  const outputDir = path.join(root, "datasets", `clawpatch-gemma-${operation}-v0`);
  await mkdir(outputDir, { recursive: true });

  const summary = {
    schemaVersion: 1,
    operation,
    sourceDataset: "ixianbride/clawpatch-gemma-review-v0",
    splits: {},
  };

  for (const split of ["train", "validation", "test", "hard_boundary", "all"]) {
    const rows = parseJsonl(await readFile(path.join(sourceDir, `${split}.jsonl`), "utf8")).filter(
      (row) => row.metadata?.operation === operation,
    );
    summary.splits[split] = rows.length;
    await writeFile(path.join(outputDir, `${split}.jsonl`), jsonl(rows));
  }

  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    path.join(outputDir, "README.md"),
    `---
license: other
task_categories:
- text-generation
language:
- en
pretty_name: Clawpatch Gemma ${operation} v0
size_categories:
- n<1K
---

# Clawpatch Gemma ${operation} v0

Private operation-specific subset derived from \`ixianbride/clawpatch-gemma-review-v0\`.

\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`
`,
  );

  console.log(JSON.stringify(summary));
}
