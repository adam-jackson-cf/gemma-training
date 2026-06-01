# IntentPlan Requirements: Gemma Clawpatch Training Data Capture

- Lifecycle Status: requirements-frozen
- Start: 2026-05-22
- Last Updated: 2026-05-22T21:29:47Z
- Artifact Root: /Users/adamjackson/Projects/gemma-training/.enaible/intent-plan/20260522T190525Z-gemma-clawpatch-training
- Approval Status: approved
- Target Mode: brownfield
- Residual Ambiguity Score: 0.16

## Intake Summary

- Intent: Create a training-focused plan covering Phase 0, Phase 1, and Phase 2 of the Clawpatch Gemma experiment.
- Outcome: A requirements-approved IntentPlan for preparing Clawpatch to capture Codex teacher traces and collect a pilot dataset seed for a Gemma model, excluding active model training for now.
- Scope: Candidate scope includes experiment chartering, Clawpatch provider-call capture for `map`, `review`, and `revalidate`, and Codex teacher data collection from 3 suitable target repositories with at least 250 Clawpatch-validated accepted captures. Suitable target repositories must satisfy the balanced training-signal standard: public repo, permissive/open license, supported mapper ecosystem, successful `clawpatch init/map`, at least 12 source-like files, at least 5 test-like files, no weak-map result, at least 2 tech stacks across the 3 repos, at least 20 source-like files and 10 test-like files per repo where practical, validation/test commands detectable or easy to document, limited generated/vendor dominance, and enough feature diversity to produce both clean/no-finding and non-empty review captures. Phase 2 capture runs must use disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, with capture artifacts stored outside those repos under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`. A later follow-up may scale to the 5-repo, 1,000-capture dataset seed target after the pilot proves the approach.
- Non-Goals: Candidate non-goals include Hugging Face training execution, Gemma provider integration, and `fix` operation replacement unless explicitly reopened.
- Decision Boundaries: Candidate boundary is that implementation may choose conservative internal capture structure and tests, but must not silently capture secrets or alter Clawpatch default behavior.
- Context: Local research document exists at `/Users/adamjackson/Projects/gemma-training/clawpatch-gemma-training-research.md`. Clawpatch is checked out at `/Users/adamjackson/Projects/gemma-training/clawpatch` at commit `a0080cf775adeaa1e11cb2c59ae6aac21b8f129a`. Hugging Face MCP access is authenticated as `ixianbride`. Repository qualification must be based on Clawpatch-supported mapper shapes and public candidate evidence, not just local repo availability.

## Investigation Notes

- Clawpatch supports deterministic mapping for TypeScript/JavaScript, Python, Rust, Go, Java/Kotlin, Ruby, C/C++, .NET, Swift, Apple/Xcode, and Laravel/PHP repository shapes.
- Clawpatch treats a map as weak when it produces no features, only config features, less than 25% source coverage for 4 or more source files, or 2 or fewer meaningful features for 12 or more source files.
- Clawpatch review rejects findings whose evidence cites files outside prompt context, stale line ranges, or quotes that do not match current file contents.
- Public candidate inspection found stronger source/test signals than the local-only pool, including `cloudflare/vinext` (TypeScript, 560 source-like files, 329 test-like files), `encode/httpx` (Python, 23 source-like files, 39 test-like files), `pallets/click` (Python, 32 source-like files, 31 test-like files), `BurntSushi/ripgrep` (Rust, 86 source-like files, 26 test-like files), `cweill/gotests` (Go, 19 source-like files, 23 test-like files), `honojs/hono` (TypeScript, 228 source-like files, 135 test-like files), `fastify/fastify` (JavaScript/TypeScript, 69 source-like files, 228 test-like files), and `openclaw/clawpatch` (TypeScript, 53 source-like files, 13 test-like files).

## Approved Requirements

- R1: Define the training-data experiment charter for Clawpatch non-fix LLM calls.
- R2: Add opt-in Clawpatch capture for `map`, `review`, and `revalidate` provider prompts, schemas, outputs, validation outcomes, and metadata needed for SFT dataset construction.
- R3: Collect Codex teacher traces in a controlled pilot across 3 repositories with at least 250 Clawpatch-validated accepted captures, including clean/no-finding reviews and non-empty finding reviews.
- R4: Produce enough retained artifacts for a later plan to curate and upload datasets to Hugging Face.
- R5: Run Phase 2 capture in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, storing capture artifacts outside the cloned repositories under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`.
- R6: Select the 3 Phase 2 repositories using the balanced training-signal standard: public repo, permissive/open license, supported mapper ecosystem, successful `clawpatch init/map`, at least 12 source-like files, at least 5 test-like files, no weak-map result, at least 2 tech stacks across the 3 repos, at least 20 source-like files and 10 test-like files per repo where practical, validation/test commands detectable or easy to document, limited generated/vendor dominance, and enough feature diversity to produce both clean/no-finding and non-empty review captures.

## Approved Non-Goals

- NG1: Do not train Gemma in this plan.
- NG2: Do not deploy or integrate a Gemma runtime provider in this plan.
- NG3: Do not replace or train on Clawpatch `fix` calls in this plan.
- NG4: Do not commit secrets, provider credentials, or captured private transcripts into the Clawpatch repository.

## Approved Decision Boundaries

- DB1: Implementation may add a new capture module and tests if this keeps capture opt-in and avoids broad provider rewrites.
- DB2: Implementation may choose JSONL capture format details if the record preserves prompt, schema, raw output, accepted output, validation status, operation, provider metadata, repo metadata, and redaction state.
- DB3: Implementation must ask for review if capture requirements conflict with Clawpatch security guidance or require default transcript persistence.
- DB4: Implementation may define the concrete `repo-name` and `run-id` naming scheme if it keeps captures outside cloned repositories and makes each pilot run repeatable.
- DB5: Implementation may select the exact 3 public repositories from candidates that satisfy the balanced training-signal standard, and must record any rejected candidates and reasons.

## Approved Feature Boundaries

- F1: Experiment charter and baseline scope. Intended outcome: approved training-data objective, source operations, repository selection rule, privacy boundary, and success criteria.
- F2: Opt-in provider capture instrumentation. Intended outcome: Clawpatch can write capture records for selected non-fix provider calls without changing normal CLI behavior.
- F3: Codex teacher trace collection workflow. Intended outcome: repeatable disposable local clone runs and retained outputs for collecting initial teacher traces suitable for later dataset curation.

## Approved Constraints

- C1: Work must follow the existing TypeScript CLI patterns in `/Users/adamjackson/Projects/gemma-training/clawpatch`.
- C2: Capture must be opt-in and off by default.
- C3: `fix` capture and replacement are out of scope unless explicitly approved later.
- C4: Captured data must be treated as private training material and not committed by default.
- C5: Quality gates must not be skipped, loosened, or bypassed.
- C6: Phase 2 capture runs must take place in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, and capture artifacts must be stored under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`.
- C7: Phase 2 repositories must satisfy the balanced training-signal standard before they count toward the 3-repository pilot.

## Approved Acceptance Criteria

- AC1: Phase 1 captures `map`, `review`, and `revalidate`.
- AC2: Requirements define accepted capture record fields and redaction/privacy rules.
- AC3: Phase 2 pilot target is 3 repositories and at least 250 accepted captures across `map`, `review`, and `revalidate`, with a recorded follow-up path to the 5-repository, 1,000-accepted-capture dataset seed target after the pilot proves the approach.
- AC4: A capture counts as accepted only if the output is schema-valid and passes Clawpatch operation-specific validation, including review evidence/path/line validation where applicable; full human or second-model triage is not required for every pilot capture, but the plan includes a smaller triaged evaluation subset before later training.
- AC5: Requirements define which implementation boundaries require user review.
- AC6: Phase 2 capture runs take place in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, and capture artifacts are stored outside those cloned repositories under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`.
- AC7: A Phase 2 repository qualifies only if it satisfies the balanced training-signal standard, and the collection workflow records the final 3 selected repositories and any rejected candidates with reasons.

## Approval Log

- 2026-05-22T19:05:25Z Requirements gathering started.
- 2026-05-22T19:19:30Z Round 1 scope decision approved: capture `map`, `review`, and `revalidate` from the start. Rejected branches: `review` only; `review` plus `revalidate`.
- 2026-05-22T19:26:43Z Round 2 collection target approved: pilot target of 3 repositories and at least 250 accepted captures, with a follow-up path to the 5-repository, 1,000-capture dataset seed target after the approach is proven.
- 2026-05-22T19:28:00Z Round 3 pressure-pass decision approved: accepted captures must be schema-valid and pass Clawpatch validation; full triage is not required for every pilot capture, but a triaged evaluation subset remains required before later training.
- 2026-05-22T19:31:04Z Requirements checkpoint approved and lifecycle moved to requirements-frozen.
- 2026-05-22T19:33:14Z Requirements reopened because the Phase 2 capture execution location and storage boundary were missing.
- 2026-05-22T19:36:15Z Round 4 capture location decision approved: run Phase 2 capture in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, with capture artifacts under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`.
- 2026-05-22T19:37:32Z Requirements remain open because the Phase 2 target repository qualification criteria are missing.
- 2026-05-22T19:41:27Z Repository qualification investigation completed using Clawpatch mapper/review docs, mapper weak-map rules, and public GitHub candidate metadata.
- 2026-05-22T19:51:38Z Round 6 repository qualification decision approved: use the balanced training-signal standard.
- 2026-05-22T21:29:47Z Updated requirements checkpoint confirmed and lifecycle moved to requirements-frozen.
