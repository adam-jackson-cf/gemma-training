# Goal Tracker: Gemma-Backed Clawpatch Through Phase 7

## Tracker Guidance

Update this tracker when material events occur. Keep entries concise and evidence-oriented. Prefer high-risk, high-complexity, user-impacting, or direction-changing events over routine progress.

## Current Status

- Status: active, partially complete, and blocked from paid scale-up pending approval.
- Source goal: `/Users/adamjackson/Projects/gemma-training/goal.md`.
- Current known baseline: 250 accepted pilot captures, 3 accepted scale-path smoke captures, current v0/windowed/private Hub datasets, first non-production review adapter, and committed `openai-compatible` Clawpatch provider exist.
- Current phase status: Phase 3 is closed for the current v0 dataset version; Phase 2, Phase 4, Phase 5 quality closure, Phase 6 live endpoint smoke, and Phase 7 scaled comparison remain open.
- Current quality gap: the adapter proves training, retention, and parseable generation only; retained Phase 5 scoring shows it does not beat base Gemma and is not a Codex-matched non-fix Clawpatch candidate.
- Current execution boundary: paid corpus expansion/training requires explicit approval for scope, budget ceiling, provider spend, and stop conditions; further HF jobs should wait until the exposed token has rotation evidence.

## Goal Summary

Fully realize the Gemma-backed Clawpatch plan through Phase 7 by producing a validated private dataset and training pipeline, closing the model quality gap with deterministic Codex-vs-Gemma comparison runs on the same repositories, and enabling Clawpatch to operate with Gemma for `map`, `review`, and `revalidate` while keeping `fix` unsupported.

## Chronological Progress Log

- 2026-05-24: Goal assets drafted from `clawpatch-gemma-training-research.md`, the completed Phase 0-2 IntentPlan, and the user clarification that Phase 7 means Gemma-backed Clawpatch operation for all non-fix calls with Codex-matched comparison results.
- 2026-05-24: Validated and committed the Clawpatch `openai-compatible` provider slice for active Gemma-compatible `map`, `review`, and `revalidate` calls while keeping `fix` unsupported.
- 2026-05-24: Added an offline Phase 5/7 scoring harness at `/Users/adamjackson/Projects/gemma-training/scripts/evaluate-clawpatch-predictions.mjs` for retained Codex/base-Gemma/fine-tuned-Gemma JSONL prediction comparisons.
- 2026-05-24: Added direct Clawpatch regression coverage for OpenAI-compatible `map`, `revalidate`, and unsupported `fix` behavior.
- 2026-05-24: Extended `/Users/adamjackson/Projects/gemma-training/scripts/evaluate-clawpatch-predictions.mjs` to be operation-aware for `review`, `map`, and `revalidate`.
- 2026-05-24: Submitted small HF Jobs Phase 5 review batch-generation smoke `6a13599d404eb93b204f0e7b` on `a10g-large` for 4 held-out rows, comparing base `google/gemma-4-E4B-it` and adapter `ixianbride/gemma-clawpatch-review-windowed-lora-v0`.
- 2026-05-24: HF review generation smoke `6a13599d404eb93b204f0e7b` generated parseable base and adapter outputs but failed during Hub upload because the job token could not commit directly to the model repo.
- 2026-05-24: CLI reruns `6a135bccf17429a271eeba4f`, `6a135c0af17429a271eeba55`, and `6a135c41404eb93b204f0e8b` failed before model work because `HF_TOKEN` was not injected into the job environment.
- 2026-05-24: CLI rerun `6a135cbbf17429a271eeba62` failed because CLI options were placed after the script and became script arguments; an inspect response exposed the token value in job command metadata, so the token should be rotated.
- 2026-05-24: Submitted replacement MCP HF Jobs smoke `6a135cfe404eb93b204f0e91` with `HF_TOKEN` passed as a secret and retained outputs targeted to private dataset repo `ixianbride/clawpatch-gemma-windowed-v0`.
- 2026-05-24: Replacement job `6a135cfe404eb93b204f0e91` generated all 4 base and all 4 adapter rows parseably, then failed on direct dataset repo upload because the token requires PR creation for writes.
- 2026-05-24: Updated `scripts/hf-generate-review-predictions.py` with `CLAWPATCH_PRINT_ARTIFACTS` and `CLAWPATCH_SKIP_UPLOAD` so prediction artifacts can be retained from logs without printing raw prompts.
- 2026-05-24: Submitted no-upload retained-artifact HF Jobs smoke `6a135e81f17429a271eeba72` for the same 4-row base-vs-adapter review batch.
- 2026-05-24: Cancelled `6a135e81f17429a271eeba72` before generation because the hosted script needed to be confirmed updated with no-upload artifact printing.
- 2026-05-24: Uploaded patched `hf-generate-review-predictions.py` to private helper dataset `ixianbride/hf-cli-jobs-uv-run-scripts`.
- 2026-05-24: Submitted retained-artifact HF Jobs smoke `6a135ee0f17429a271eeba7d` from the confirmed patched hosted script.
- 2026-05-24: Retained-artifact HF Jobs smoke `6a135ee0f17429a271eeba7d` completed successfully, and local artifacts were decoded under `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/` without logging private prompts.
- 2026-05-24: Scored the retained 4-row Phase 5 review smoke. Both base Gemma and the review adapter produced parseable output, but both scored F1 0 and clean accuracy 0, so the current adapter remains a pipeline smoke artifact only and not a quality candidate.
- 2026-05-24: Added Phase 3 dataset validation tooling at `/Users/adamjackson/Projects/gemma-training/scripts/validate-clawpatch-datasets.mjs` and generated `/Users/adamjackson/Projects/gemma-training/reports/clawpatch-dataset-validation.json`; current local datasets validate structurally with 0 issues across 1,084 checked rows.
- 2026-05-24: Ran completionist validation after the retained smoke. Result: pass with gaps; Phase 2 remains below target, Phase 3 needed HF CPU validation, Phase 5 quality gap remains open, Phase 6 still needs live endpoint smoke, and Phase 7 remains open.
- 2026-05-24: Ran HF Jobs CPU validation `6a13614c404eb93b204f0ebd` against the four private Hub datasets and retained `/Users/adamjackson/Projects/gemma-training/reports/hf-dataset-validation-6a13614c/report.json`; 20 JSONL files and 1,084 rows passed with 0 issues.
- 2026-05-24: Updated operation-specific dataset cards for `clawpatch-gemma-map-v0` and `clawpatch-gemma-revalidate-v0` to document scope, format, privacy assumptions, and excluded `fix` scope.
- 2026-05-24: Generated retained corpus coverage report `/Users/adamjackson/Projects/gemma-training/reports/clawpatch-corpus-coverage.json`; current gaps remain review 258, revalidate 96, map 21.
- 2026-05-24: Added Phase 5 quality-gate summarizer `/Users/adamjackson/Projects/gemma-training/scripts/summarize-clawpatch-eval.mjs` and retained `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/quality-summary.json`; the current smoke correctly fails strict thresholds.
- 2026-05-24: Uploaded updated dataset cards to private Hub datasets `ixianbride/clawpatch-gemma-map-v0` and `ixianbride/clawpatch-gemma-revalidate-v0`; Hub repo details confirm the new scope and privacy sections are present.
- 2026-05-24: Updated and committed Clawpatch teacher capture scripts so the canonical capture run targets 5 repositories, 500 accepted captures, and 20 revalidations per repo by default, with configurable repository selection and explicit gap reporting in collection reports.
- 2026-05-24: Added Phase 2 corpus expansion planner `/Users/adamjackson/Projects/gemma-training/scripts/plan-corpus-expansion.mjs` and retained `/Users/adamjackson/Projects/gemma-training/reports/corpus-expansion-plan.json`; it recommends 21 minimum new repositories under bounded per-repository assumptions, including 6 review-heavy repositories and 15 map-only repositories.
- 2026-05-24: Ran a one-repository scale-path capture smoke `20260524T2045Z-scale-smoke` using the updated Clawpatch capture script. It produced 3 accepted captures: 1 map, 1 review, and 1 revalidate, with 0 rejected, 0 metadata-only, and 0 redacted records.
- 2026-05-24: Updated and uploaded the private model card for `ixianbride/gemma-clawpatch-review-windowed-lora-v0` with the retained Phase 5 quality-smoke failure so the adapter is explicitly documented as not quality-ready.
- 2026-05-24: Added multi-capture support and rejected/metadata-only exclusion accounting to `/Users/adamjackson/Projects/gemma-training/scripts/curate-captures.mjs`; verified it can merge the 250-row pilot with the 3-row scale smoke into a 253-row temporary dataset.
- 2026-05-24: Added Phase 5 failure triage script `/Users/adamjackson/Projects/gemma-training/scripts/triage-clawpatch-eval-failures.mjs` and retained `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/failure-triage.json`.
- 2026-05-24: Created `/Users/adamjackson/Projects/gemma-training/reports/paid-scale-approval-request.md` with the required approval scope, stop conditions, token-rotation precondition, and current HF Jobs pricing references for the next paid campaign.
- 2026-05-24: Added Phase 6 live endpoint smoke runner `/Users/adamjackson/Projects/gemma-training/scripts/run-openai-compatible-smoke.mjs`; it requires a real OpenAI-compatible endpoint and does not mock Gemma.
- 2026-05-25: Reconciled tracker against the current workspace: Clawpatch is clean and ahead by 3 commits, root-side reports/scripts are present, and no newer completion evidence exists beyond the recorded Phase 3 closure, failed Phase 5 quality smoke, one-repo capture smoke, and paid-scale approval boundary.
- 2026-06-01: Restructured `/Users/adamjackson/Projects/gemma-training` as the parent experiment repository, moved the customized Clawpatch fork checkout to `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch`, and kept raw captures, JSONL rows, job logs, teacher-run repos, and the nested fork checkout outside the parent commit scope.

## Git Commits Made

- `6a33df7 feat(provider): add openai-compatible provider`
- `3de2a44 test(provider): cover openai-compatible operations`
- `0dfda6f chore(capture): scale teacher corpus targets`

## Implementation Runtime Design Decisions

- `openai-compatible` is the canonical Gemma runtime integration path for Clawpatch. Endpoint hosting and local-model runtime management remain external to Clawpatch; Clawpatch owns request construction, strict JSON extraction, schema validation, operation validation, and loud failure behavior.
- `fix` remains unsupported for `openai-compatible`; unsupported `fix` requests must fail before endpoint calls.
- Phase 5/7 comparison evidence should be generated from retained JSONL prediction artifacts, with live provider calls producing inputs for the evaluator rather than being hidden inside scoring.

## Direction Changes, Overwritten Code, Removed Code, Or Substantial Refactors

- 2026-05-24: Clawpatch teacher capture defaults were changed from the pilot target to the current scaled target: 5 default repositories, 500 accepted captures, and 20 revalidations per repository.
- 2026-05-24: Root curation was extended from single-capture-dir pilot curation to repeatable multi-capture-dir curation with excluded-row accounting for rejected, metadata-only, invalid, or incomplete capture rows.

## Verification Evidence And Quality Gates

- Existing baseline evidence to preserve:
  - Phase 0-2 captures: `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/`.
  - Windowed dataset: `/Users/adamjackson/Projects/gemma-training/datasets/clawpatch-gemma-windowed-v0/`.
  - Current private adapter: `ixianbride/gemma-clawpatch-review-windowed-lora-v0`.
  - Provider integration files: `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/src/provider.ts`, `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/src/provider.test.ts`, `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/docs/providers.md`.
- Remaining evidence required:
  - Hugging Face training job logs and model cards.
  - Held-out and hard-boundary eval reports for Codex, base Gemma, and fine-tuned Gemma.
  - Codex-vs-Gemma comparison reports across the same repositories.
  - Live endpoint or local OpenAI-compatible provider smoke evidence.
  - Clawpatch lint, typecheck, format, and test gates.
- 2026-05-24 provider verification:
  - `pnpm test src/provider.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
  - `pnpm format:check` passed.
- 2026-05-24 provider regression verification:
  - `pnpm test src/provider.test.ts` passed with 138 tests.
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
  - `pnpm format:check` passed.
  - `pnpm test` passed with 15 files, 726 passed tests, and 1 skipped test.
  - `pnpm build` passed.
- 2026-05-24 offline evaluator smoke:
  - `node --check scripts/evaluate-clawpatch-predictions.mjs` passed.
  - `node scripts/evaluate-clawpatch-predictions.mjs --help` passed.
  - Self-scoring `datasets/clawpatch-gemma-v0/test.jsonl` as both reference and prediction produced 44/44 parseable, 44/44 schema-valid, 44/44 evidence-valid, precision 1, recall 1, F1 1, and clean accuracy 1.
- 2026-05-24 operation-aware evaluator smoke:
  - Review self-score on `datasets/clawpatch-gemma-v0/test.jsonl`: F1 1 and clean accuracy 1.
  - Map self-score on `datasets/clawpatch-gemma-map-v0/all.jsonl`: exact F1 1 and near F1 1.
  - Revalidate self-score on `datasets/clawpatch-gemma-revalidate-v0/all.jsonl`: exact outcome accuracy 1 and near outcome accuracy 1.
- 2026-05-24 HF review generation smoke:
  - Job: `6a13599d404eb93b204f0e7b`.
  - Output prefix when successful: `ixianbride/gemma-clawpatch-review-windowed-lora-v0/eval/phase5-review-smoke-20260524T1945Z`.
  - Purpose: retained base-vs-adapter prediction JSONL for scoring; not a quality decision by itself.
  - Result: generated all 4 base and all 4 adapter outputs with generator parseability, then failed on model-repo upload permission before retaining artifacts.
- 2026-05-24 replacement HF review generation smoke:
  - Job: `6a135cfe404eb93b204f0e91`.
  - Output prefix when successful: `ixianbride/clawpatch-gemma-windowed-v0/eval/phase5-review-smoke-20260524T2050Z`.
  - Result: generated parseable base and adapter rows, then failed on direct dataset-repo upload permission.
- 2026-05-24 no-upload HF review generation smoke:
  - Job: `6a135e81f17429a271eeba72`.
  - Purpose: retain base/adapt prediction JSONL and generation summary from logs for local scoring; reference rows are reconstructed locally to avoid logging prompts.
  - Result: cancelled before completion after discovering the hosted script needed confirmation.
- 2026-05-24 retained-artifact HF review generation smoke:
  - Job: `6a135ee0f17429a271eeba7d`.
  - Script: private helper dataset copy confirmed to include `PRINT_ARTIFACTS` and `SKIP_UPLOAD`.
  - Result: completed on `a10g-large` in 349 seconds with 4/4 base rows and 4/4 adapter rows generator-parseable.
  - Retained local artifacts:
    - `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/base.jsonl`
    - `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/adapter.jsonl`
    - `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/reference.jsonl`
    - `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/generation_summary.json`
    - `/Users/adamjackson/Projects/gemma-training/reports/phase5-review-smoke-6a135ee0/score.json`
  - Score summary:
    - Base Gemma: 4/4 output-parseable, 2/4 schema-valid, 3/4 evidence-valid, precision 0, recall 0, F1 0, clean accuracy 0, average latency 33,155 ms.
    - Review adapter: 4/4 output-parseable, 2/4 schema-valid, 3/4 evidence-valid, precision 0, recall 0, F1 0, clean accuracy 0, average latency 34,872 ms.
- 2026-05-24 Phase 3 dataset validation:
  - `node --check scripts/validate-clawpatch-datasets.mjs` passed.
  - `node scripts/validate-clawpatch-datasets.mjs --help` passed.
  - `node scripts/validate-clawpatch-datasets.mjs --pretty --out reports/clawpatch-dataset-validation.json` passed.
  - Report totals: 4 datasets, 20 JSONL files, 1,084 rows, 0 structural issues.
- 2026-05-24 HF CPU dataset validation:
  - Job: `6a13614c404eb93b204f0ebd`.
  - Repos: `ixianbride/clawpatch-gemma-review-v0`, `ixianbride/clawpatch-gemma-windowed-v0`, `ixianbride/clawpatch-gemma-map-v0`, and `ixianbride/clawpatch-gemma-revalidate-v0`.
  - Result: completed on `cpu-basic` in 10 seconds with 4 datasets, 20 JSONL files, 1,084 rows, and 0 issues.
  - Retained report: `/Users/adamjackson/Projects/gemma-training/reports/hf-dataset-validation-6a13614c/report.json`.
- 2026-05-24 script syntax verification:
  - `node --check scripts/evaluate-clawpatch-predictions.mjs` passed.
  - `node --check scripts/audit-corpus-coverage.mjs` passed.
  - `node --check scripts/validate-clawpatch-datasets.mjs` passed.
  - `python3 -m py_compile scripts/hf-generate-review-predictions.py` passed.
- 2026-05-24 corpus coverage audit:
  - `node scripts/audit-corpus-coverage.mjs --pretty --out reports/clawpatch-corpus-coverage.json` passed.
  - Gaps: review 242/500, revalidate 4/100, map 4/25.
- 2026-05-24 corpus expansion planner:
  - `node --check scripts/plan-corpus-expansion.mjs` passed.
  - `node scripts/plan-corpus-expansion.mjs --help` passed.
  - `node scripts/plan-corpus-expansion.mjs --pretty --out reports/corpus-expansion-plan.json` passed.
  - Plan recommendation: 21 minimum new repositories, with 6 review-heavy repositories, 6 revalidate-heavy repositories, and 21 map-producing repositories under the planner assumptions.
- 2026-05-24 capture scale-path smoke:
  - Run ID: `20260524T2045Z-scale-smoke`.
  - Command shape: one repository (`click`), one review, one revalidate, accepted target 1.
  - Result: `map` accepted 1, `review` accepted 1, `revalidate` accepted 1.
  - Secret-pattern presence check on the smoke capture, retained HF job logs, and validation logs found 0 matches for common OpenAI, Hugging Face, GitHub, and AWS key patterns.
- 2026-05-24 model card update:
  - Uploaded `/Users/adamjackson/Projects/gemma-training/model-cards/gemma-clawpatch-review-windowed-lora-v0/README.md` to private model repo `ixianbride/gemma-clawpatch-review-windowed-lora-v0`.
  - The card now records the retained Phase 5 smoke metrics: adapter F1 0, clean accuracy 0, schema-valid rows 2/4, evidence-valid rows 3/4, and no improvement over base Gemma.
- 2026-05-24 curation script verification:
  - `node --check scripts/curate-captures.mjs` passed.
  - `node scripts/curate-captures.mjs --help` passed.
  - Temporary multi-capture curation into `/tmp/clawpatch-gemma-curation-smoke` produced 253 rows from 253 source capture rows with 0 excluded rows.
- 2026-05-24 failure triage verification:
  - `node --check scripts/triage-clawpatch-eval-failures.mjs` passed.
  - `node scripts/triage-clawpatch-eval-failures.mjs --help` passed.
  - `node scripts/triage-clawpatch-eval-failures.mjs --score reports/phase5-review-smoke-6a135ee0/score.json --pretty --out reports/phase5-review-smoke-6a135ee0/failure-triage.json` passed.
  - Triage summary for both base and adapter: 5 schema issues, 1 evidence issue, 2 schema-invalid rows, 1 invalid-evidence row, 2 clean false-positive rows, and 2 missed reference findings.
- 2026-05-24 approval package:
  - Official HF Jobs pricing checked from Hugging Face docs on 2026-05-24.
  - Recorded prices: `cpu-basic` $0.01/hour, `a10g-large` $1.50/hour, `a10g-largex4` $5.00/hour; billing is per minute while jobs are starting or running.
- 2026-05-24 Phase 6 smoke runner:
  - `node --check scripts/run-openai-compatible-smoke.mjs` passed.
  - `node scripts/run-openai-compatible-smoke.mjs --help` passed.
  - Live execution remains blocked until a real Gemma OpenAI-compatible endpoint is provided or approved.
- 2026-05-24 Phase 5 quality-gate summarizer:
  - `node --check scripts/summarize-clawpatch-eval.mjs` passed.
  - `node scripts/summarize-clawpatch-eval.mjs --help` passed.
  - `node scripts/summarize-clawpatch-eval.mjs --score reports/phase5-review-smoke-6a135ee0/score.json --pretty --out reports/phase5-review-smoke-6a135ee0/quality-summary.json` exited 1 as expected because both models failed thresholds.
  - Default thresholds: F1 0.8, clean accuracy 0.95, schema-valid rate 1.0, evidence-valid rate 1.0.
- 2026-05-24 teacher capture scale verification:
  - `node --check scripts/teacher-capture.mjs` passed.
  - `node --check scripts/teacher-topup.mjs` passed.
  - `pnpm build` passed.
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
  - `pnpm format:check` passed.
  - `node dist/cli.js doctor --provider codex --json` passed and reported the Codex CLI provider available without printing secrets.

## Remaining Open Questions Discovered During Implementation

- Exact numerical pass thresholds for "matching Codex" should be proposed from the first evaluation baseline and approved if they materially lower the target.
- A live endpoint or local OpenAI-compatible server smoke remains required before Phase 6 can be called complete.
- The first retained review smoke shows the current adapter does not improve over base Gemma on this batch; the next dataset/training iteration should be driven by quality failures rather than parseability.
- Completionist identified the current Phase 5 failure categories as schema discipline, evidence ranges, and clean-feature false positives.
- Completionist confirmed Phase 3 is closed for the current v0 dataset version but not for a future expanded corpus.
- Completionist identified that a materially larger paid 21-repository capture/training campaign requires explicit user approval for scope, budget ceiling, provider spend, and stop conditions.
- The recorded HF token exposure still needs rotation evidence before further paid HF jobs.

## Key Implementation Map

- Research plan: `/Users/adamjackson/Projects/gemma-training/clawpatch-gemma-training-research.md`.
- Prior IntentPlan: `/Users/adamjackson/Projects/gemma-training/.enaible/intent-plan/20260522T190525Z-gemma-clawpatch-training/intentplan.md`.
- Clawpatch checkout: `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch`.
- Dataset scripts: `/Users/adamjackson/Projects/gemma-training/scripts/`.
- Local datasets: `/Users/adamjackson/Projects/gemma-training/datasets/`.
- Model cards: `/Users/adamjackson/Projects/gemma-training/model-cards/`.

## Deferred Work And Explicitly Rejected Paths

- Rejected: enabling or training Gemma for `fix` as part of this goal.
- Rejected: counting parseable generation smoke, training loss, or schema validity alone as model quality.
- Rejected: silent Codex fallback during Gemma active-provider validation.
- Deferred: live Gemma endpoint smoke, because no running OpenAI-compatible Gemma endpoint was available in this implementation checkpoint.
