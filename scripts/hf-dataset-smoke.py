# /// script
# dependencies = ["datasets", "transformers", "huggingface_hub", "jinja2"]
# ///
import json
import os

from datasets import load_dataset
from transformers import AutoTokenizer

DATASET = os.environ.get("CLAWPATCH_DATASET", "ixianbride/clawpatch-gemma-review-v0")
MODEL = os.environ.get("CLAWPATCH_MODEL", "google/gemma-4-E4B-it")
MAX_EXPECTED_TOKENS = int(os.environ.get("CLAWPATCH_MAX_EXPECTED_TOKENS", "0"))
OPERATION_FILTER = os.environ.get("CLAWPATCH_OPERATION_FILTER", "")
DATA_FILES = {
    "train": "train.jsonl",
    "validation": "validation.jsonl",
    "test": "test.jsonl",
    "hard_boundary": "hard_boundary.jsonl",
}


def main() -> None:
    dataset = load_dataset(DATASET, data_files=DATA_FILES)
    print("splits", {name: len(split) for name, split in dataset.items()})

    for split_name, split in dataset.items():
        if len(split) == 0:
            raise SystemExit(f"{split_name} is empty")
        row = split[0]
        if len(row["messages"]) != 3:
            raise SystemExit(f"{split_name} row has {len(row['messages'])} messages")
        json.loads(row["messages"][2]["content"])

    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    lengths = []
    for split_name in DATA_FILES:
        rows = dataset[split_name]
        if OPERATION_FILTER:
            rows = rows.filter(
                lambda row: (row.get("operation") or row.get("metadata", {}).get("operation"))
                == OPERATION_FILTER
            )
        for row in rows.select(range(min(8, len(rows)))):
            rendered = tokenizer.apply_chat_template(row["messages"], tokenize=False)
            token_ids = tokenizer(rendered, add_special_tokens=False)["input_ids"]
            lengths.append((split_name, len(token_ids)))

    print("token_lengths", lengths)
    max_tokens = max(length for _, length in lengths)
    print("max_tokens", max_tokens)
    if MAX_EXPECTED_TOKENS > 0 and max_tokens > MAX_EXPECTED_TOKENS:
        raise SystemExit(f"max_tokens {max_tokens} exceeds {MAX_EXPECTED_TOKENS}")
    print("cpu smoke ok")


if __name__ == "__main__":
    main()
