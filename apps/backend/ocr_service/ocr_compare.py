#!/usr/bin/env python3
"""
OCR config comparison harness.

Runs one or more images through a matrix of PaddleOCR configurations and prints
each recognized text + average confidence side by side, so we can measure the
accuracy effect of individual levers WITHOUT touching the production pipeline:

  - model generation (PP-OCRv5_server vs PP-OCRv6_medium)
  - the doc-preprocessor (UVDoc unwarping + doc-orientation), which PaddleOCR 3.x
    turns on by default and which can truncate edges on flat scans
  - detection sizing/box tuning (limit_side_len, unclip_ratio)

It reuses ocr_runner's block-grouping so the text is directly comparable to what
production stores. Images are read RAW (no Node-side grayscale/sharpen/normalize
preprocessing), so diffing a run here against the DB's stored raw_text also
isolates the effect of that preprocessing.

Needs a GPU with free memory (server models OOM on CPU for large scans, and the
live service reserves most of the GPU) — run it with the backend stopped:

    docker compose -f docker-compose.prod.yml --env-file .env.production stop backend
    docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps \
        -v /opt/reverie/ocr_compare.py:/app/apps/backend/ocr_service/ocr_compare.py \
        -e OCR_DEVICE=gpu:0 backend \
        /opt/paddleocr-env/bin/python3 apps/backend/ocr_service/ocr_compare.py <image> [<image> ...]
    docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend
"""

import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from ocr_runner import MIN_BLOCK_CONFIDENCE, _build_structured_text

# Each config is a label + the kwargs passed to PaddleOCR(). Everything not set
# here falls back to the PaddleOCR default (which is what makes the doc-preproc
# toggle meaningful — the baseline leaves it at the library default).
BASE_V5 = dict(
    text_detection_model_name="PP-OCRv5_server_det",
    text_recognition_model_name="PP-OCRv5_server_rec",
)
BASE_V6 = dict(
    text_detection_model_name="PP-OCRv6_medium_det",
    text_recognition_model_name="PP-OCRv6_medium_rec",
)
NO_DOC_PRE = dict(use_doc_orientation_classify=False, use_doc_unwarping=False)
DET_TUNE = dict(text_det_limit_side_len=1280, text_det_limit_type="max", text_det_unclip_ratio=2.2)

CONFIGS = [
    ("v5_server (docpre=default, = prod)", {**BASE_V5, "use_textline_orientation": True}),
    ("v6_medium (docpre=default)", {**BASE_V6, "use_textline_orientation": True}),
    ("v6_medium (docpre OFF + det-tune)", {**BASE_V6, "use_textline_orientation": True, **NO_DOC_PRE, **DET_TUNE}),
]


def build(config_kwargs, device):
    from paddleocr import PaddleOCR

    return PaddleOCR(enable_mkldnn=False, device=device, **config_kwargs)


def run_one(ocr, image_path):
    results = ocr.predict(str(image_path))
    if not results:
        return "", 0.0, 0
    page = results[0]
    rec_texts = page.get("rec_texts", [])
    rec_scores = page.get("rec_scores", [])
    dt_polys = page.get("dt_polys", [])
    blocks = []
    for text, score, poly in zip(rec_texts, rec_scores, dt_polys):
        bbox = poly.tolist() if hasattr(poly, "tolist") else list(poly)
        blocks.append({"text": text, "confidence": float(score), "bbox": bbox})
    kept = [b for b in blocks if b["confidence"] >= MIN_BLOCK_CONFIDENCE]
    if not kept:
        return "", 0.0, 0
    kept.sort(key=lambda b: (round(b["bbox"][0][1] / 15) * 15, b["bbox"][0][0]))
    text = _build_structured_text(kept)
    avg = sum(b["confidence"] for b in kept) / len(kept) * 100
    return text, round(avg, 2), len(kept)


def main():
    parser = argparse.ArgumentParser(description="Compare PaddleOCR configs on the same image(s)")
    parser.add_argument("images", nargs="+", help="Image path(s) to OCR")
    parser.add_argument("--device", default=os.environ.get("OCR_DEVICE", "gpu:0"))
    args = parser.parse_args()

    paths = []
    for image in args.images:
        p = Path(image).expanduser().resolve()
        if not p.is_file():
            print(f"Error: file not found: {p}", file=sys.stderr)
            sys.exit(1)
        paths.append(p)

    for label, kwargs in CONFIGS:
        print("\n" + "#" * 72)
        print(f"# CONFIG: {label}")
        print("#" * 72, flush=True)
        try:
            ocr = build(kwargs, args.device)
        except Exception as e:  # noqa: BLE001 — surface config/model failures per-config
            print(f"  BUILD FAILED: {e}", flush=True)
            continue
        for p in paths:
            text, avg, n = run_one(ocr, p)
            print(f"\n----- {p.name}  (avg_conf={avg}%, kept_blocks={n}) -----")
            print(text, flush=True)


if __name__ == "__main__":
    main()
