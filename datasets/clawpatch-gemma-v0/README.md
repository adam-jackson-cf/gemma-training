---
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

- Source: /Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot
- Rows: 250
- Hard-boundary eval rows: 30
- Operations: map, review, revalidate
- Teacher provider: Codex
- Accepted criteria: schema-valid and Clawpatch operation-valid captures only
- Excluded scope: fix provider calls

## Splits

```json
{
  "train": {
    "total": 160,
    "byOperation": {
      "map": 3,
      "revalidate": 3,
      "review": 154
    },
    "byRepo": {
      "click": 69,
      "hono": 91
    },
    "cleanReview": 27,
    "nonEmptyReview": 127,
    "redacted": 2
  },
  "validation": {
    "total": 46,
    "byOperation": {
      "map": 1,
      "revalidate": 1,
      "review": 44
    },
    "byRepo": {
      "ripgrep": 46
    },
    "cleanReview": 27,
    "nonEmptyReview": 17,
    "redacted": 0
  },
  "test": {
    "total": 44,
    "byOperation": {
      "review": 44
    },
    "byRepo": {
      "ripgrep": 44
    },
    "cleanReview": 28,
    "nonEmptyReview": 16,
    "redacted": 0
  }
}
```

## Format

Each row is TRL conversational SFT JSONL:

```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "<exact Clawpatch prompt>"},
    {"role": "assistant", "content": "<validated JSON output>"}
  ],
  "metadata": {"operation": "review", "validationStatus": "schema-valid-operation-valid"}
}
```

## Privacy

This dataset is private training material. The capture pipeline scanned prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and summaries for common secrets before persistence. Rows preserve the redaction marker in metadata.
