---
license: other
task_categories:
- text-generation
language:
- en
pretty_name: Clawpatch Gemma revalidate v0
size_categories:
- n<1K
---

# Clawpatch Gemma revalidate v0

Private operation-specific subset derived from `ixianbride/clawpatch-gemma-review-v0`.

## Scope

- Source dataset: `ixianbride/clawpatch-gemma-review-v0`
- Local source rows: `/Users/adamjackson/Projects/gemma-training/datasets/clawpatch-gemma-v0`
- Operation: revalidate
- Teacher provider: Codex
- Accepted criteria: schema-valid and Clawpatch operation-valid captures only
- Excluded scope: map, review, and fix provider calls

```json
{
  "schemaVersion": 1,
  "operation": "revalidate",
  "sourceDataset": "ixianbride/clawpatch-gemma-review-v0",
  "splits": {
    "train": 3,
    "validation": 1,
    "test": 0,
    "hard_boundary": 4,
    "all": 4
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
  "metadata": {"operation": "revalidate", "validationStatus": "schema-valid-operation-valid"}
}
```

## Privacy

This dataset is private training material. The capture pipeline scanned prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and summaries for common secrets before persistence. Rows preserve the redaction marker in metadata.
