# IntentPlan: Gemma Clawpatch Training Data Capture

- Lifecycle Status: completed
- Start: 2026-05-22
- Last Updated: 2026-05-22T22:55:00Z
- Artifact Root: `/Users/adamjackson/Projects/gemma-training/.enaible/intent-plan/20260522T190525Z-gemma-clawpatch-training`
- Validation Status: pass
- Final Approval Status: not-requested
- Target Mode: brownfield
- Residual Ambiguity Score: 0.16

## Golden Rules - how to use this Plan (_must follow_, always active)

This plan is the living document - you must implement the features in order and complete each one e2e before moving onto the next. You _MUST_ keep it updated as you action it, ensure you follow these golden rules:

- If an implementation-time decision changes any intent, constraint, or acceptance criterion, update the corresponding `Intent Ledger` risk to `requires review`.
- If implementation discovers that an acceptance criterion cannot be met as written, leave its `Acceptance Tracker` status incomplete and update the corresponding `Intent Ledger` risk to `requires review`.
- If implementation discovers that a constraint cannot be satisfied as written, keep the constraint unchanged and update every affected `Intent Ledger` risk to `requires review`.
- If implementation adds, removes, or materially changes a BDD scenario, update every linked `Intent Ledger` and `Acceptance Tracker` reference in the same edit.
- If implementation evidence is unavailable, do not enter passing evidence; record the blocker or limitation in `Progress Log` and leave the acceptance criterion incomplete.
- Keep mutable status single-sourced: acceptance status belongs in `Acceptance Tracker`; chronological implementation notes belong in `Progress Log`; decisions belong in `Decision Log`; architectural decisions belong in `ADR Log`.
- Keep `Acceptance Tracker`, `Progress Log`, `Decision Log`, and `ADR Log` updated throughout implementation whenever evidence, status, decisions, or architectural consequences change.
- When you have completed the whole plan, include a summary of every intent whose risk is `requires review` in the completion message to the user.

## Planned feature(s) purpose / big picture

This plan prepares the Clawpatch checkout at `/Users/adamjackson/Projects/gemma-training/clawpatch` for a future Gemma fine-tuning experiment by delivering the Phase 0, Phase 1, and Phase 2 training-data pipeline. The end state is a verified capture and teacher-data collection workflow, not a trained model and not a Gemma runtime provider.

Implementation must complete each Feature Dashboard row as a coherent capability before moving to the next row. F1 first establishes the retained experiment charter so the operation scope, non-goals, privacy boundary, repository qualification rule, pilot target, and user-review boundaries are explicit. F2 then adds opt-in capture for Clawpatch `map`, `review`, and `revalidate` calls without changing normal CLI behavior. F3 finally uses disposable local cloned workspaces to collect a pilot Codex teacher corpus from 3 qualified public repositories, storing private capture artifacts outside the cloned repositories and producing retained artifacts for a later plan to curate and upload datasets to Hugging Face.

The training-data quality bar is Clawpatch validation. A capture counts as accepted only when the provider output is schema-valid and passes operation-specific Clawpatch validation, including review evidence/path/line validation where applicable. The pilot target is at least 250 accepted captures across `map`, `review`, and `revalidate`; the follow-up path is a larger 5-repository, 1,000-accepted-capture dataset seed after the pilot proves the approach.

## Feature Dashboard

| Feature | Outcome | Intents | Acceptance | Scenarios | Evidence Planned | Evidence Passed | Risk | Status |
| ------- | ------- | ------- | ---------- | --------- | ---------------- | --------------- | ---- | ------ |
| F1 Experiment charter and baseline scope | Approved training-data objective, source operations, repository selection rule, privacy boundary, and success criteria. | 1 | 1 | 1 | 2 | 2 | medium | passed |
| F2 Opt-in provider capture instrumentation | Clawpatch can write capture records for selected non-fix provider calls without changing normal CLI behavior. | 1 | 3 | 3 | 8 | 8 | medium | passed |
| F3 Codex teacher trace collection workflow | Repeatable disposable local clone runs and retained outputs collect initial teacher traces suitable for later Hugging Face dataset curation and upload planning. | 1 | 3 | 3 | 6 | 6 | medium | passed |

## Intent Ledger

| Intent | Feature | Outcome | Constraints | Acceptance | Scenarios | Risk |
| ------ | ------- | ------- | ----------- | ---------- | --------- | ---- |
| I1 Charter the training-data experiment | F1 | The experiment has a retained charter for non-fix Clawpatch training data with explicit operation scope, non-goals, decision boundaries, privacy posture, repository qualification rule, pilot target, follow-up scale target, and success criteria. | C3, C4 | AC5 | S1 | medium |
| I2 Capture validated non-fix provider calls | F2 | Clawpatch can opt in to capture `map`, `review`, and `revalidate` provider calls with prompt, schema, raw output, accepted output, validation status, operation, provider metadata, repo metadata, redaction state, and rejected-record evidence for later SFT curation. Suspected secrets must be masked before persistence, or the record must be downgraded to metadata-only rejected/eval material when safe masking is not possible. | C1, C2, C4, C5 | AC1, AC2, AC4 | S2, S3, S4 | medium |
| I3 Collect a qualified pilot Codex corpus | F3 | The pilot workflow selects 3 qualified public repositories, runs capture in disposable local cloned workspaces, and retains at least 250 Clawpatch-validated accepted captures plus selection, follow-up-scale, and later Hugging Face dataset curation/upload planning evidence. | C4, C5, C6, C7 | AC3, AC6, AC7 | S5, S6, S7 | medium |

## Feature Constraints

| Constraint ID | Applies To | Constraint | Verification |
| ------------- | ---------- | ---------- | ------------ |
| C1 | F2 | Work must follow the existing TypeScript CLI patterns in `/Users/adamjackson/Projects/gemma-training/clawpatch`. Implementation may add a new capture module and tests if this keeps capture opt-in and avoids broad provider rewrites. | Inspect new capture code and call sites against existing provider, app, mapper, and test patterns. |
| C2 | F2 | Capture must be opt-in and off by default. | Automated tests and a CLI smoke check verify no capture files are written unless capture is enabled. |
| C3 | F1 | `fix` capture and replacement are out of scope unless explicitly approved later. | Charter inspection verifies `fix` remains out of scope and no acceptance criterion requires `fix` capture. |
| C4 | F1, F2, F3 | Captured data must be treated as private training material and not committed by default. Do not commit secrets, provider credentials, or captured private transcripts into the Clawpatch repository. Capture persistence must scan prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and capture summaries for common secrets and provider credentials before writing content; suspected secrets must be masked and reflected in `redaction state`, and records that cannot be safely masked must be stored as metadata-only rejected/eval material. Implementation must ask for review if capture requirements conflict with Clawpatch security guidance or require default transcript persistence. | Inspect artifact paths, `.gitignore` or exclusion behavior, capture docs, collection notes, redaction tests, summary artifacts, and review-trigger notes for private-output handling. |
| C5 | F2, F3 | Quality gates must not be skipped, loosened, or bypassed. | Retained evidence includes focused tests plus existing lint, typecheck, test, and relevant Clawpatch quality gates, or a recorded blocker if a gate cannot run. |
| C6 | F3 | Phase 2 capture runs must take place in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, and capture artifacts must be stored under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`. Implementation may define the concrete `repo-name` and `run-id` naming scheme if it keeps captures outside cloned repositories and makes each pilot run repeatable. | Collection workflow and sample run evidence show cloned workspace paths and capture artifact paths match the required layout and repeatable naming behavior. |
| C7 | F3 | Phase 2 repositories must satisfy the balanced training-signal standard before they count toward the 3-repository pilot: public repo, permissive/open license, supported mapper ecosystem, successful `clawpatch init/map`, at least 12 source-like files, at least 5 test-like files, no weak-map result, at least 2 tech stacks across the 3 repos, at least 20 source-like files and 10 test-like files per repo where practical, validation/test commands detectable or easy to document, limited generated/vendor dominance, and enough feature diversity to produce both clean/no-finding and non-empty review captures. | Repository qualification report verifies the standard for selected and rejected candidates. |

## Acceptance Tracker

| AC | Intent | Acceptance Criterion | Validation Types | Initial Failures | Passing Evidence | Status |
| --- | ------ | -------------------- | ---------------- | ---------------- | ---------------- | ------ |
| AC1 | I2 | Phase 1 captures `map`, `review`, and `revalidate`. | automated test, sample capture inspection | 0 | `pnpm -s vitest run src/capture.test.ts src/capture-workflow.test.ts`; `src/capture-workflow.test.ts` verifies accepted `map`, `review`, and `revalidate` records when capture is enabled and no capture file when disabled. | passed |
| AC2 | I2 | Requirements define accepted capture record fields and redaction/privacy rules, including pre-persistence scanning of prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and capture summaries; masking suspected secrets; setting `redaction state`; and downgrading records that cannot be safely masked to metadata-only rejected/eval material. | automated test, code inspection, capture schema inspection | 1 | `src/capture.ts`, `src/capture.test.ts`, and `docs/training-data-capture.md`; first `pnpm -s lint` found `unicorn(no-array-sort)` in `src/capture.ts`, then passed after fix. | passed |
| AC3 | I3 | Phase 2 pilot target is 3 repositories and at least 250 accepted captures across `map`, `review`, and `revalidate`, with a recorded follow-up path to the 5-repository, 1,000-accepted-capture dataset seed target after the pilot proves the approach. | collection report, artifact inspection | 0 | `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/summary.json` records 250 accepted captures across `map`, `review`, and `revalidate`; `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/collection-report.md` records the follow-up path. | passed |
| AC4 | I2 | A capture counts as accepted only if the output is schema-valid and passes Clawpatch operation-specific validation, including review evidence/path/line validation where applicable; full human or second-model triage is not required for every pilot capture, but the plan includes a smaller triaged evaluation subset before later training. The triaged evaluation subset must include at least 30 accepted captures or 10% of accepted captures, whichever is larger, cover `map`, `review`, and `revalidate`, include clean/no-finding and non-empty review examples where available, and retain artifact fields for capture id, operation, repo, validation status, triage status, triage reviewer or method, and triage notes. | automated test, validation summary, triage subset artifact | 0 | `src/agent-mapper.ts`, `src/app.ts`, `src/capture-workflow.test.ts`, `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/summary.json`, and `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/triage-subset.jsonl`; subset has 30 records covering `map`, `review`, `revalidate`, clean/no-finding, and non-empty review tags. | passed |
| AC5 | I1 | Requirements define which implementation boundaries require user review. | charter inspection, requirements inspection | 0 | `docs/training-data-capture.md` user review boundaries and privacy boundary. | passed |
| AC6 | I3 | Phase 2 capture runs take place in disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`, and capture artifacts are stored outside those cloned repositories under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`. | collection workflow inspection, sample run artifact inspection | 0 | Disposable workspaces exist under `/Users/adamjackson/Projects/gemma-training/teacher-runs/click/`, `/Users/adamjackson/Projects/gemma-training/teacher-runs/ripgrep/`, and `/Users/adamjackson/Projects/gemma-training/teacher-runs/hono/`; capture artifacts are under `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/`. | passed |
| AC7 | I3 | A Phase 2 repository qualifies only if it satisfies the balanced training-signal standard, and the collection workflow records the final 3 selected repositories and any rejected candidates with reasons. | repository qualification report, collection report | 0 | `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/repository-qualification.json` records selected `click`, `ripgrep`, and `hono` plus rejected candidates with reasons; `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/collection-report.md` summarizes counts and follow-up path. | passed |

## BDD Scenario Table

| Scenario | Intent | AC | Priority | Given | When | Then | Evidence Method |
| -------- | ------ | --- | -------- | ----- | ---- | ---- | --------------- |
| S1 | I1 | AC5 | P0 | Given the frozen Phase 0-2 requirements | When the experiment charter is produced | Then it states the approved operation scope, non-goals, decision boundaries, privacy boundary, repository qualification rule, pilot target, follow-up scale target, and user-review boundaries without adding Gemma training or `fix` replacement, including that secrets, provider credentials, or captured private transcripts must not be committed into the Clawpatch repository, and that implementation must ask for review if capture requirements conflict with Clawpatch security guidance or require default transcript persistence. | Charter artifact inspection against `requirements.md` |
| S2 | I2 | AC1 | P0 | Given capture is enabled in a fixture or smoke run | When Clawpatch executes `map`, `review`, and `revalidate` provider calls | Then capture records are written for all three operations and no `fix` capture is required. | Focused automated test output plus sample capture artifacts |
| S3 | I2 | AC2 | P0 | Given capture is enabled | When a provider call completes or fails | Then the capture pipeline scans prompts, raw outputs, accepted outputs, provider metadata, repo metadata, rejected records, and capture summaries before persistence; masks suspected secrets; sets `redaction state`; downgrades records that cannot be safely masked to metadata-only rejected/eval material; and writes records with prompt, schema, raw output when available and safe, accepted output when available and safe, validation status, operation, provider metadata, repo metadata, and enough error detail for later curation. | Capture schema test, redaction test, and sample JSONL inspection |
| S4 | I2 | AC4 | P0 | Given provider output includes invalid schema, invalid review evidence, invalid line ranges, or suspected secrets that cannot be safely masked | When the capture pipeline classifies accepted versus rejected records | Then only schema-valid, operation-validated outputs count as accepted; unsafe unmaskable records are downgraded to metadata-only rejected/eval material; rejected records remain available as rejected/eval material without inflating the accepted count; and the triaged evaluation subset contains at least 30 accepted captures or 10% of accepted captures, whichever is larger, across `map`, `review`, and `revalidate` with clean/no-finding and non-empty review examples where available. | Validation test output, capture summary report, and triage subset artifact |
| S5 | I3 | AC7 | P0 | Given a public candidate repository list | When repository qualification runs | Then the final 3 selected repositories satisfy the balanced training-signal standard and rejected candidates are recorded with reasons, including public repo, permissive/open license, supported mapper ecosystem, successful `clawpatch init/map`, at least 12 source-like files, at least 5 test-like files, no weak-map result, at least 2 tech stacks across the 3 repos, at least 20 source-like files and 10 test-like files per repo where practical, validation/test commands detectable or easy to document, limited generated/vendor dominance, and enough feature diversity to produce both clean/no-finding and non-empty review captures. | Repository qualification report |
| S6 | I3 | AC6 | P0 | Given a selected repository | When the Phase 2 teacher workflow starts capture | Then it clones or refreshes a disposable local workspace under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/` and writes capture artifacts under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`. | Collection workflow log plus artifact path inspection |
| S7 | I3 | AC3 | P1 | Given the capture instrumentation passes focused tests and 3 repositories are qualified | When the pilot Codex teacher workflow completes | Then the retained collection report shows at least 250 Clawpatch-validated accepted captures across `map`, `review`, and `revalidate`, includes clean/no-finding and non-empty review examples, records the follow-up path to 5 repositories and 1,000 accepted captures, and produces enough retained artifacts for a later plan to curate and upload datasets to Hugging Face. | Collection report, capture counts, and artifact directory inspection |

## Progress Log

- 2026-05-22T19:05:25Z IntentPlan created and requirements gathering started.
- 2026-05-22T21:29:47Z Requirements frozen after updated checkpoint confirmation.
- 2026-05-22T21:29:47Z IntentPlan populated from approved Phase 0-2 requirements.
- 2026-05-22T21:37:09Z Structural validator and Step 3 plan-validation passed; lifecycle set to `validated`.
- 2026-05-22T21:38:24Z Plan-judge returned `PASS WITH GAPS`; tightened secret-handling and triaged evaluation subset standards before rerunning validation.
- 2026-05-22T21:51:52Z Implemented Phase 0 charter docs, opt-in capture instrumentation for `map`, `review`, and `revalidate`, capture redaction/persistence tests, full capture workflow tests, private artifact ignore rules, and Phase 2 teacher collection workflow/script. Validation passed with `pnpm -s lint`, `pnpm -s format:check`, `pnpm -s typecheck`, and `pnpm -s test`.
- 2026-05-22T21:51:52Z Actual Phase 2 Codex teacher collection was not run in this implementation pass, so AC3, the triage subset artifact portion of AC4, sample run artifact inspection for AC6, and repository qualification report evidence for AC7 remain in-progress.
- 2026-05-22T22:54:24Z Completed pilot capture run `20260522T220000Z-pilot` with 250 accepted captures: 4 `map`, 242 `review`, and 4 `revalidate`. Capture artifacts are stored under `/Users/adamjackson/Projects/gemma-training/captures/20260522T220000Z-pilot/`.
- 2026-05-22T22:55:00Z Produced retained collection artifacts: `summary.json`, `captures.jsonl`, `collection-report.md`, `repository-qualification.json`, and `triage-subset.jsonl`. The triage subset has 30 records and covers `map`, `review`, `revalidate`, clean/no-finding, and non-empty review examples.

## Decision Log

- D1 Decision: Capture `map`, `review`, and `revalidate` from the start.
  - Rationale: The user selected Option 3 so the training-focused plan covers all non-fix Clawpatch provider calls rather than starting with review-only capture.
  - Date: 2026-05-22
- D2 Decision: Use a 3-repository, 250-accepted-capture pilot target with a follow-up path to 5 repositories and 1,000 accepted captures.
  - Rationale: The user selected the pilot target and explicitly requested the larger dataset-seed target as a follow-up after the approach is proven.
  - Date: 2026-05-22
- D3 Decision: Count only schema-valid, Clawpatch-validated outputs as accepted pilot captures.
  - Rationale: The user selected the Clawpatch-validated quality gate, preserving data quality without requiring full human or second-model triage for every pilot record.
  - Date: 2026-05-22
- D4 Decision: Run Phase 2 capture in disposable local cloned workspaces and store captures outside the cloned repositories.
  - Rationale: The user selected disposable local cloned workspaces under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/` and capture artifacts under `/Users/adamjackson/Projects/gemma-training/captures/run-id/`.
  - Date: 2026-05-22
- D5 Decision: Use the balanced training-signal standard for repository qualification.
  - Rationale: The user selected the standard after Clawpatch mapper rules and public GitHub candidates were investigated.
  - Date: 2026-05-22

## ADR Log

- ADR-001: Use opt-in Clawpatch capture as the training data source for non-fix provider calls.
  - Status: accepted
  - Context: Clawpatch has an existing provider boundary for `map`, `review`, `fix`, and `revalidate`, with strict schemas and operation-specific validation. The approved scope excludes `fix`.
  - Decision: Add opt-in capture around `map`, `review`, and `revalidate` so Codex teacher prompts and validated outputs can be retained for later Gemma SFT dataset curation.
  - Consequences: Capture implementation must preserve default behavior, prevent secret leakage, retain rejected records separately from accepted records, and keep later Hugging Face training outside this plan.

## Table Column Guide

| Section            | Column           | Expected Value                                                                                                                                                                                                                   |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature Dashboard  | Evidence Planned | Non-negative integer count of planned validation evidence items for the feature.                                                                                                                                                 |
| Feature Dashboard  | Evidence Passed  | Non-negative integer count of planned validation evidence items that currently have passing retained evidence.                                                                                                                   |
| Feature Dashboard  | Risk             | Highest linked `Intent Ledger` risk, using `requires review` > `high` > `medium` > `low`.                                                                                                                                        |
| Feature Dashboard  | Status           | Aggregate linked `Acceptance Tracker` status: `blocked` if any linked acceptance is blocked, `passed` if all linked acceptance has passed, `in-progress` if any linked acceptance is in progress or passed, otherwise `planned`. |
| Acceptance Tracker | Initial Failures | `TBD` before validation starts, then a non-negative integer count of failed validation attempts before success.                                                                                                                  |
| Acceptance Tracker | Passing Evidence | `TBD` until passed, then a concise retained evidence reference such as a command, test name, report path, or review note.                                                                                                        |
