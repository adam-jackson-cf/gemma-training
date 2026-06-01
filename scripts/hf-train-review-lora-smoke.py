# /// script
# dependencies = [
#   "torch",
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

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig
import torch

DATASET = "ixianbride/clawpatch-gemma-review-v0"
MODEL = "google/gemma-4-E4B-it"
OUTPUT_REPO = "ixianbride/gemma-clawpatch-review-lora-v0"
DATA_FILES = {"train": "train.jsonl", "validation": "validation.jsonl"}
MAX_LENGTH = 128
MAX_TRAIN_ROWS = 8


def render_length(tokenizer: AutoTokenizer, row: dict) -> int:
    rendered = tokenizer.apply_chat_template(row["messages"], tokenize=False)
    return len(tokenizer(rendered, add_special_tokens=False)["input_ids"])


def select_short_rows(tokenizer: AutoTokenizer, rows, limit: int) -> list[dict]:
    scored = []
    for row in rows:
        length = render_length(tokenizer, row)
        if length <= 4096:
            scored.append((length, row))
    return [row for _, row in sorted(scored, key=lambda item: item[0])[:limit]]


def encode(tokenizer: AutoTokenizer, row: dict, device: torch.device) -> dict:
    text = tokenizer.apply_chat_template(row["messages"], tokenize=False)
    batch = tokenizer(text, return_tensors="pt", truncation=True, max_length=MAX_LENGTH).to(device)
    batch["labels"] = batch["input_ids"].clone()
    return batch


def main() -> None:
    if "HF_TOKEN" not in os.environ:
        raise SystemExit("HF_TOKEN is required")
    print("cuda", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu", torch.cuda.get_device_name(0))

    dataset = load_dataset(DATASET, data_files=DATA_FILES)
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    train_rows = select_short_rows(tokenizer, dataset["train"], MAX_TRAIN_ROWS)
    validation_rows = select_short_rows(tokenizer, dataset["validation"], 1)
    print("train_rows", len(train_rows), "validation_rows", len(validation_rows))
    if len(train_rows) == 0 or len(validation_rows) == 0:
        raise SystemExit("short row selection failed")

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL,
        quantization_config=quantization,
        device_map="auto",
        torch_dtype=torch.bfloat16,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model = prepare_model_for_kbit_training(model)
    model.enable_input_require_grads()
    model = get_peft_model(
        model,
        LoraConfig(
            r=4,
            lora_alpha=8,
            lora_dropout=0.0,
            bias="none",
            target_modules=["linear"],
        ),
    )
    model.print_trainable_parameters()

    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4)
    model.train()
    losses = []
    for step, row in enumerate(train_rows, start=1):
        optimizer.zero_grad(set_to_none=True)
        output = model(**encode(tokenizer, row, model.device))
        loss = output.loss
        loss.backward()
        optimizer.step()
        value = float(loss.detach().cpu())
        losses.append(value)
        print("step", step, "loss", value)

    model.eval()
    eval_output = model(**encode(tokenizer, validation_rows[0], model.device))
    eval_loss = float(eval_output.loss.detach().cpu())
    print("eval_loss", eval_loss)

    model.push_to_hub(OUTPUT_REPO, private=True)
    tokenizer.push_to_hub(OUTPUT_REPO, private=True)
    card = {
        "base_model": MODEL,
        "dataset": DATASET,
        "max_length": MAX_LENGTH,
        "train_rows": len(train_rows),
        "losses": losses,
        "eval_loss": eval_loss,
        "note": "Small smoke adapter. Not production quality; proves Gemma 4 E4B LoRA training and Hub push path.",
    }
    with open("training_summary.json", "w", encoding="utf8") as handle:
        json.dump(card, handle, indent=2)
    from huggingface_hub import HfApi

    HfApi().upload_file(
        path_or_fileobj="training_summary.json",
        path_in_repo="training_summary.json",
        repo_id=OUTPUT_REPO,
        repo_type="model",
    )
    print("pushed", OUTPUT_REPO)
    print(json.dumps(card, indent=2))


if __name__ == "__main__":
    main()
