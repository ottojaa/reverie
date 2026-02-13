#!/usr/bin/env python3
"""
Standalone OCR test script.

Usage:
    python ocr_test.py <image_path> [--min-confidence 0.50] [--show-filtered] [--json]

Examples:
    python ocr_test.py ~/Documents/scan.png
    python ocr_test.py ~/Documents/scan.png --show-filtered
    python ocr_test.py ~/Documents/scan.png --min-confidence 0.60 --json
"""

import argparse
import json
import os
import sys
from pathlib import Path

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

# Import the shared helpers from ocr_runner
from ocr_runner import MIN_BLOCK_CONFIDENCE, _build_structured_text


def run_ocr(image_path, min_confidence, show_filtered):
    from paddleocr import PaddleOCR

    path = Path(image_path).expanduser().resolve()
    if not path.is_file():
        print(f"Error: file not found: {path}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading PaddleOCR (PP-OCRv4)...", file=sys.stderr)
    ocr = PaddleOCR(
        ocr_version="PP-OCRv4",
        use_textline_orientation=True,
        enable_mkldnn=True,
    )

    print(f"Processing: {path}", file=sys.stderr)
    results = ocr.predict(str(path))

    if not results:
        return {"text": "", "confidence": 0.0, "blocks": [], "filtered": []}

    page = results[0]
    rec_texts = page.get("rec_texts", [])
    rec_scores = page.get("rec_scores", [])
    dt_polys = page.get("dt_polys", [])

    if not rec_texts:
        return {"text": "", "confidence": 0.0, "blocks": [], "filtered": []}

    all_blocks = []
    for text, score, poly in zip(rec_texts, rec_scores, dt_polys):
        confidence = float(score)
        bbox = poly.tolist() if hasattr(poly, "tolist") else list(poly)
        all_blocks.append({
            "text": text,
            "confidence": round(confidence, 4),
            "bbox": bbox,
        })

    kept = [b for b in all_blocks if b["confidence"] >= min_confidence]
    filtered = [b for b in all_blocks if b["confidence"] < min_confidence]

    kept.sort(key=lambda b: (round(b["bbox"][0][1] / 15) * 15, b["bbox"][0][0]))
    grouped_text = _build_structured_text(kept)

    kept_confidences = [b["confidence"] for b in kept]
    avg = sum(kept_confidences) / len(kept_confidences) * 100 if kept_confidences else 0.0

    return {
        "text": grouped_text,
        "confidence": round(avg, 2),
        "blocks": kept,
        "filtered": filtered,
    }


def main():
    parser = argparse.ArgumentParser(description="Run PaddleOCR on a single image")
    parser.add_argument("image", help="Path to the image file")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=MIN_BLOCK_CONFIDENCE,
        help=f"Minimum per-block confidence to keep (default: {MIN_BLOCK_CONFIDENCE})",
    )
    parser.add_argument(
        "--show-filtered",
        action="store_true",
        help="Also print the blocks that were filtered out",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Output raw JSON instead of human-readable format",
    )
    args = parser.parse_args()

    result = run_ocr(args.image, args.min_confidence, args.show_filtered)

    if args.json_output:
        out = {
            "text": result["text"],
            "confidence": result["confidence"],
            "kept_blocks": len(result["blocks"]),
            "filtered_blocks": len(result["filtered"]),
            "blocks": result["blocks"],
        }
        if args.show_filtered:
            out["filtered"] = result["filtered"]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    # Human-readable output
    print("=" * 60)
    print("  OCR RESULT")
    print("=" * 60)
    print(f"  Avg confidence : {result['confidence']}%")
    print(f"  Kept blocks    : {len(result['blocks'])}")
    print(f"  Filtered blocks: {len(result['filtered'])} (below {args.min_confidence})")
    print("=" * 60)
    print()
    print(result["text"])
    print()

    if args.show_filtered and result["filtered"]:
        print("-" * 60)
        print("  FILTERED BLOCKS (low confidence)")
        print("-" * 60)
        for b in result["filtered"]:
            print(f"  [{b['confidence']:.2%}] {b['text']}")
        print()


if __name__ == "__main__":
    main()
