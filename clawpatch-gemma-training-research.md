# Clawpatch Gemma Training Research

Date: 2026-05-22

Workspace:

- Experiment workspace: `/Users/adamjackson/Projects/gemma-training`
- Local Clawpatch checkout: `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch`
- Clawpatch commit inspected: `a0080cf775adeaa1e11cb2c59ae6aac21b8f129a`
- Hugging Face account available through the MCP plugin: `ixianbride`

## Executive Summary

The experiment is feasible if it is scoped to replacing Clawpatch's LLM calls for `map`, `review`, and `revalidate`, while excluding `fix`.

Clawpatch already has a clean model-provider boundary: every provider implements `map`, `review`, `fix`, and `revalidate`, and provider outputs are runtime validated against strict schemas. The Codex provider shells out to `codex exec` with a JSON schema and reads the final JSON result from a temporary output file. This makes Clawpatch a strong candidate for supervised fine-tuning because each useful call can be represented as:

```json
{
  "messages": [
    {"role": "system", "content": "Return only JSON matching the Clawpatch schema."},
    {"role": "user", "content": "<exact Clawpatch prompt>"},
    {"role": "assistant", "content": "<validated provider JSON>"}
  ]
}
```

The best first target is `review`, because it is high-value, bounded, schema-validated, and already contains line-numbered evidence constraints. `revalidate` is the second-best target. `map` should come later because Clawpatch already has deterministic mapping and only uses agent mapping when heuristic mapping is weak or forced.

The main risk is not Hugging Face infrastructure. The main risk is dataset quality: Codex findings are teacher outputs, not ground truth. The training set must be filtered through schema validation, Clawpatch evidence validation, false-positive triage, and held-out repository evals.

## Goal

Train a small Gemma model, likely `google/gemma-4-E4B-it` or a closely related Gemma 4 E4B checkpoint, to handle Clawpatch's non-fix model calls:

- `map`: repository inventory to semantic review slices.
- `review`: one feature prompt to strict findings JSON.
- `revalidate`: existing finding JSON to strict outcome JSON.

The practical product goal is to let Clawpatch run most low-risk, bounded model calls against a cheaper Gemma provider, while keeping frontier models for dataset generation, hard cases, and possibly future repair work.

## Model Target

The user phrased the model as "Gemma 4B." Current Hugging Face search results show two relevant families:

- `google/gemma-4-E4B-it`: Gemma 4 E4B instruction variant.
- `google/gemma-4-E4B`: Gemma 4 E4B base variant.
- `google/gemma-3-4b-it`: older Gemma 3 4B instruction variant.

For this experiment, prefer Gemma 4 E4B if training support and context length are workable. Keep the model target configurable until the first training smoke test confirms tokenizer/chat-template behavior and memory requirements.

## Clawpatch Code Findings

### Provider Boundary

Source: `clawpatch/src/provider.ts`

The provider interface is defined as:

```ts
export type Provider = {
  name: string;
  check(root: string): Promise<string>;
  map(root: string, prompt: string, options: ProviderOptions): Promise<AgentMapOutput>;
  review(root: string, prompt: string, options: ProviderOptions): Promise<PartitionedReviewOutput>;
  fix(root: string, prompt: string, options: ProviderOptions): Promise<FixPlanOutput>;
  revalidate(root: string, prompt: string, options: ProviderOptions): Promise<RevalidateOutput>;
};
```

`providerByName` currently supports:

- `codex`
- `opencode`
- `acpx`
- `grok`
- `pi`
- `cursor`
- `claude`
- `mock`
- `mock-fail`

There is no generic Hugging Face, vLLM, Ollama, or OpenAI-compatible HTTP provider in the inspected commit. To use a fine-tuned Gemma model directly, we should add an `openai-compatible` or `local-http` provider rather than hardcode Hugging Face. That keeps deployment portable across Hugging Face Inference Endpoints, vLLM, local inference, or other OpenAI-compatible servers.

### Codex Provider

Source: `clawpatch/src/provider.ts`

The Codex provider routes operations through `runCodexJson`:

- `map` passes `agentMapJsonSchema`
- `review` passes `reviewJsonSchema`
- `fix` passes `fixPlanJsonSchema` with `workspace-write`
- `revalidate` passes `revalidateJsonSchema`

`runCodexJson` creates a temp schema file and output file, then invokes:

```text
codex exec --cd <root> --output-schema <schemaPath> --output-last-message <outputPath> --sandbox <mode> -
```

The prompt is passed on stdin. This is the ideal capture point because it sees:

- operation prompt
- schema
- provider options
- raw output file
- provider errors

### Prompt Shapes

Source: `clawpatch/src/prompt.ts`

`buildAgentMapPrompt` asks the model to split repository inventory into semantic Clawpatch review slices. It includes:

- project metadata
- repository inventory
- JSON shape for features
- path constraints
- ownership/context/test semantics

`buildReviewPromptBundle` is the highest-value training source. It includes:

- project metadata
- feature record
- review categories
- mode-specific instructions
- valid evidence paths
- prompt context
- JSON output shape
- numbered file excerpts

Important review instructions already embedded in the prompt:

- return strict JSON only
- inspect owned, context, and test files
- treat tests as evidence of intended behavior
- deduplicate root-cause issues
- avoid speculative findings
- evidence must point at included files
- line ranges must use the line-number gutter
- do not cite files beyond shown excerpts
- set `evidence.quote` to `null`

`buildRevalidatePrompt` asks whether a finding is now:

- `fixed`
- `open`
- `false-positive`
- `uncertain`

It is short and likely a good second-stage training target.

`buildFixPrompt` is deliberately excluded from the first training scope. It asks the provider to apply a repair in the current repository. Fine-tuning Gemma on the JSON plan alone would not make it capable of editing the worktree unless a separate agent loop supplies file tools and patch application.

### Output Schemas

Source: `clawpatch/src/types.ts`

The relevant provider output schemas are:

- `agentMapOutputSchema`: feature records plus notes.
- `reviewOutputSchema`: `findings` plus `inspected`.
- `revalidateOutputSchema`: outcome, reasoning, commands.

The review schema requires each finding to include:

- title
- category
- severity
- confidence
- evidence
- reasoning
- reproduction
- recommendation
- why tests do not already cover this
- suggested regression test
- minimum fix scope

### Validation and Persistence

Source: `clawpatch/src/app.ts`

The review flow:

1. Builds a review prompt bundle.
2. Calls the provider.
3. Captures provider-level dropped findings.
4. Applies mode filtering and max-finding caps.
5. Validates evidence paths and line ranges through `validateReviewOutputPartitioned`.
6. Converts validated findings into persisted finding records.
7. Stores only analysis summary metadata, not raw prompts or responses.

The current analysis summary stores:

- number of findings
- prompt bytes
- approximate tokens
- included file count
- omitted file count

This means we must add capture instrumentation before dataset generation. The current `.clawpatch` state is not enough to reconstruct SFT rows.

## Zafir-Inspired Method

CJ Zafir's public SLM training posts point toward a data-centric distillation approach:

- train small, specialized expert models rather than broad general assistants
- generate supervised chat data from stronger teacher models
- use a loop to design, generate, critique, filter, and expand the dataset
- start with thousands of high-quality examples before scaling to tens of millions of tokens
- evaluate with hard, task-specific boundary tests rather than generic benchmarks
- run local or cheap inference once the model is specialized

For Clawpatch, the equivalent method is:

1. Use Clawpatch's provider boundary to generate teacher traces with Codex.
2. Validate every trace against the schema and Clawpatch's own evidence checks.
3. Triage findings so false positives do not enter the supervised dataset.
4. Use held-out repos/features for hard-boundary evaluation.
5. Fine-tune Gemma on accepted prompt-to-JSON examples.
6. Run Gemma in shadow mode before allowing it to replace Codex.

The key adaptation is that Clawpatch has deterministic validation rails. We should lean into those rails rather than create a broad synthetic dataset detached from the real CLI behavior.

## Dataset Design

### Capture Record

Each provider call should produce an internal capture record before conversion to training JSONL:

```json
{
  "schemaVersion": 1,
  "captureId": "cap_...",
  "operation": "review",
  "repo": {
    "rootHash": "sha256:...",
    "remoteHash": "sha256:...",
    "headSha": "..."
  },
  "clawpatch": {
    "version": "...",
    "commit": "a0080cf775adeaa1e11cb2c59ae6aac21b8f129a",
    "runId": "...",
    "featureId": "...",
    "mode": "default"
  },
  "provider": {
    "name": "codex",
    "model": "...",
    "reasoningEffort": "xhigh"
  },
  "input": {
    "prompt": "...",
    "schema": {}
  },
  "output": {
    "raw": {},
    "accepted": {},
    "droppedFindings": [],
    "validation": {
      "status": "accepted",
      "errors": []
    }
  },
  "metadata": {
    "promptBytes": 0,
    "approxTokens": 0,
    "includedFiles": [],
    "omittedFiles": []
  },
  "createdAt": "..."
}
```

Privacy and safety:

- Do not capture secrets from environment variables.
- Avoid printing tokens or credentials.
- Hash repo identity where useful.
- Keep capture data private by default.
- Redact known secret-looking values before upload.
- Do not commit capture data into the Clawpatch repo.

### SFT Row

Accepted rows should be converted into TRL conversational format:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a Clawpatch provider. Return only JSON matching the requested schema. Do not include markdown fences or prose."
    },
    {
      "role": "user",
      "content": "<exact Clawpatch prompt>"
    },
    {
      "role": "assistant",
      "content": "<accepted JSON output>"
    }
  ],
  "metadata": {
    "operation": "review",
    "featureKind": "route",
    "teacher": "codex",
    "validation": "accepted"
  }
}
```

TRL's `SFTTrainer` supports conversational datasets where each sample has structured `messages`, and it applies the model chat template automatically. PEFT/LoRA can be supplied through TRL for efficient supervised fine-tuning.

### Splits

Use repository-level or feature-family-level splits, not random row splits.

Recommended splits:

- `train`: accepted traces from selected repos.
- `validation`: held-out features from the same broad repo family.
- `test`: entirely held-out repos or packages.
- `hard_boundary`: adversarial or edge-case prompts with known pass/fail expectations.

Do not let the same feature or near-duplicate file appear in both train and hard-boundary eval.

### Negative and Rejected Data

Rejected outputs are useful, but not for first-pass SFT. Store them separately:

- malformed JSON
- schema invalid
- invalid evidence path
- invalid line range
- false-positive finding
- over-broad speculative finding
- duplicate root-cause finding

These can later support:

- eval cases
- preference training
- critic/revalidator training
- synthetic hard-boundary tests

## Hugging Face Execution Path

The Hugging Face plugin is now available and authenticated as `ixianbride`.

Capabilities verified:

- `hf_jobs` can run Docker or UV jobs.
- GPU flavors include `t4-*`, `l4x*`, `a10g-*`, `l40s*`, and `a100-*`.
- Jobs can pass `HF_TOKEN` as a secret.
- Jobs can fetch logs and inspect job state.
- HF docs recommend `hf jobs uv run --with trl --flavor ... -s HF_TOKEN ...` for TRL training.
- The Hub docs identify Jobs as suitable for fine-tuning, inference, data ingestion, and processing.

Recommended HF assets:

- Private dataset repo: `ixianbride/clawpatch-gemma-review-v0`
- Private dataset repo: `ixianbride/clawpatch-gemma-revalidate-v0`
- Optional dataset repo: `ixianbride/clawpatch-gemma-map-v0`
- Model repo: `ixianbride/gemma-clawpatch-review-lora-v0`
- Model repo: `ixianbride/gemma-clawpatch-revalidate-lora-v0`

Start with a CPU dataset validation job, then one small GPU LoRA job. Do not start with a large paid training job until dataset loading, tokenization, schema eval, and upload paths are proven.

Example HF Jobs shape:

```bash
hf jobs uv run \
  --image huggingface/trl \
  --flavor a10g-large \
  --timeout 6h \
  -s HF_TOKEN \
  train_clawpatch_gemma.py \
  --model_name_or_path google/gemma-4-E4B-it \
  --dataset_name ixianbride/clawpatch-gemma-review-v0 \
  --output_dir ixianbride/gemma-clawpatch-review-lora-v0 \
  --use_peft
```

The exact flavor should be selected after a token-length and VRAM smoke test. Review prompts may be large because they include file excerpts.

## Evaluation Strategy

Do not evaluate only on training loss.

Minimum eval metrics:

- JSON parse success rate.
- Schema validation success rate.
- Valid evidence path rate.
- Valid line range rate.
- No evidence outside included files.
- Finding precision after triage.
- Finding recall against Codex/human baseline.
- Correct empty-output behavior on clean features.
- Latency and cost per feature.

Suggested v0 pass thresholds:

- 98% or higher JSON parse success.
- 95% or higher schema validity.
- 90% or higher evidence validity.
- Clear cost/latency advantage over Codex.
- No unacceptable false-positive rate increase.

Held-out eval should include:

- clean features with no findings
- real bugs with line-specific evidence
- test-gap cases
- misleading helper names that should not be reported as bugs
- truncated file excerpts
- duplicate root-cause cases
- deslopify mode cases if that mode is in scope

## Deployment Strategy

Add a generic provider to Clawpatch rather than a Hugging Face-specific one.

Recommended name:

- `openai-compatible`

Environment/config options:

- `CLAWPATCH_OPENAI_COMPATIBLE_BASE_URL`
- `CLAWPATCH_OPENAI_COMPATIBLE_API_KEY`
- `CLAWPATCH_OPENAI_COMPATIBLE_MODEL`
- optional timeout
- optional max tokens

Why generic:

- Hugging Face Inference Endpoints can be wrapped by OpenAI-compatible servers depending on deployment choice.
- vLLM can expose OpenAI-compatible endpoints.
- Local inference can be tested without changing Clawpatch again.
- The same provider supports fine-tuned Gemma, future Qwen models, and other local SLMs.

Shadow mode should come before replacement mode:

1. Run Codex as the active provider.
2. Send the same prompt to Gemma asynchronously or in a separate command.
3. Compare parse/schema/evidence validity and finding overlap.
4. Store comparison results.
5. Only allow Gemma as active provider once it passes held-out evals.

## Phased Roadmap

### Phase 0: Experiment Charter and Baseline

Objective: define scope, model target, data boundaries, and success metrics before code changes.

Activities:

- Confirm target operations: `review` first, `revalidate` second, `map` third.
- Exclude `fix` from training and active replacement.
- Confirm model candidate: `google/gemma-4-E4B-it` unless smoke tests show a better checkpoint.
- Select 3 to 5 repositories for teacher capture.
- Define privacy rules for captured prompts and source snippets.
- Define eval thresholds and cost target.

Exit criteria:

- Written experiment charter.
- Chosen initial repos.
- Chosen model candidate.
- Agreed pass/fail eval metrics.

### Phase 1: Clawpatch Provider Capture

Objective: alter Clawpatch to capture provider prompts, schemas, outputs, and validation outcomes for training data.

Activities:

- Add a capture module outside core provider logic where possible.
- Add opt-in config/env flag such as `CLAWPATCH_CAPTURE_DIR`.
- Capture `map`, `review`, and `revalidate`.
- Do not capture `fix` by default.
- Capture raw provider output and post-validation accepted output.
- Capture dropped findings and validation errors.
- Add redaction for secret-looking values.
- Add tests around capture record shape and opt-in behavior.

Likely files:

- `src/provider.ts`
- `src/app.ts`
- `src/agent-mapper.ts`
- `src/types.ts`
- new `src/capture.ts`
- focused tests in `src/provider.test.ts`, `src/workflow.test.ts`, or new capture tests

Exit criteria:

- `pnpm typecheck`, `pnpm lint`, and focused tests pass.
- Running `clawpatch review` with capture enabled writes JSONL capture records.
- Running without capture leaves behavior unchanged.

### Phase 2: Teacher Data Collection

Objective: generate high-quality teacher traces from Codex.

Activities:

- Run Clawpatch init/map/review on selected repos.
- Use Codex as the teacher provider.
- Prefer bounded review batches.
- Record Codex model and reasoning effort.
- Include clean features as well as finding-heavy features.
- Run revalidation on selected findings where possible.
- Store capture JSONL outside the repo or in a private data area.

Exit criteria:

- At least 500 accepted review examples.
- At least 100 revalidation examples if findings exist.
- Capture includes both non-empty findings and clean empty-finding outputs.

### Phase 3: Dataset Curation and Hard-Boundary Eval

Objective: convert raw captures into training/eval datasets.

Activities:

- Convert captures to TRL conversational JSONL.
- Partition by repo/feature, not random row.
- Separate accepted examples from rejected examples.
- Add deterministic validators for JSON/schema/evidence.
- Create hard-boundary eval cases.
- Optionally use a frontier model or human triage to label false positives.
- Upload private datasets to Hugging Face.

Exit criteria:

- Private HF dataset repo exists.
- Train/validation/test/hard-boundary splits exist.
- Dataset card documents scope and privacy assumptions.
- Local and HF CPU smoke jobs can load and validate the dataset.

### Phase 4: Remote Training on Hugging Face

Objective: fine-tune Gemma with LoRA/SFT using HF Jobs.

Activities:

- Run CPU dataset/tokenization smoke job.
- Run tiny GPU smoke job with a small sample.
- Run first LoRA SFT job for `review`.
- Push adapter/model output to a private HF model repo.
- Capture training logs and metrics.
- Avoid large token budgets until the first run validates end to end.

Exit criteria:

- First review LoRA artifact exists on HF.
- Training job logs are available.
- Model can generate parseable review JSON on a small held-out set.

### Phase 5: Evaluation and Shadow Mode

Objective: compare fine-tuned Gemma against Codex and base Gemma.

Activities:

- Run held-out eval prompts through:
  - Codex teacher
  - base Gemma
  - fine-tuned Gemma
- Validate outputs with the same Clawpatch validators.
- Compare JSON validity, schema validity, evidence validity, precision, recall, latency, and cost.
- Add a Clawpatch shadow-mode runner if needed.
- Store eval reports in the experiment workspace.

Exit criteria:

- Fine-tuned Gemma beats base Gemma on schema/evidence validity and useful findings.
- Fine-tuned Gemma has an acceptable false-positive profile.
- We know whether it is viable for active `review` use.

### Phase 6: Provider Integration

Objective: make Clawpatch able to call the fine-tuned model as an active provider.

Activities:

- Add an `openai-compatible` provider.
- Support strict JSON prompting and schema validation.
- Add config/env variables for endpoint, model, key, timeout, and max tokens.
- Test against a local or HF-hosted endpoint.
- Keep `fix` disabled or explicitly unsupported for this provider unless a tool-using agent wrapper is built later.

Exit criteria:

- `clawpatch review --provider openai-compatible --model <gemma-model>` works.
- Provider output passes existing Clawpatch validation.
- Failure modes are loud and do not silently bypass quality gates.

### Phase 7: Scale and Iterate

Objective: scale the dataset only after v0 proves value.

Activities:

- Expand to more repos and languages.
- Add revalidation training.
- Add agent mapping training if useful.
- Add negative/preference data once SFT is stable.
- Consider Unsloth or larger HF hardware if token volume grows.
- Re-run evals after every dataset/model change.

Exit criteria:

- Stable repeatable training pipeline.
- Cost and quality tracked per model version.
- Decision on whether Gemma should replace, shadow, or only pre-filter Codex calls.

## Execution Evidence - 2026-05-24

The Phase 0-2 IntentPlan completed with 250 accepted captures under `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/`. The Phase 3 curation pass converted those captures into TRL conversational JSONL under `/Users/adamjackson/Projects/gemma-training/datasets/clawpatch-gemma-v0/`:

- `train.jsonl`: 160 records.
- `validation.jsonl`: 46 records.
- `test.jsonl`: 44 records.
- `hard_boundary.jsonl`: 30 records.
- `all.jsonl`: 250 records.

The curated private Hugging Face datasets are:

- `ixianbride/clawpatch-gemma-review-v0`
- `ixianbride/clawpatch-gemma-map-v0`
- `ixianbride/clawpatch-gemma-revalidate-v0`
- `ixianbride/clawpatch-gemma-windowed-v0`

Long-context mitigation is now implemented in `/Users/adamjackson/Projects/gemma-training/scripts/window-training-dataset.mjs`. It derives `/Users/adamjackson/Projects/gemma-training/datasets/clawpatch-gemma-windowed-v0/` from the 250 accepted rows while preserving the same split counts:

- `train.jsonl`: 160 records.
- `validation.jsonl`: 46 records.
- `test.jsonl`: 44 records.
- `hard_boundary.jsonl`: 30 records.
- `all.jsonl`: 250 records.

The windowed dataset caps user prompts to 4,000 UTF-8 bytes, records the original and windowed prompt sizes in metadata, and uses evidence-centered file windows for review rows with findings. The latest local summary reports 240 windowed rows and a maximum sampled review token length of 2,944 tokens under `google/gemma-4-E4B-it`.

HF Jobs validation completed in small paid increments before the adapter training smoke:

- CPU dataset/tokenizer smoke passed for all four splits and `google/gemma-4-E4B-it`.
- CPU dataset/tokenizer smoke also passed for the windowed review subset with `CLAWPATCH_MAX_EXPECTED_TOKENS=8192`; remote CPU smoke job `6a13158d404eb93b204f0c88` confirmed the Hub dataset.
- Tiny A10G LoRA smoke established that Gemma 4 E4B PEFT needs `target_modules=["linear"]`, `prepare_model_for_kbit_training(model)`, and `model.enable_input_require_grads()` for a 4-bit backward pass.
- The first 512-token trainer OOMed on A10G, so the retained smoke adapter was intentionally capped at 128 input tokens.
- The bounded review LoRA smoke trained 7 short records and pushed `ixianbride/gemma-clawpatch-review-lora-v0` with `training_summary.json`.
- The held-out generation smoke with `max_input_length=2048` and `max_new_tokens=512` produced JSON-parseable base and adapter outputs with top-level `findings` and `inspected`, and uploaded `eval_smoke.json` to the adapter repo.
- A replacement windowed trainer is now implemented in `/Users/adamjackson/Projects/gemma-training/scripts/hf-train-review-lora-windowed.py`. It trains review rows with assistant-only loss masking, records prompt/full lengths, pins Torch to a CUDA-12-compatible build for HF Jobs, and uploads `training_summary.json`.
- Paid incremental tests were run before the bounded adapter: A10G-small failed at 1,024-token row selection and OOMed at 1,280-2,048 tokens; A100-large completed a 2-row bf16 checkpointed pilot in job `6a131b5f404eb93b204f0cb2` and pushed `ixianbride/gemma-clawpatch-review-windowed-lora-test-v0`.
- The first 16-row MCP-submitted A100 run completed training but failed at Hub model repo creation because the MCP-injected fine-grained token could not create model repos. The model repo was created locally with the locally authenticated `hf` token, and the successful local-auth A100 run `6a131f21404eb93b204f0ccf` pushed `ixianbride/gemma-clawpatch-review-windowed-lora-v0`.
- The successful bounded adapter trained 16 review rows at `max_length=2048` with full bf16, gradient checkpointing, 2,752,512 trainable LoRA parameters, train lengths 1,272-1,542 tokens, validation lengths 1,150-1,288 tokens, baseline eval loss `2.437106192111969`, and eval loss `2.437106192111969`.
- Held-out generation smoke job `6a132000f17429a271eeb6eb` uploaded `eval_smoke.json` to `ixianbride/gemma-clawpatch-review-windowed-lora-v0`. Both base and adapter outputs were JSON-parseable with top-level `findings` and `inspected`; the smoke checks parseability only and does not establish model quality.

Provider integration evidence is in `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/src/provider.ts`, `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/src/provider.test.ts`, and `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch/docs/providers.md`. The `openai-compatible` provider supports `map`, `review`, and `revalidate`, requires a base URL and model, accepts an optional API key, validates JSON with existing schemas, and rejects `fix` loudly as unsupported. The provider tests cover provider lookup, configuration parsing, OpenAI-compatible content extraction, and a mocked review request that verifies `/chat/completions` URL construction, bearer auth, request body shape, JSON extraction, and schema validation. A live endpoint smoke remains the next deployment-specific check.

The original smoke adapter is not a production-quality model. It proves dataset upload, tokenization, 4-bit Gemma 4 E4B LoRA training, adapter push, and parseable held-out generation paths. The windowed 16-row adapter is also not a production-quality model, but it replaces the 128-token smoke as the current C1 training artifact because it exercises realistic 1.2k-1.5k token Clawpatch review examples and the same held-out generation smoke path.

The windowed adapter model card was updated at `ixianbride/gemma-clawpatch-review-windowed-lora-v0` so the Hub page states the 16-row pilot scope, training job, eval smoke job, and non-production quality limits.

## Immediate Next Plan Candidate

Superseded on 2026-05-24 by the later provider and comparison-tooling work
recorded in `/Users/adamjackson/Projects/gemma-training/goal-tracker.md`.
The original first implementation plan focused only on Phase 1.

Proposed first plan:

1. Add opt-in capture primitives and record schema.
2. Instrument `review` first because it has the clearest prompt, output, and validation path.
3. Add tests proving capture is off by default and correct when enabled.
4. Add a small exporter script to convert captured review records into TRL JSONL.
5. Run one local `mock` or `codex` smoke capture.

Do not start HF training until Phase 1 and a small Phase 2 capture are working.

## Sources

- Clawpatch local source: `/Users/adamjackson/Projects/gemma-training/vendor/clawpatch`
- Clawpatch provider docs: `vendor/clawpatch/docs/providers.md`
- Clawpatch feature mapping docs: `vendor/clawpatch/docs/feature-mapping.md`
- Hugging Face Jobs overview: https://huggingface.co/docs/hub/jobs-overview
- Hugging Face Jobs configuration: https://huggingface.co/docs/hub/jobs-configuration
- Hugging Face Jobs management: https://huggingface.co/docs/hub/jobs-manage
- Hugging Face TRL SFTTrainer: https://huggingface.co/docs/trl/sft_trainer
- Hugging Face TRL dataset formats: https://huggingface.co/docs/trl/dataset_formats
- Hugging Face TRL PEFT integration: https://huggingface.co/docs/trl/peft_integration
- Gemma 4 E4B IT model page: https://hf.co/google/gemma-4-E4B-it
- Gemma 4 E4B base model page: https://hf.co/google/gemma-4-E4B
- Gemma 3 4B IT model page: https://hf.co/google/gemma-3-4b-it
- CJ Zafir X profile: https://x.com/cjzafir
- Direct SLM/distillation post inspected in browser: https://x.com/cjzafir/status/2031013342115242053
