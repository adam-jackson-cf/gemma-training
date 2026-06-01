# /// script
# dependencies = [
#   "torch==2.8.0",
#   "datasets",
#   "transformers",
#   "peft",
#   "accelerate",
#   "bitsandbytes",
#   "jinja2",
#   "huggingface_hub",
# ]
# ///
import json
import os

from datasets import load_dataset
from huggingface_hub import HfApi
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig
import torch

DATASET = os.environ.get("CLAWPATCH_DATASET", "ixianbride/clawpatch-gemma-review-v0")
BASE_MODEL = os.environ.get("CLAWPATCH_MODEL", "google/gemma-4-E4B-it")
ADAPTER = os.environ.get("CLAWPATCH_ADAPTER", "ixianbride/gemma-clawpatch-review-lora-v0")
DATA_FILES = {"validation": "validation.jsonl"}
MAX_INPUT_LENGTH = 2048
MAX_NEW_TOKENS = 512


def first_json_object(text: str) -> dict | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def select_review_row(tokenizer: AutoTokenizer, rows) -> dict:
    candidates = []
    for row in rows:
        operation = row.get("operation") or row.get("metadata", {}).get("operation")
        if operation != "review":
            continue
        prompt_messages = row["messages"][:-1]
        rendered = tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
        length = len(tokenizer(rendered, add_special_tokens=False)["input_ids"])
        candidates.append((length, row))
    if not candidates:
        raise SystemExit("no validation review rows")
    return sorted(candidates, key=lambda item: item[0])[0][1]


def encode_prompt(tokenizer: AutoTokenizer, row: dict, device: torch.device) -> dict:
    rendered = tokenizer.apply_chat_template(row["messages"][:-1], tokenize=False, add_generation_prompt=True)
    return tokenizer(
        rendered,
        return_tensors="pt",
        truncation=True,
        max_length=MAX_INPUT_LENGTH,
    ).to(device)


def generate_text(model, tokenizer: AutoTokenizer, batch: dict) -> str:
    with torch.inference_mode():
        output = model.generate(
            **batch,
            do_sample=False,
            max_new_tokens=MAX_NEW_TOKENS,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = output[0, batch["input_ids"].shape[-1] :]
    return tokenizer.decode(generated, skip_special_tokens=True)


def summarize(name: str, text: str) -> dict:
    parsed = first_json_object(text)
    return {
        "name": name,
        "json_parseable": parsed is not None,
        "top_level_keys": sorted(parsed.keys()) if isinstance(parsed, dict) else [],
        "preview": text[:500],
    }


def main() -> None:
    if "HF_TOKEN" not in os.environ:
        raise SystemExit("HF_TOKEN is required")
    print("cuda", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu", torch.cuda.get_device_name(0))

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    dataset = load_dataset(DATASET, data_files=DATA_FILES)
    row = select_review_row(tokenizer, dataset["validation"])
    expected = first_json_object(row["messages"][-1]["content"])

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL,
        quantization_config=quantization,
        device_map="auto",
        dtype=torch.bfloat16,
    )
    model.eval()
    batch = encode_prompt(tokenizer, row, model.device)
    base_text = generate_text(model, tokenizer, batch)
    print("base", base_text[:300])

    model = PeftModel.from_pretrained(model, ADAPTER)
    model.eval()
    adapter_text = generate_text(model, tokenizer, batch)
    print("adapter", adapter_text[:300])

    report = {
        "base_model": BASE_MODEL,
        "adapter": ADAPTER,
        "dataset": DATASET,
        "max_input_length": MAX_INPUT_LENGTH,
        "max_new_tokens": MAX_NEW_TOKENS,
        "expected_top_level_keys": sorted(expected.keys()) if isinstance(expected, dict) else [],
        "results": [
            summarize("base", base_text),
            summarize("adapter", adapter_text),
        ],
        "note": "Tiny held-out generation smoke only. This checks parseability path, not model quality.",
    }
    with open("eval_smoke.json", "w", encoding="utf8") as handle:
        json.dump(report, handle, indent=2)
    HfApi().upload_file(
        path_or_fileobj="eval_smoke.json",
        path_in_repo="eval_smoke.json",
        repo_id=ADAPTER,
        repo_type="model",
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
