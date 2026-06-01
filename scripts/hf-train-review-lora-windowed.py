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

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from datasets import load_dataset
from huggingface_hub import HfApi
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig
import torch

DATASET = os.environ.get("CLAWPATCH_DATASET", "ixianbride/clawpatch-gemma-windowed-v0")
MODEL = os.environ.get("CLAWPATCH_MODEL", "google/gemma-4-E4B-it")
OUTPUT_REPO = os.environ.get(
    "CLAWPATCH_OUTPUT_REPO",
    "ixianbride/gemma-clawpatch-review-windowed-lora-v0",
)
DATA_FILES = {"train": "train.jsonl", "validation": "validation.jsonl"}
MAX_LENGTH = int(os.environ.get("CLAWPATCH_MAX_LENGTH", "1024"))
MAX_TRAIN_ROWS = int(os.environ.get("CLAWPATCH_MAX_TRAIN_ROWS", "64"))
MAX_EVAL_ROWS = int(os.environ.get("CLAWPATCH_MAX_EVAL_ROWS", "4"))
LOAD_IN_4BIT = os.environ.get("CLAWPATCH_LOAD_IN_4BIT", "1") != "0"
GRADIENT_CHECKPOINTING = os.environ.get(
    "CLAWPATCH_GRADIENT_CHECKPOINTING",
    "1",
) != "0"


def operation(row: dict) -> str:
    return row.get("operation") or row.get("metadata", {}).get("operation", "")


def render_length(tokenizer: AutoTokenizer, row: dict) -> int:
    rendered = tokenizer.apply_chat_template(row["messages"], tokenize=False)
    return len(tokenizer(rendered, add_special_tokens=False)["input_ids"])


def prompt_length(tokenizer: AutoTokenizer, row: dict) -> int:
    rendered = tokenizer.apply_chat_template(row["messages"][:-1], tokenize=False, add_generation_prompt=True)
    return len(tokenizer(rendered, add_special_tokens=False)["input_ids"])


def select_review_rows(tokenizer: AutoTokenizer, rows, limit: int) -> list[dict]:
    scored = []
    for row in rows:
        if operation(row) != "review":
            continue
        length = render_length(tokenizer, row)
        prompt_tokens = prompt_length(tokenizer, row)
        if prompt_tokens < MAX_LENGTH - 16:
            scored.append((length, row))
    return [row for _, row in sorted(scored, key=lambda item: item[0])[:limit]]


def encode(tokenizer: AutoTokenizer, row: dict, device: torch.device) -> dict:
    prompt_messages = row["messages"][:-1]
    prompt_text = tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
    full_text = tokenizer.apply_chat_template(row["messages"], tokenize=False)
    prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
    batch = tokenizer(
        full_text,
        return_tensors="pt",
        truncation=True,
        max_length=MAX_LENGTH,
    ).to(device)
    labels = batch["input_ids"].clone()
    prompt_len = min(len(prompt_ids), labels.shape[-1])
    labels[:, :prompt_len] = -100
    if torch.all(labels == -100):
        labels[:, -1] = batch["input_ids"][:, -1]
    batch["labels"] = labels
    return batch


def mean_loss(model, tokenizer: AutoTokenizer, rows: list[dict]) -> float:
    model.eval()
    losses = []
    with torch.inference_mode():
        for row in rows:
            output = model(**encode(tokenizer, row, model.device))
            losses.append(float(output.loss.detach().cpu()))
    return sum(losses) / len(losses)


def main() -> None:
    if "HF_TOKEN" not in os.environ:
        raise SystemExit("HF_TOKEN is required")
    print("cuda", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu", torch.cuda.get_device_name(0))

    dataset = load_dataset(DATASET, data_files=DATA_FILES)
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    train_rows = select_review_rows(tokenizer, dataset["train"], MAX_TRAIN_ROWS)
    validation_rows = select_review_rows(tokenizer, dataset["validation"], MAX_EVAL_ROWS)
    train_lengths = [render_length(tokenizer, row) for row in train_rows]
    validation_lengths = [render_length(tokenizer, row) for row in validation_rows]
    print("train_rows", len(train_rows), "validation_rows", len(validation_rows))
    print("train_lengths", train_lengths)
    print("validation_lengths", validation_lengths)
    if len(train_rows) == 0 or len(validation_rows) == 0:
        raise SystemExit("review row selection failed")

    model_kwargs = {
        "device_map": "auto",
        "dtype": torch.bfloat16,
    }
    if LOAD_IN_4BIT:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    model = AutoModelForImageTextToText.from_pretrained(MODEL, **model_kwargs)
    model.config.use_cache = False
    if GRADIENT_CHECKPOINTING:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    if LOAD_IN_4BIT:
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

    baseline_eval_loss = mean_loss(model, tokenizer, validation_rows)
    print("baseline_eval_loss", baseline_eval_loss)

    optimizer = torch.optim.AdamW((param for param in model.parameters() if param.requires_grad), lr=2e-4)
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

    eval_loss = mean_loss(model, tokenizer, validation_rows)
    print("eval_loss", eval_loss)

    model.push_to_hub(OUTPUT_REPO, private=True)
    tokenizer.push_to_hub(OUTPUT_REPO, private=True)
    summary = {
        "base_model": MODEL,
        "dataset": DATASET,
        "max_length": MAX_LENGTH,
        "load_in_4bit": LOAD_IN_4BIT,
        "gradient_checkpointing": GRADIENT_CHECKPOINTING,
        "train_rows": len(train_rows),
        "validation_rows": len(validation_rows),
        "train_lengths": train_lengths,
        "validation_lengths": validation_lengths,
        "baseline_eval_loss": baseline_eval_loss,
        "losses": losses,
        "eval_loss": eval_loss,
        "note": "Windowed pilot adapter trained on review rows with assistant-only loss. This is the first bounded-quality pilot after the smoke adapter.",
    }
    with open("training_summary.json", "w", encoding="utf8") as handle:
        json.dump(summary, handle, indent=2)
    HfApi().upload_file(
        path_or_fileobj="training_summary.json",
        path_in_repo="training_summary.json",
        repo_id=OUTPUT_REPO,
        repo_type="model",
    )
    print("pushed", OUTPUT_REPO)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
