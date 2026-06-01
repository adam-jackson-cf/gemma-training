# Goal: Gemma-Backed Clawpatch Through Phase 7

## Objective

Complete the remaining `clawpatch-gemma-training-research.md` phased plan through Phase 7 so Clawpatch can operate with a fine-tuned Gemma provider for `map`, `review`, and `revalidate`, while keeping `fix` unsupported. The work must close the model quality gap by measuring Gemma against Codex on the same repositories, prompts, schemas, and validation rails until Gemma produces matching operational results for non-fix Clawpatch use.

## Outcome

When this goal succeeds, Clawpatch has a reproducible private data, training, evaluation, deployment, and comparison workflow for Gemma-backed non-fix provider calls. Gemma is callable through the Clawpatch provider path for `map`, `review`, and `revalidate`; comparison runs against Codex across the same repositories show matched schema-valid, evidence-valid, and finding-relevant results; and the retained evidence is strong enough to justify Gemma as the active non-fix provider for the covered scope.

## Scope Boundaries

Allowed work:

- Continue from the existing 250 accepted capture corpus, windowed dataset, private Hugging Face datasets, smoke adapter, and `openai-compatible` Clawpatch provider.
- Expand the dataset beyond the current 250 starting rows where required by model quality, including the earlier Phase 2 target of at least 500 accepted review examples and at least 100 revalidation examples if findings exist.
- Train additional Gemma adapters or model variants using Hugging Face Jobs, with small paid smoke runs before larger paid runs.
- Build deterministic evaluation and comparison tooling for Codex, base Gemma, and fine-tuned Gemma outputs.
- Add or refine Clawpatch runtime integration needed for active Gemma `map`, `review`, and `revalidate` runs.
- Update local research, model cards, dataset cards, and tracking artifacts with retained evidence.

Excluded work:

- Do not train or enable Gemma to perform `fix`.
- Do not silently fall back from Gemma to Codex in active Gemma validation runs.
- Do not treat training loss, parseability, or a single generation smoke as model quality.
- Do not commit private captures, secrets, provider credentials, or raw private transcripts into the Clawpatch repository.

## Approach Context

Current evidence:

- Phase 0-2 capture work produced 250 accepted captures under `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/`.
- Phase 3 produced TRL JSONL datasets and a windowed dataset under `/Users/adamjackson/Projects/gemma-training/datasets/clawpatch-gemma-windowed-v0/`.
- Private Hub datasets include `ixianbride/clawpatch-gemma-review-v0`, `ixianbride/clawpatch-gemma-map-v0`, `ixianbride/clawpatch-gemma-revalidate-v0`, and `ixianbride/clawpatch-gemma-windowed-v0`.
- The current adapter `ixianbride/gemma-clawpatch-review-windowed-lora-v0` proves tokenization, training, adapter upload, and parseable held-out generation only; it is not production quality.
- Clawpatch has an `openai-compatible` provider that supports `map`, `review`, and `revalidate`, validates JSON with existing schemas, and rejects `fix` loudly as unsupported.

Execution should prioritize:

- Model quality measurement before larger training spend.
- Review quality first, then revalidate, then map.
- Repository-level or feature-family-level splits rather than random row splits.
- Clawpatch validators as mandatory rails for schema, evidence path, line range, and operation-specific validity.
- Codex comparison runs on the same repositories and prompts as the primary operational quality measure.
- Small Hugging Face paid tests before larger paid runs.

## Decision Boundaries

The executor may decide:

- Exact scripts, filenames, and report formats if they remain reproducible and evidence-oriented.
- Hugging Face job flavors and token budgets, provided each larger paid run is preceded by a small smoke run.
- Whether to train one combined non-fix adapter or operation-specific adapters, based on measured quality.
- Whether dataset expansion should prioritize review, revalidate, or map examples based on failing eval metrics.

User agreement is required before:

- Enabling Gemma for `fix`.
- Making private datasets, model artifacts, captures, or raw transcripts public.
- Running a materially larger paid training or inference campaign than the established smoke-then-scale pattern.
- Relaxing validation gates or accepting a lower model quality bar than Codex-matched non-fix operation.

## Definition Of Done

The goal is complete only when all of these are true:

- Phase 2 gaps are closed or deliberately superseded: the retained corpus includes enough accepted review, revalidate, and map examples to support the final quality target, with repository qualification and privacy evidence retained.
- Phase 3 is complete: train, validation, test, and hard-boundary datasets exist; dataset cards document scope and privacy assumptions; local and Hugging Face CPU validation jobs pass.
- Phase 4 is complete: Gemma training is reproducible through Hugging Face Jobs; model artifacts and model cards are uploaded privately; job logs, training summaries, and cost notes are retained.
- Phase 5 is complete: an evaluation harness compares Codex, base Gemma, and fine-tuned Gemma on held-out and hard-boundary prompts using JSON parse rate, schema validity, evidence path validity, line-range validity, no evidence outside included excerpts, useful finding precision, recall against Codex or human baseline, clean-feature behavior, latency, and cost.
- Phase 5 quality gap is closed: fine-tuned Gemma beats base Gemma and matches Codex closely enough on the same repositories that discrepancies are understood, triaged, and either fixed or accepted with explicit rationale.
- Phase 6 is complete: Clawpatch can run `map`, `review`, and `revalidate` through the Gemma-backed `openai-compatible` path against a live endpoint or local OpenAI-compatible server; failures are loud and quality gates are not bypassed.
- Phase 7 is complete: scaled comparison runs across the same repositories show Gemma and Codex matching operational results for the covered non-fix Clawpatch scope; cost and quality are tracked per model version; and the final retained decision states Gemma is ready as the active non-fix provider for the proven scope.
- Verification evidence includes the relevant Clawpatch quality gates, dataset validation, training smoke and full-run evidence, evaluation reports, provider integration tests, live endpoint smoke, and Codex-vs-Gemma comparison reports.

## Produced Goal Statement

Fully realize the Gemma-backed Clawpatch plan through Phase 7 by producing a validated private dataset and training pipeline, closing the model quality gap with deterministic Codex-vs-Gemma comparison runs on the same repositories, and enabling Clawpatch to operate with Gemma for `map`, `review`, and `revalidate` while keeping `fix` unsupported.

## Executor Guidance

This `goal.md` is the source of truth for the remaining work. Maintain `goal-tracker.md` during implementation and update it when material events occur.

`goal-tracker.md` should capture high-value events only: decisions, direction changes, commits, verification evidence, open questions discovered during implementation, convergence of risk, complexity, or user journeys, deferred work, and rejected paths. Do not use it for routine progress noise.
