#!/usr/bin/env python3
"""
PaddleOCR Runner  (PaddleOCR >= 3.x / PP-OCRv3)

Persistent worker: loads models once, then reads newline-delimited
image paths from stdin and writes JSON results to stdout.

Protocol (one request per line):
    → {"image_path": "/tmp/input.png"}    (JSON on stdin)
    ← {"text": "...", "confidence": 85.2, "blocks": [...], "engine": "paddleocr/PP-OCRv3"}
    ← {"error": "File not found: ..."}    (on failure)

A special "ping" command can be used to check health:
    → {"ping": true}
    ← {"pong": true}

Startup sends a ready signal:
    ← {"ready": true}

Errors are written as JSON to stdout (not stderr) so the Node
parent can always parse them.  Stderr is reserved for fatal crashes.
"""

import json
import os
import sys
from pathlib import Path

# Suppress the slow connectivity check
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def _print_json(obj):
    """Write a JSON line to stdout and flush immediately."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _build_empty_result():
    return {
        "text": "",
        "confidence": 0.0,
        "blocks": [],
        "engine": "paddleocr/PP-OCRv3",
    }


def _group_lines_by_row(blocks, row_threshold=15):
    """
    Group text blocks that share approximately the same Y position
    into single lines, separated by spaces. Different rows are
    separated by newlines.
    """
    if not blocks:
        return ""

    rows = []
    current_row = [blocks[0]]
    current_y = blocks[0]["bbox"][0][1]

    for block in blocks[1:]:
        block_y = block["bbox"][0][1]
        if abs(block_y - current_y) <= row_threshold:
            current_row.append(block)
        else:
            rows.append(current_row)
            current_row = [block]
            current_y = block_y

    rows.append(current_row)

    lines = []
    for row in rows:
        row.sort(key=lambda b: b["bbox"][0][0])
        line_text = "  ".join(b["text"] for b in row)
        lines.append(line_text)

    return "\n".join(lines)


def process_image(ocr, image_path):
    """Run OCR on a single image and return the result dict."""
    if not Path(image_path).is_file():
        return {"error": f"File not found: {image_path}"}

    results = ocr.predict(image_path)

    if not results:
        return _build_empty_result()

    page = results[0]
    rec_texts = page.get("rec_texts", [])
    rec_scores = page.get("rec_scores", [])
    dt_polys = page.get("dt_polys", [])

    if not rec_texts:
        return _build_empty_result()

    blocks = []
    all_confidences = []

    for text, score, poly in zip(rec_texts, rec_scores, dt_polys):
        confidence = float(score)
        bbox = poly.tolist() if hasattr(poly, "tolist") else list(poly)
        blocks.append({
            "text": text,
            "confidence": round(confidence, 4),
            "bbox": bbox,
        })
        all_confidences.append(confidence)

    # Sort top-to-bottom, left-to-right
    blocks.sort(key=lambda b: (round(b["bbox"][0][1] / 15) * 15, b["bbox"][0][0]))

    grouped_text = _group_lines_by_row(blocks)

    avg_confidence = (
        sum(all_confidences) / len(all_confidences) * 100
        if all_confidences
        else 0.0
    )

    return {
        "text": grouped_text,
        "confidence": round(avg_confidence, 2),
        "blocks": blocks,
        "engine": "paddleocr/PP-OCRv3",
    }


def main():
    # ── Load models once ─────────────────────────────────────────
    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        _print_json({"error": f"PaddleOCR not installed: {e}"})
        sys.exit(1)

    try:
        ocr = PaddleOCR(
            lang="en",
            ocr_version="PP-OCRv3",
            use_textline_orientation=True,
        )
    except Exception as e:
        _print_json({"error": f"Failed to initialize PaddleOCR: {e}"})
        sys.exit(1)

    # Signal that models are loaded and we're ready
    _print_json({"ready": True})

    # ── Main loop: read requests from stdin ──────────────────────
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            _print_json({"error": f"Invalid JSON: {e}"})
            continue

        # Health check
        if request.get("ping"):
            _print_json({"pong": True})
            continue

        image_path = request.get("image_path")
        if not image_path:
            _print_json({"error": "Missing 'image_path' in request"})
            continue

        try:
            result = process_image(ocr, image_path)
            _print_json(result)
        except Exception as e:
            _print_json({"error": f"OCR processing failed: {e}"})


if __name__ == "__main__":
    main()
