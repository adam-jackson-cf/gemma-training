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
import time
from base64 import b64encode
from pathlib import Path

import torch
from datasets import load_dataset
from huggingface_hub import HfApi
from peft import PeftModel
from transformers import AutoModelForImageTextToText, AutoTokenizer, BitsAndBytesConfig


DATASET = os.environ.get("CLAWPATCH_DATASET", "ixianbride/clawpatch-gemma-windowed-v0")
BASE_MODEL = os.environ.get("CLAWPATCH_MODEL", "google/gemma-4-E4B-it")
ADAPTER = os.environ.get("CLAWPATCH_ADAPTER", "ixianbride/gemma-clawpatch-review-windowed-lora-v0")
SPLIT = os.environ.get("CLAWPATCH_SPLIT", "test")
MAX_ROWS = int(os.environ.get("CLAWPATCH_MAX_ROWS", "8"))
MAX_INPUT_LENGTH = int(os.environ.get("CLAWPATCH_MAX_INPUT_LENGTH", "2048"))
MAX_NEW_TOKENS = int(os.environ.get("CLAWPATCH_MAX_NEW_TOKENS", "512"))
OUTPUT_REPO = os.environ.get("CLAWPATCH_OUTPUT_REPO", ADAPTER)
OUTPUT_REPO_TYPE = os.environ.get("CLAWPATCH_OUTPUT_REPO_TYPE", "model")
OUTPUT_PREFIX = os.environ.get("CLAWPATCH_OUTPUT_PREFIX", "eval/phase5-review-smoke")
CREATE_PR = os.environ.get("CLAWPATCH_OUTPUT_CREATE_PR", "").lower() in {"1", "true", "yes"}
PRINT_ARTIFACTS = os.environ.get("CLAWPATCH_PRINT_ARTIFACTS", "").lower() in {"1", "true", "yes"}
SKIP_UPLOAD = os.environ.get("CLAWPATCH_SKIP_UPLOAD", "").lower() in {"1", "true", "yes"}


def parse_json(content: str):
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def first_json_object(text: str):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    return parse_json(text[start : end + 1])


def operation(row: dict) -> str:
    return row.get("operation") or row.get("metadata", {}).get("operation") or ""


def reference_id(row: dict, index: int) -> str:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    for key in ("captureId", "featureId", "captureRunId"):
        value = metadata.get(key)
        if isinstance(value, str) and value:
            return value
    return f"row-{index + 1}"


def reference_finding_count(row: dict) -> int:
    content = row["messages"][-1]["content"]
    parsed = parse_json(content)
    findings = parsed.get("findings") if isinstance(parsed, dict) else None
    return len(findings) if isinstance(findings, list) else 0


def select_rows(rows) -> list[dict]:
    review_rows = [dict(row) for row in rows if operation(row) == "review"]
    if not review_rows:
        raise SystemExit(f"no review rows in split {SPLIT}")
    non_empty = [row for row in review_rows if reference_finding_count(row) > 0]
    clean = [row for row in review_rows if reference_finding_count(row) == 0]
    selected = []
    for left, right in zip(non_empty, clean):
        selected.extend([left, right])
        if len(selected) >= MAX_ROWS:
            return selected[:MAX_ROWS]
    for row in [*non_empty, *clean]:
        if row not in selected:
            selected.append(row)
        if len(selected) >= MAX_ROWS:
            break
    return selected


def encode_prompt(tokenizer, row: dict, device: torch.device):
    rendered = tokenizer.apply_chat_template(
        row["messages"][:-1],
        tokenize=False,
        add_generation_prompt=True,
    )
    return tokenizer(
        rendered,
        return_tensors="pt",
        truncation=True,
        max_length=MAX_INPUT_LENGTH,
    ).to(device)


def generate_text(model, tokenizer, row: dict) -> tuple[str, float]:
    batch = encode_prompt(tokenizer, row, model.device)
    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(
            **batch,
            do_sample=False,
            max_new_tokens=MAX_NEW_TOKENS,
            pad_token_id=tokenizer.eos_token_id,
        )
    elapsed_ms = (time.perf_counter() - started) * 1000
    generated = output[0, batch["input_ids"].shape[-1] :]
    return tokenizer.decode(generated, skip_special_tokens=True), elapsed_ms


def prediction_row(label: str, row: dict, index: int, text: str, elapsed_ms: float) -> dict:
    parsed = first_json_object(text)
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return {
        "referenceId": reference_id(row, index),
        "modelLabel": label,
        "metadata": {
            "captureId": metadata.get("captureId"),
            "operation": operation(row),
            "referenceFindingCount": reference_finding_count(row),
        },
        "content": json.dumps(parsed, separators=(",", ":")) if parsed is not None else text,
        "latencyMs": round(elapsed_ms, 3),
        "parseableByGenerator": parsed is not None,
    }


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows), encoding="utf8")


def summarize(label: str, rows: list[dict]) -> dict:
    return {
        "label": label,
        "rows": len(rows),
        "generatorParseableRows": sum(1 for row in rows if row["parseableByGenerator"]),
        "totalLatencyMs": round(sum(float(row["latencyMs"]) for row in rows), 3),
        "avgLatencyMs": round(sum(float(row["latencyMs"]) for row in rows) / max(1, len(rows)), 3),
    }


def upload(api: HfApi, local_path: Path, remote_path: str) -> None:
    api.upload_file(
        path_or_fileobj=str(local_path),
        path_in_repo=remote_path,
        repo_id=OUTPUT_REPO,
        repo_type=OUTPUT_REPO_TYPE,
        create_pr=CREATE_PR,
    )


def print_artifact(name: str, path: Path) -> None:
    encoded = b64encode(path.read_bytes()).decode("ascii")
    print(f"BEGIN_ARTIFACT {name} base64")
    print(encoded)
    print(f"END_ARTIFACT {name}")


def main() -> None:
    if "HF_TOKEN" not in os.environ:
        raise SystemExit("HF_TOKEN is required")
    print("dataset", DATASET)
    print("base_model", BASE_MODEL)
    print("adapter", ADAPTER)
    print("split", SPLIT)
    print("max_rows", MAX_ROWS)
    print("cuda", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu", torch.cuda.get_device_name(0))

    dataset = load_dataset(DATASET, data_files={SPLIT: f"{SPLIT}.jsonl"})
    selected = select_rows(dataset[SPLIT])
    print("selected_rows", len(selected))
    print("selected_reference_findings", [reference_finding_count(row) for row in selected])

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    quantization = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16)
    model = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL,
        quantization_config=quantization,
        device_map="auto",
        dtype=torch.bfloat16,
    )
    model.eval()

    base_rows = []
    for index, row in enumerate(selected):
        text, elapsed_ms = generate_text(model, tokenizer, row)
        base_rows.append(prediction_row("base", row, index, text, elapsed_ms))
        print("base_row", index + 1, "parseable", base_rows[-1]["parseableByGenerator"])

    model = PeftModel.from_pretrained(model, ADAPTER)
    model.eval()
    adapter_rows = []
    for index, row in enumerate(selected):
        text, elapsed_ms = generate_text(model, tokenizer, row)
        adapter_rows.append(prediction_row("adapter", row, index, text, elapsed_ms))
        print("adapter_row", index + 1, "parseable", adapter_rows[-1]["parseableByGenerator"])

    out_dir = Path("phase5-review-predictions")
    out_dir.mkdir(exist_ok=True)
    base_path = out_dir / "base.jsonl"
    adapter_path = out_dir / "adapter.jsonl"
    reference_path = out_dir / "reference.jsonl"
    summary_path = out_dir / "generation_summary.json"
    write_jsonl(base_path, base_rows)
    write_jsonl(adapter_path, adapter_rows)
    write_jsonl(reference_path, selected)
    summary = {
        "schemaVersion": 1,
        "dataset": DATASET,
        "split": SPLIT,
        "baseModel": BASE_MODEL,
        "adapter": ADAPTER,
        "maxRows": MAX_ROWS,
        "maxInputLength": MAX_INPUT_LENGTH,
        "maxNewTokens": MAX_NEW_TOKENS,
        "referenceFindingCounts": [reference_finding_count(row) for row in selected],
        "outputs": [summarize("base", base_rows), summarize("adapter", adapter_rows)],
        "note": "Small Phase 5 review batch generation only; score with evaluate-clawpatch-predictions.mjs before drawing quality conclusions.",
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf8")
    print(json.dumps(summary, indent=2))

    if PRINT_ARTIFACTS:
        print_artifact("base.jsonl", base_path)
        print_artifact("adapter.jsonl", adapter_path)
        print_artifact("generation_summary.json", summary_path)

    if SKIP_UPLOAD:
        print("upload_skipped true")
        return

    api = HfApi()
    upload(api, base_path, f"{OUTPUT_PREFIX}/base.jsonl")
    upload(api, adapter_path, f"{OUTPUT_PREFIX}/adapter.jsonl")
    upload(api, reference_path, f"{OUTPUT_PREFIX}/reference.jsonl")
    upload(api, summary_path, f"{OUTPUT_PREFIX}/generation_summary.json")
    print("uploaded_prefix", f"{OUTPUT_REPO}/{OUTPUT_PREFIX}")


if __name__ == "__main__":
    main()
