# Gemma Training Workspace

This repository tracks the Gemma-backed Clawpatch training plan, evaluation tooling, dataset metadata, retained reports, and handoff notes.

## Layout

- `goal.md` and `goal-tracker.md`: source objective and current execution state.
- `scripts/`: curation, validation, scoring, HF Jobs, and live endpoint smoke tooling.
- `datasets/`: dataset cards and summaries only; raw JSONL rows are intentionally ignored.
- `reports/`: retained aggregate reports and summaries; raw prediction JSONL and job logs are intentionally ignored.
- `model-cards/`: local copies of model card material.
- `vendor/clawpatch/`: ignored checkout of the customized Clawpatch fork at `https://github.com/adam-jackson-cf/clawpatch.git`.
- `teacher-runs/`: ignored upstream repos used as capture/review targets.

## Vendor Checkout

The Clawpatch fork is managed as its own Git repository under `vendor/clawpatch` so workspace documentation and experiment tooling can be committed independently from Clawpatch source commits.

To recreate the checkout:

```sh
mkdir -p vendor
git clone https://github.com/adam-jackson-cf/clawpatch.git vendor/clawpatch
git -C vendor/clawpatch remote add upstream https://github.com/openclaw/clawpatch.git
```

Build Clawpatch before running the live provider smoke:

```sh
pnpm -C vendor/clawpatch install
pnpm -C vendor/clawpatch build
node scripts/run-openai-compatible-smoke.mjs --help
```
