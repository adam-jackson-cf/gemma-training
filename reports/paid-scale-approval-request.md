# Paid Scale Approval Request

## Status

Approval required before execution.

This request covers the next materially larger paid campaign for the Gemma-backed Clawpatch goal. It does not approve `fix`, public dataset/model publication, validation-gate relaxation, or accepting lower quality than the goal requires.

## Preconditions

- Rotate the Hugging Face token that was exposed in prior job command metadata.
- Confirm the new token is available by presence check only.
- Keep private captures, datasets, prompts, and prediction artifacts out of the Clawpatch repository.

## Proposed Scope

- Run the corpus expansion plan in `reports/corpus-expansion-plan.json`.
- Target gaps from the current retained corpus:
  - review: +258 accepted examples
  - revalidate: +96 accepted examples
  - map: +21 accepted examples
- Minimum planning shape:
  - 6 review-heavy repositories
  - 6 revalidate-heavy repositories, after findings exist
  - 21 map-producing repositories total
- Stop after each batch for coverage, privacy, dataset, and quality-gate validation.

## Spend Controls

- Use small smoke batches before larger capture, training, or inference batches.
- Set explicit HF Jobs timeouts.
- Cancel jobs that stop producing relevant output.
- Retain job IDs, logs, summaries, and local reports after each paid step.

Current official HF Jobs pricing checked on 2026-05-24:

- `cpu-basic`: $0.01/hour
- `a10g-large`: $1.50/hour
- `a10g-largex4`: $5.00/hour
- Billing is per minute while jobs are starting or running.

Sources:

- https://huggingface.co/docs/hub/main/en/jobs-pricing
- https://huggingface.co/docs/hub/jobs-configuration

## Requested User Decision

Approve or revise:

- Maximum spend ceiling.
- Maximum repository count for the first paid batch.
- Whether to proceed with the 21-repository plan or a smaller staged subset.
- Whether Codex teacher capture spend is approved for review, map, and revalidate.
- Whether HF training/evaluation spend is approved after corpus expansion.

## Default Safe Proposal

If approved, first paid batch:

- 3 new repositories, not 21.
- Review-heavy capture first.
- Revalidate only after new findings exist.
- No new training until the expanded dataset validates locally and on HF CPU.
- Stop if accepted capture rate, privacy checks, or validation quality regress.
