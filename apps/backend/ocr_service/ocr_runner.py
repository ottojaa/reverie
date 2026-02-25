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
import tempfile
from pathlib import Path

# Suppress the slow connectivity check
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

# Blocks with per-line confidence below this threshold are discarded.
# Handwritten text / noise typically scores well below 0.50 while
# printed text lands in the 0.80–0.99 range.
MIN_BLOCK_CONFIDENCE = 0.7

# Max PDF pages to process (avoids OOM/timeout for very long docs)
PDF_PAGE_LIMIT = 50

# Embedded text: min chars to trust it, skip OCR
MIN_EMBEDDED_CHARS = 300
# Page coverage: if images cover more than this, prefer OCR over embedded
IMAGE_COVERAGE_THRESHOLD = 0.5


def _is_readable_text(text):
    """Heuristic: text looks like real content, not garbage."""
    if not text or len(text.strip()) < 20:
        return False
    alnum = sum(1 for c in text if c.isalnum() or c.isspace())
    if alnum / len(text) < 0.5:
        return False
    # Reject if too many repeated chars (e.g. "aaaaaaa")
    if len(set(text)) < 5:
        return False
    return True


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


# Min horizontal gap (px) between blocks to insert space (avoids "word1word2")
SPACE_GAP_THRESHOLD = 8

# Heuristic: min line length and max spaces to consider "concatenated"
CONCATENATED_MIN_LEN = 40
CONCATENATED_MAX_SPACES = 3


def _insert_spaces_heuristic(text):
    """
    Insert spaces in concatenated OCR output (e.g. Tyosopimuslain5 -> Tyosopimuslain 5).
    Apply only when line looks concatenated: long and few spaces.
    """
    if not text or len(text) < CONCATENATED_MIN_LEN:
        return text
    if text.count(" ") > CONCATENATED_MAX_SPACES:
        return text

    result = []
    for i, c in enumerate(text):
        result.append(c)
        if i + 1 >= len(text):
            break
        next_c = text[i + 1]
        # Space before digit when preceded by letter
        if c.isalpha() and next_c.isdigit():
            result.append(" ")
        # Space before ( when preceded by letter
        elif c.isalpha() and next_c == "(":
            result.append(" ")
    return "".join(result)


def _join_blocks_with_spaces(blocks):
    """
    Join block texts with spaces. PaddleOCR returns one block per detected region
    (often a word); no space between blocks causes "word1word2".
    Use bbox gap: small gap = same word, large gap = space between words.
    """
    if not blocks:
        return ""
    parts = []
    for i, b in enumerate(blocks):
        parts.append(b["text"])
        if i + 1 < len(blocks):
            curr_right = b["bbox"][2][0] if len(b["bbox"]) > 2 else b["bbox"][1][0]
            next_left = blocks[i + 1]["bbox"][0][0]
            gap = next_left - curr_right
            # Always add space between blocks; use double space for larger gaps (new clause)
            parts.append("  " if gap > SPACE_GAP_THRESHOLD * 3 else " ")
    return "".join(parts)


def _group_lines_by_row(blocks, row_threshold=15):
    """
    Group text blocks that share approximately the same Y position
    into single lines. Inserts spaces based on bbox gap to fix "word1word2".
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
        line_text = _join_blocks_with_spaces(row)
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

        output_lines.append(_insert_spaces_heuristic(text))

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


def process_pdf(ocr, pdf_path):
    """
    Run OCR on a PDF. Uses embedded text when available (perfect spacing);
    falls back to OCR for scanned/image-heavy pages.
    """
    if not Path(pdf_path).is_file():
        return {"error": f"File not found: {pdf_path}"}

    try:
        import fitz
    except ImportError as e:
        return {"error": f"PyMuPDF not installed: {e}"}

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return {"error": f"Failed to open PDF: {e}"}

    all_text_parts = []
    all_confidences = []
    temp_files = []
    page_count = min(len(doc), PDF_PAGE_LIMIT)

    try:
        for page_num in range(page_count):
            page = doc[page_num]
            embedded = page.get_text().strip()

            # Compute page coverage: images vs text blocks
            img_cov = 0.0
            try:
                info = page.get_text("dict")
                blocks = info.get("blocks", []) if isinstance(info, dict) else []
            except Exception:
                blocks = []
            pr = page.rect
            page_area = max(1.0, pr.width * pr.height)
            img_area = 0.0
            for b in blocks:
                bbox = b.get("bbox") if isinstance(b, dict) else None
                if not bbox or len(bbox) != 4:
                    continue
                x0, y0, x1, y1 = bbox
                area = max(0.0, (x1 - x0) * (y1 - y0))
                if b.get("type") == 1:  # image block
                    img_area += area
            img_cov = img_area / page_area

            # Use embedded text when: long enough, readable, page not image-dominated
            if (
                embedded
                and len(embedded) >= MIN_EMBEDDED_CHARS
                and _is_readable_text(embedded)
                and img_cov < IMAGE_COVERAGE_THRESHOLD
            ):
                all_text_parts.append(embedded)
                all_confidences.append(100.0)  # embedded is "perfect"
                continue

            # Fall back to OCR
            mat = fitz.Matrix(2, 2)
            pm = page.get_pixmap(matrix=mat, alpha=False)
            if pm.width > 2000 or pm.height > 2000:
                mat = fitz.Matrix(1, 1)
                pm = page.get_pixmap(matrix=mat, alpha=False)

            fd, temp_path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            temp_files.append(temp_path)
            pm.save(temp_path)

            result = process_image(ocr, temp_path)
            if "error" in result:
                return result
            if result["text"]:
                all_text_parts.append(result["text"])
                all_confidences.append(result["confidence"])
            elif embedded and _is_readable_text(embedded):
                # OCR produced nothing; fall back to embedded
                all_text_parts.append(embedded)
                all_confidences.append(100.0)
    finally:
        doc.close()
        for p in temp_files:
            try:
                os.unlink(p)
            except OSError:
                pass

    if not all_text_parts:
        return _build_empty_result()

    combined_text = "\n\n".join(all_text_parts)
    avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

    return {
        "text": combined_text,
        "confidence": round(avg_confidence, 2),
        "blocks": [],
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
            enable_mkldnn=False,
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
            if image_path.lower().endswith(".pdf"):
                result = process_pdf(ocr, image_path)
            else:
                result = process_image(ocr, image_path)
            _print_json(result)
        except Exception as e:
            _print_json({"error": f"OCR processing failed: {e}"})


if __name__ == "__main__":
    main()
