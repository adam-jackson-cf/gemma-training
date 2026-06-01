---
base_model: google/gemma-4-E4B-it
library_name: peft
license: other
tags:
- clawpatch
- code-review
- lora
- pilot
---

# Gemma Clawpatch Review Windowed LoRA v0

Private pilot LoRA adapter for Clawpatch review JSON generation.

This is a bounded training artifact, not a production-quality review model. It
replaces the earlier 128-token smoke adapter as the current C1 artifact because
it trains on realistic windowed Clawpatch review prompts.

## Training Summary

- Base model: `google/gemma-4-E4B-it`
- Dataset: `ixianbride/clawpatch-gemma-windowed-v0`
- Training job: `6a131f21404eb93b204f0ccf`
- Training rows: 16 review rows
- Validation rows: 4 review rows
- Max length: 2048
- Precision: bf16
- LoRA trainable parameters: 2,752,512
- Train prompt lengths: 1,272-1,542 tokens
- Validation prompt lengths: 1,150-1,288 tokens
- Baseline eval loss: `2.437106192111969`
- Eval loss: `2.437106192111969`

See `training_summary.json` in this repository for the full run record.

## Evaluation Summary

Held-out generation smoke job `6a132000f17429a271eeb6eb` uploaded
`eval_smoke.json`. Both base and adapter outputs were JSON-parseable and
included the top-level `findings` and `inspected` keys.

This smoke checks adapter load, generation, JSON parseability, and artifact
upload only. It does not establish review quality, evidence validity,
precision/recall, or readiness for active replacement of Codex.

Retained Phase 5 review smoke job `6a135ee0f17429a271eeba7d` generated 4
held-out review rows for both base Gemma and this adapter, then scored the
outputs locally with Clawpatch validation rails. The adapter produced 4/4
parseable rows, but only 2/4 schema-valid rows and 3/4 evidence-valid rows.
It scored precision `0`, recall `0`, F1 `0`, clean accuracy `0`, and clean
false-positive rate `1`. Base Gemma produced the same quality metrics on this
batch.

The current adapter is therefore a training and retention pipeline artifact
only. It does not beat base Gemma on the retained quality smoke and is not a
candidate for active Clawpatch review use.

## Intended Next Validation

Before shadow or active use, run held-out Clawpatch validator evaluation over
the windowed validation/test splits and compare schema validity, evidence
validity, false positives, false negatives, latency, and cost against Codex.
