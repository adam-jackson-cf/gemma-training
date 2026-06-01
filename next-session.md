# Handoff: Continue Gemma-Backed Clawpatch Through Phase 7

## Starting Prompt

Continue work in `/Users/adamjackson/Projects/gemma-training` toward `goal.md`: complete Gemma-backed Clawpatch through Phase 7 for `map`, `review`, and `revalidate`, while keeping `fix` unsupported.

Start by reading:

- `goal.md`
- `goal-tracker.md`
- `reports/paid-scale-approval-request.md`
- `reports/corpus-expansion-plan.json`
- `reports/phase5-review-smoke-6a135ee0/quality-summary.json`
- `reports/phase5-review-smoke-6a135ee0/failure-triage.json`

Current state:

- Phase 3 is closed for the current v0 dataset version.
- Phase 2 remains open: retained corpus gaps are `review +258`, `revalidate +96`, `map +21`.
- Phase 5 quality gap is open: the current adapter generated parseable rows but scored F1 `0` and clean accuracy `0`.
- Phase 6 is open: `scripts/run-openai-compatible-smoke.mjs` exists, but no live Gemma OpenAI-compatible endpoint smoke has run.
- Phase 7 is open: no scaled Codex-vs-Gemma operational comparison exists.
- Nested `vendor/clawpatch` repo is clean and ahead by 3 commits:
  - `6a33df7 feat(provider): add openai-compatible provider`
  - `3de2a44 test(provider): cover openai-compatible operations`
  - `0dfda6f chore(capture): scale teacher corpus targets`

Important constraints:

- Do not enable or train Gemma for `fix`.
- Do not silently fall back from Gemma to Codex in active Gemma validation runs.
- Do not treat parseability, training loss, or a single smoke as model quality.
- Do not commit private captures, secrets, provider credentials, or raw private transcripts into the Clawpatch repo.
- A materially larger paid capture/training campaign requires explicit user approval for scope, budget ceiling, provider spend, and stop conditions.
- Further HF jobs should wait until the previously exposed HF token has rotation evidence.

What to do first:

1. If the user approves paid scale-up, verify token rotation by presence check only, then run a staged corpus expansion batch rather than the full 21-repo plan immediately.
2. If approval is not available, continue non-paid preparation: improve curation/reporting, tighten eval tooling, or prepare endpoint smoke documentation.
3. Keep `goal-tracker.md` updated only for material events, decisions, verification evidence, blockers, and direction changes.

## Relevant Files

- `goal.md`: Source of truth for objective, scope boundaries, decision boundaries, and definition of done.
- `goal-tracker.md`: Current state, phase status, commits, verification evidence, blockers, and decisions.
- `vendor/clawpatch/`: Nested Clawpatch git repo; clean and ahead by 3 commits.
- `vendor/clawpatch/src/provider.ts`: OpenAI-compatible provider implementation.
- `vendor/clawpatch/src/provider.test.ts`: Provider tests, including `map`, `revalidate`, and unsupported `fix`.
- `vendor/clawpatch/docs/providers.md`: Provider docs.
- `vendor/clawpatch/scripts/teacher-capture.mjs`: Scaled capture defaults: 5 repos, 500 accepted captures, 20 revalidations per repo.
- `vendor/clawpatch/scripts/teacher-topup.mjs`: Scaled review top-up defaults.
- `scripts/evaluate-clawpatch-predictions.mjs`: Operation-aware Phase 5/7 scorer.
- `scripts/summarize-clawpatch-eval.mjs`: Quality gate summarizer; current smoke fails as expected.
- `scripts/triage-clawpatch-eval-failures.mjs`: Aggregates failure causes without raw prompts/predictions.
- `scripts/audit-corpus-coverage.mjs`: Corpus coverage and gap audit.
- `scripts/plan-corpus-expansion.mjs`: Plans Phase 2 corpus expansion from coverage report.
- `scripts/validate-clawpatch-datasets.mjs`: Local dataset validator.
- `scripts/curate-captures.mjs`: Multi-capture curation with excluded-row accounting.
- `scripts/hf-generate-review-predictions.py`: HF Jobs generation script with artifact-print/no-upload options.
- `scripts/run-openai-compatible-smoke.mjs`: Phase 6 live endpoint smoke runner; requires a real endpoint.
- `reports/clawpatch-dataset-validation.json`: Local validation report, 4 datasets, 20 files, 1,084 rows, 0 issues.
- `reports/hf-dataset-validation-6a13614c/report.json`: HF CPU validation report, 4 datasets, 20 files, 1,084 rows, 0 issues.
- `reports/clawpatch-corpus-coverage.json`: Current retained corpus gaps.
- `reports/corpus-expansion-plan.json`: 21-repo expansion plan under bounded assumptions.
- `reports/paid-scale-approval-request.md`: Approval package for paid scale-up.
- `reports/phase5-review-smoke-6a135ee0/`: Retained generation artifacts, score, quality summary, and failure triage.
- `captures/20260524T2045Z-scale-smoke/`: One-repo capture smoke with 3 accepted captures.
- `model-cards/gemma-clawpatch-review-windowed-lora-v0/README.md`: Private model card updated to document failed quality smoke.

## Key Context

Phase 3 is closed for the current v0 dataset version:

- Local validation passed.
- HF CPU validation job `6a13614c404eb93b204f0ebd` passed.
- Private Hub dataset cards for map/revalidate were updated with scope/privacy/excluded-fix language.

Current model quality evidence is negative:

- Retained HF generation job `6a135ee0f17429a271eeba7d` completed.
- Base and adapter both generated 4/4 parseable rows.
- Base Gemma: schema-valid 2/4, evidence-valid 3/4, F1 `0`, clean accuracy `0`.
- Adapter: schema-valid 2/4, evidence-valid 3/4, F1 `0`, clean accuracy `0`.
- The adapter is documented as a training/retention pipeline artifact, not quality-ready.

Corpus state:

- Current retained curated corpus remains 242 review, 4 revalidate, 4 map.
- Gaps are review +258, revalidate +96, map +21.
- One-repo capture smoke `20260524T2045Z-scale-smoke` produced accepted map/review/revalidate records and validates the capture path, but it does not close Phase 2.

Approval/blocker state:

- `goal.md` requires user agreement before materially larger paid training or inference campaigns.
- Completionist explicitly flagged the 21-repo capture/training campaign as requiring approval.
- A prior HF token value was exposed in job command metadata. Do not repeat the token. Require rotation evidence before further HF paid jobs.
- Current paid-scale approval package includes HF pricing checked on 2026-05-24:
  - `cpu-basic`: $0.01/hour
  - `a10g-large`: $1.50/hour
  - `a10g-largex4`: $5.00/hour
  - Billing is per minute while jobs are starting or running.

Verification already run:

- Clawpatch provider tests, typecheck, lint, format, full tests, and build passed after provider work.
- Clawpatch capture scaling commit passed `node --check`, build, typecheck, lint, format, and `doctor --provider codex --json`.
- Root script syntax checks passed for current JS/Python tooling.
