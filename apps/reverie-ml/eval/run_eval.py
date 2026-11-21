"""Compare the candidate models on the synthetic Finnish/English sets and print a markdown report.

    python -m eval.run_eval [--text] [--image] [--out eval/results.json]

Runs on whatever device torch finds (CPU on a laptop). Throughput numbers are therefore CPU numbers; VRAM is
estimated from the parameter count in fp16 (the served precision), not measured.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from app.embedders import SiglipImageEmbedder, TransformersTextEmbedder, pick_device
from app.specs import IMAGE_CANDIDATES, TEXT_CANDIDATES

from .image_data import build_images
from .text_data import NEGATIVE_QUERIES_EN, NEGATIVE_QUERIES_FI, TOPICS

BATCH = 8


def _batched(embed, items):
    vectors: list[list[float]] = []
    for start in range(0, len(items), BATCH):
        vectors.extend(embed(items[start : start + BATCH]))
    return np.array(vectors, dtype=np.float32)


def _rank_metrics(scores: np.ndarray, relevant: list[set[int]]) -> dict[str, float]:
    """scores: queries x items. relevant[i] holds the item indexes that are right for query i."""
    reciprocal, at1, at5 = [], 0, 0
    for row, rights in zip(scores, relevant):
        order = np.argsort(-row)
        rank = next(position for position, item in enumerate(order, start=1) if item in rights)
        reciprocal.append(1 / rank)
        at1 += rank <= 1
        at5 += rank <= 5
    count = len(relevant)
    return {"recall@1": at1 / count, "recall@5": at5 / count, "mrr": float(np.mean(reciprocal))}


def _floor(positive: np.ndarray, negative: np.ndarray) -> dict[str, float]:
    """The cut-off that best separates right from wrong pairs (max F1), plus the spread on both sides."""
    best, best_f1 = float(negative.max()), 0.0
    for cut in np.unique(np.concatenate([positive, negative])):
        tp = float((positive >= cut).sum())
        fp = float((negative >= cut).sum())
        fn = float((positive < cut).sum())
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        if f1 > best_f1:
            best, best_f1 = float(cut), f1
    return {
        "floor": round(best, 3),
        "f1_at_floor": round(best_f1, 3),
        "positive_median": round(float(np.median(positive)), 3),
        "negative_p95": round(float(np.percentile(negative, 95)), 3),
        "negative_max": round(float(negative.max()), 3),
    }


def _params(model) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def eval_text(key: str, device: str) -> dict:
    spec = TEXT_CANDIDATES[key]
    started = time.time()
    embedder = TransformersTextEmbedder(spec, device)
    load_seconds = time.time() - started
    fi_passages = [topic["fi"] for topic in TOPICS]
    en_passages = [topic["en"] for topic in TOPICS]
    passages = fi_passages + en_passages
    started = time.time()
    passage_vectors = _batched(lambda batch: embedder.embed(batch, "passage"), passages)
    texts_per_second = len(passages) / (time.time() - started)
    n = len(TOPICS)
    fi_queries = _batched(lambda batch: embedder.embed(batch, "query"), [t["q_fi"] for t in TOPICS])
    en_queries = _batched(lambda batch: embedder.embed(batch, "query"), [t["q_en"] for t in TOPICS])
    own = [{i} for i in range(n)]
    result: dict = {
        "model": spec.name,
        "revision": spec.revision,
        "dimensions": embedder.dimensions,
        "parameters_m": round(_params(embedder.model) / 1e6),
        "vram_fp16_gb_estimate": round(_params(embedder.model) * 2 / 1e9 * 1.2, 1),
        "cpu_texts_per_second": round(texts_per_second, 1),
        "load_seconds": round(load_seconds),
        "sets": {
            "fi->fi": _rank_metrics(fi_queries @ passage_vectors[:n].T, own),
            "en->en": _rank_metrics(en_queries @ passage_vectors[n:].T, own),
            "fi->en": _rank_metrics(fi_queries @ passage_vectors[n:].T, own),
            "en->fi": _rank_metrics(en_queries @ passage_vectors[:n].T, own),
        },
    }
    queries = np.concatenate([fi_queries, en_queries])
    scores = queries @ passage_vectors.T
    topic_of = np.array(list(range(n)) * 2)
    own_mask = np.tile(topic_of, (len(queries), 1)) == np.concatenate([np.arange(n), np.arange(n)])[:, None]
    wrong_queries = _batched(lambda batch: embedder.embed(batch, "query"), NEGATIVE_QUERIES_FI + NEGATIVE_QUERIES_EN)
    negatives = np.concatenate([scores[~own_mask], (wrong_queries @ passage_vectors.T).ravel()])
    result["floor"] = _floor(scores[own_mask], negatives)
    return result


def eval_image(key: str, device: str) -> dict:
    spec = IMAGE_CANDIDATES[key]
    started = time.time()
    embedder = SiglipImageEmbedder(spec, device)
    load_seconds = time.time() - started
    images = build_images()
    started = time.time()
    image_vectors = _batched(embedder.embed_images, [image.png for image in images])
    images_per_second = len(images) / (time.time() - started)
    en = _batched(embedder.embed_texts, [image.en for image in images])
    fi = _batched(embedder.embed_texts, [image.fi for image in images])
    own = [{i} for i in range(len(images))]
    queries = np.concatenate([en, fi])
    scores = queries @ image_vectors.T
    mask = np.tile(np.eye(len(images), dtype=bool), (2, 1))
    return {
        "model": spec.name,
        "revision": spec.revision,
        "dimensions": embedder.dimensions,
        "parameters_m": round(_params(embedder.model) / 1e6),
        "vram_fp16_gb_estimate": round(_params(embedder.model) * 2 / 1e9 * 1.2, 1),
        "cpu_images_per_second": round(images_per_second, 2),
        "load_seconds": round(load_seconds),
        "images": len(images),
        "sets": {
            "en text->image": _rank_metrics(en @ image_vectors.T, own),
            "fi text->image": _rank_metrics(fi @ image_vectors.T, own),
        },
        "floor": _floor(scores[mask], scores[~mask]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", action="store_true")
    parser.add_argument("--image", action="store_true")
    parser.add_argument("--out", default="eval/results.json")
    args = parser.parse_args()
    run_both = not args.text and not args.image
    device = pick_device()
    out = Path(args.out)
    results = json.loads(out.read_text()) if out.exists() else {}
    results["device"] = device
    if args.text or run_both:
        results["text"] = {key: eval_text(key, device) for key in TEXT_CANDIDATES}
    if args.image or run_both:
        results["image"] = {key: eval_image(key, device) for key in IMAGE_CANDIDATES}
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
