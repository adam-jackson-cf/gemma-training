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
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig
import torch

DATASET = "ixianbride/clawpatch-gemma-review-v0"
MODEL = "google/gemma-4-E4B-it"
DATA_FILES = {"train": "train.jsonl", "validation": "validation.jsonl"}


def main() -> None:
    print("cuda", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu", torch.cuda.get_device_name(0))

    dataset = load_dataset(DATASET, data_files=DATA_FILES)
    tokenizer = AutoTokenizer.from_pretrained(MODEL)

    short_rows = []
    for row in dataset["train"]:
        rendered = tokenizer.apply_chat_template(row["messages"], tokenize=False)
        length = len(tokenizer(rendered, add_special_tokens=False)["input_ids"])
        if length <= 4096:
            short_rows.append((length, row))
    short_rows = sorted(short_rows, key=lambda item: item[0])[:2]
    print("short_lengths", [length for length, _ in short_rows])
    if len(short_rows) < 2:
        raise SystemExit("not enough short rows for smoke")

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

    row = short_rows[0][1]
    text = tokenizer.apply_chat_template(row["messages"], tokenize=False)
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512).to(model.device)
    labels = inputs["input_ids"].clone()

    model.train()
    output = model(**inputs, labels=labels)
    print("loss", float(output.loss.detach().cpu()))
    output.loss.backward()
    print("backward ok")
    print("tiny gpu smoke ok")


if __name__ == "__main__":
    main()
