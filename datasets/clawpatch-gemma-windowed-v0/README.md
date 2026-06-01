---
license: other
task_categories:
- text-generation
language:
- en
pretty_name: Clawpatch Gemma Windowed v0
size_categories:
- n<1K
---

# Clawpatch Gemma Windowed v0

Private windowed derivative of `clawpatch-gemma-v0` for bounded Gemma LoRA training.

## Windowing Policy

- Maximum user prompt characters: 4000
- Review examples with findings retain file snippets around teacher evidence lines.
- Clean review examples retain bounded head snippets from feature files.
- The Clawpatch provider instruction, feature metadata, valid evidence paths, and JSON schema prelude are preserved unless the prelude alone exceeds the budget.
- Metadata records `windowed`, `windowStrategy`, `originalPromptBytes`, `windowPromptBytes`, `omittedPromptChars`, and `retainedFileBlocks`.

## Splits

```json
{
  "train": {
    "total": 160,
    "windowed": 157,
    "maxPromptBytes": 4000,
    "byOperation": {
      "map": 3,
      "revalidate": 3,
      "review": 154
    },
    "byWindowStrategy": {
      "prompt-clamp-no-files-section": 3,
      "unchanged": 3,
      "evidence-centered-file-window": 127,
      "clean-review-head-file-window": 27
    }
  },
  "validation": {
    "total": 46,
    "windowed": 43,
    "maxPromptBytes": 4000,
    "byOperation": {
      "map": 1,
      "revalidate": 1,
      "review": 44
    },
    "byWindowStrategy": {
      "prompt-clamp-no-files-section": 1,
      "unchanged": 3,
      "clean-review-head-file-window": 25,
      "evidence-centered-file-window": 17
    }
  },
  "test": {
    "total": 44,
    "windowed": 40,
    "maxPromptBytes": 4000,
    "byOperation": {
      "review": 44
    },
    "byWindowStrategy": {
      "clean-review-head-file-window": 24,
      "evidence-centered-file-window": 16,
      "unchanged": 4
    }
  },
  "hard_boundary": {
    "total": 30,
    "windowed": 26,
    "maxPromptBytes": 4000,
    "byOperation": {
      "map": 4,
      "revalidate": 4,
      "review": 22
    },
    "byWindowStrategy": {
      "prompt-clamp-no-files-section": 4,
      "unchanged": 4,
      "evidence-centered-file-window": 14,
      "clean-review-head-file-window": 8
    }
  },
  "all": {
    "total": 250,
    "windowed": 240,
    "maxPromptBytes": 4000,
    "byOperation": {
      "map": 4,
      "revalidate": 4,
      "review": 242
    },
    "byWindowStrategy": {
      "prompt-clamp-no-files-section": 4,
      "unchanged": 10,
      "evidence-centered-file-window": 160,
      "clean-review-head-file-window": 76
    }
  }
}
```
