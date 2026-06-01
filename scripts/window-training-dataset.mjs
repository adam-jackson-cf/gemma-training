#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const inputDir = path.join(root, "datasets", "clawpatch-gemma-v0");
const outputDir = path.join(root, "datasets", "clawpatch-gemma-windowed-v0");
const splits = ["train", "validation", "test", "hard_boundary", "all"];
const maxUserChars = 4_000;
const evidenceRadius = 10;
const cleanFileLineBudget = 28;

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

function jsonl(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function parseAssistant(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function evidenceItems(assistant) {
  if (!Array.isArray(assistant?.findings)) {
    return [];
  }
  return assistant.findings.flatMap((finding) => {
    if (!Array.isArray(finding.evidence)) {
      return [];
    }
    return finding.evidence
      .filter((item) => typeof item?.path === "string")
      .map((item) => ({
        path: item.path,
        startLine: Number.isInteger(item.startLine) ? item.startLine : 1,
        endLine: Number.isInteger(item.endLine) ? item.endLine : item.startLine,
      }));
  });
}

function splitFilesSection(prompt) {
  const marker = "\nFiles:\n";
  const index = prompt.indexOf(marker);
  if (index === -1) {
    return { prelude: prompt, fileBlocks: [] };
  }
  return {
    prelude: prompt.slice(0, index + marker.length),
    fileBlocks: parseFileBlocks(prompt.slice(index + marker.length)),
  };
}

function parseFileBlocks(filesText) {
  const matches = [...filesText.matchAll(/^--- (.+?) \((.+?)\)\n/gmu)];
  return matches.map((match, index) => {
    const start = match.index;
    const next = matches[index + 1]?.index ?? filesText.length;
    const bodyStart = start + match[0].length;
    return {
      path: match[1],
      descriptor: match[2],
      header: match[0].trimEnd(),
      body: filesText.slice(bodyStart, next).trimEnd(),
    };
  });
}

function parseNumberedLines(body) {
  return body.split(/\n/u).map((line) => {
    const match = /^(\d+) \| ?(.*)$/u.exec(line);
    return {
      number: match ? Number(match[1]) : null,
      text: line,
    };
  });
}

function renderLineSlice(block, startLine, endLine) {
  const lines = parseNumberedLines(block.body);
  const selected = lines.filter((line) => {
    if (line.number === null) {
      return false;
    }
    return line.number >= startLine && line.number <= endLine;
  });
  if (selected.length === 0) {
    return "";
  }
  return `${block.header}\n${selected.map((line) => line.text).join("\n")}`;
}

function renderEvidenceBlocks(blocks, evidences) {
  const rendered = [];
  const used = new Set();
  for (const evidence of evidences) {
    const block = blocks.find((candidate) => candidate.path === evidence.path);
    if (!block) {
      continue;
    }
    const start = Math.max(1, evidence.startLine - evidenceRadius);
    const end = Math.max(evidence.endLine, evidence.startLine) + evidenceRadius;
    const key = `${block.path}:${start}:${end}`;
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    const slice = renderLineSlice(block, start, end);
    if (slice) {
      rendered.push(slice);
    }
  }
  return rendered;
}

function renderCleanBlocks(blocks) {
  const rendered = [];
  let remaining = cleanFileLineBudget;
  for (const block of blocks) {
    if (remaining <= 0) {
      break;
    }
    const lines = parseNumberedLines(block.body)
      .filter((line) => line.number !== null)
      .slice(0, remaining);
    if (lines.length === 0) {
      continue;
    }
    rendered.push(`${block.header}\n${lines.map((line) => line.text).join("\n")}`);
    remaining -= lines.length;
  }
  return rendered;
}

function clampPrelude(prelude, budget) {
  if (prelude.length <= budget) {
    return prelude;
  }
  const jsonShapeIndex = prelude.indexOf("\nJSON shape:");
  if (jsonShapeIndex === -1) {
    return `${prelude.slice(0, budget)}\n[Window note: prelude truncated to fit training budget.]\n`;
  }
  const headBudget = Math.max(1_000, Math.floor(budget * 0.55));
  const tailBudget = Math.max(1_000, budget - headBudget);
  return `${prelude.slice(0, headBudget)}\n[Window note: middle prompt context omitted to fit training budget.]\n${prelude.slice(Math.max(jsonShapeIndex, prelude.length - tailBudget))}`;
}

function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end -= Math.max(1, Math.ceil((Buffer.byteLength(text.slice(0, end), "utf8") - maxBytes) / 4));
  }
  return text.slice(0, end);
}

function windowPrompt(prompt, assistant) {
  if (prompt.length <= maxUserChars) {
    return {
      prompt,
      windowed: false,
      omittedChars: 0,
      windowStrategy: "unchanged",
      retainedFileBlocks: null,
    };
  }

  const { prelude, fileBlocks } = splitFilesSection(prompt);
  if (fileBlocks.length === 0) {
    const next = truncateUtf8(clampPrelude(prompt, maxUserChars), maxUserChars);
    return {
      prompt: next,
      windowed: next !== prompt,
      omittedChars: Math.max(0, prompt.length - next.length),
      windowStrategy: "prompt-clamp-no-files-section",
      retainedFileBlocks: 0,
    };
  }

  const evidences = evidenceItems(assistant);
  const snippets = evidences.length > 0 ? renderEvidenceBlocks(fileBlocks, evidences) : renderCleanBlocks(fileBlocks);
  const fileText = snippets.length > 0 ? `${snippets.join("\n\n")}\n` : "";
  const preludeBudget = Math.max(4_000, maxUserChars - fileText.length);
  const nextPrelude = clampPrelude(prelude, preludeBudget);
  let nextPrompt = `${nextPrelude}${fileText}`;
  if (nextPrompt.length > maxUserChars) {
    const note = "\n[Window note: trailing file context omitted to fit training budget.]\n";
    nextPrompt = `${truncateUtf8(nextPrompt, Math.max(0, maxUserChars - Buffer.byteLength(note, "utf8")))}${note}`;
  }
  nextPrompt = truncateUtf8(nextPrompt, maxUserChars);

  return {
    prompt: nextPrompt,
    windowed: true,
    omittedChars: Math.max(0, prompt.length - nextPrompt.length),
    windowStrategy: evidences.length > 0 ? "evidence-centered-file-window" : "clean-review-head-file-window",
    retainedFileBlocks: snippets.length,
  };
}

function windowRow(row) {
  const assistant = parseAssistant(row.messages.at(-1)?.content);
  const originalPrompt = row.messages[1]?.content ?? "";
  const window = windowPrompt(originalPrompt, assistant);
  return {
    ...row,
    messages: [
      row.messages[0],
      {
        ...row.messages[1],
        content: window.prompt,
      },
      row.messages[2],
    ],
    metadata: {
      ...row.metadata,
      windowed: window.windowed,
      windowStrategy: window.windowStrategy,
      originalPromptBytes: row.metadata?.promptBytes ?? Buffer.byteLength(originalPrompt, "utf8"),
      windowPromptBytes: Buffer.byteLength(window.prompt, "utf8"),
      omittedPromptChars: window.omittedChars,
      retainedFileBlocks: window.retainedFileBlocks ?? -1,
    },
  };
}

function summarize(rowsBySplit) {
  const counts = {};
  for (const [split, rows] of Object.entries(rowsBySplit)) {
    counts[split] = {
      total: rows.length,
      windowed: rows.filter((row) => row.metadata.windowed).length,
      maxPromptBytes: Math.max(...rows.map((row) => row.metadata.windowPromptBytes), 0),
      byOperation: {},
      byWindowStrategy: {},
    };
    for (const row of rows) {
      counts[split].byOperation[row.metadata.operation] =
        (counts[split].byOperation[row.metadata.operation] ?? 0) + 1;
      counts[split].byWindowStrategy[row.metadata.windowStrategy] =
        (counts[split].byWindowStrategy[row.metadata.windowStrategy] ?? 0) + 1;
    }
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceDatasetDir: inputDir,
    maxUserChars,
    evidenceRadius,
    cleanFileLineBudget,
    counts,
    purpose:
      "Windowed derivative of clawpatch-gemma-v0 that bounds long prompts while preserving Clawpatch instructions, schemas, and evidence-centered file context for review examples.",
  };
}

function datasetCard(summary) {
  return `---
license: other
task_categories:
- text-generation
language:
- en
pretty_name: Clawpatch Gemma Windowed v0
size_categories:
- n<1K
---

# Clawpatch Gemma Windowed v0

Private windowed derivative of \`clawpatch-gemma-v0\` for bounded Gemma LoRA training.

## Windowing Policy

- Maximum user prompt characters: ${summary.maxUserChars}
- Review examples with findings retain file snippets around teacher evidence lines.
- Clean review examples retain bounded head snippets from feature files.
- The Clawpatch provider instruction, feature metadata, valid evidence paths, and JSON schema prelude are preserved unless the prelude alone exceeds the budget.
- Metadata records \`windowed\`, \`windowStrategy\`, \`originalPromptBytes\`, \`windowPromptBytes\`, \`omittedPromptChars\`, and \`retainedFileBlocks\`.

## Splits

\`\`\`json
${JSON.stringify(summary.counts, null, 2)}
\`\`\`
`;
}

await mkdir(outputDir, { recursive: true });
const rowsBySplit = {};
for (const split of splits) {
  const rows = parseJsonl(await readFile(path.join(inputDir, `${split}.jsonl`), "utf8"), split).map(windowRow);
  rowsBySplit[split] = rows;
  await writeFile(path.join(outputDir, `${split}.jsonl`), jsonl(rows));
}

const summary = summarize(rowsBySplit);
await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputDir, "README.md"), datasetCard(summary));
console.log(JSON.stringify(summary, null, 2));
