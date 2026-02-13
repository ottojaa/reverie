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
import re
import sys
from pathlib import Path

# Suppress the slow connectivity check
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

# Blocks with per-line confidence below this threshold are discarded.
# Handwritten text / noise typically scores well below 0.50 while
# printed text lands in the 0.80–0.99 range.
MIN_BLOCK_CONFIDENCE = 0.8


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
    Returns list of row dicts: {"text": str, "y": float, "blocks": [...]}
    """
    if not blocks:
        return []

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

    result = []
    for row in rows:
        row.sort(key=lambda b: b["bbox"][0][0])
        line_text = "  ".join(b["text"] for b in row)
        row_y = row[0]["bbox"][0][1]
        result.append({"text": line_text, "y": row_y, "blocks": row})

    return result


def _looks_like_table_row(line_text):
    """Heuristic: row has multiple numbers and multiple tokens (likely table data)."""
    tokens = line_text.split()
    if len(tokens) < 3:
        return False
    numbers = sum(1 for t in tokens if re.search(r"\d", t))
    return numbers >= 2


def _build_structured_text(blocks, row_threshold=15):
    """
    Build text with section markers to help the LLM understand document structure.
    Sections: [Header], [Body], [Table] (when detected), [Footer]

    Uses hysteresis for table detection: requires 2+ consecutive table-like rows
    to enter [Table], and 2+ consecutive non-table rows to return to [Body].
    Reduces flip-flopping when stock names and values are on alternating rows.
    """
    rows = _group_lines_by_row(blocks, row_threshold)
    if not rows:
        return ""

    y_min = min(r["y"] for r in rows)
    y_max = max(r["y"] for r in rows)
    height = y_max - y_min
    if height < 1:
        height = 1

    header_bound = y_min + height * 0.25
    footer_bound = y_max - height * 0.25

    output_lines = []
    in_table = False
    last_effective = None

    for i, row in enumerate(rows):
        y = row["y"]
        text = row["text"]
        is_tab = _looks_like_table_row(text)
        is_tab_next = _looks_like_table_row(rows[i + 1]["text"]) if i + 1 < len(rows) else False

        if y <= header_bound:
            vertical_section = "header"
            in_table = False
        elif y >= footer_bound:
            vertical_section = "footer"
            in_table = False
        else:
            # Hysteresis: need 2+ consecutive table rows to enter, 2+ non-table to leave
            if in_table:
                if not is_tab and (i + 1 >= len(rows) or not is_tab_next):
                    in_table = False
                    vertical_section = "body"
                else:
                    vertical_section = "table"
            else:
                if is_tab and (i + 1 >= len(rows) or is_tab_next):
                    in_table = True
                    vertical_section = "table"
                else:
                    vertical_section = "body"

        effective_section = vertical_section

        if effective_section != last_effective:
            output_lines.append(f"[{effective_section.capitalize()}]")
            last_effective = effective_section

        output_lines.append(text)

    return "\n".join(output_lines)


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

    all_blocks = []

    for text, score, poly in zip(rec_texts, rec_scores, dt_polys):
        confidence = float(score)
        bbox = poly.tolist() if hasattr(poly, "tolist") else list(poly)
        all_blocks.append({
            "text": text,
            "confidence": round(confidence, 4),
            "bbox": bbox,
        })

    # Filter out low-confidence blocks (handwritten text, noise, etc.)
    kept_blocks = [b for b in all_blocks if b["confidence"] >= MIN_BLOCK_CONFIDENCE]
    filtered_count = len(all_blocks) - len(kept_blocks)

    if not kept_blocks:
        return _build_empty_result()

    # Sort top-to-bottom, left-to-right
    kept_blocks.sort(key=lambda b: (round(b["bbox"][0][1] / 15) * 15, b["bbox"][0][0]))

    grouped_text = _build_structured_text(kept_blocks)

    kept_confidences = [b["confidence"] for b in kept_blocks]
    avg_confidence = (
        sum(kept_confidences) / len(kept_confidences) * 100
        if kept_confidences
        else 0.0
    )

    return {
        "text": grouped_text,
        "confidence": round(avg_confidence, 2),
        "blocks": kept_blocks,
        "filtered_count": filtered_count,
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
            ocr_version="PP-OCRv4",
            use_textline_orientation=True,
            enable_mkldnn=True,                 # CPU optimization
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
