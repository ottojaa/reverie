"""Model specs: which Hugging Face checkpoints reverie-ml serves, pinned to exact revisions.

The revision is what lands in the backend's `model_version` column, so changing a model or its revision
makes the backend treat every stored embedding as stale and re-embed it. `trust_remote_code` is never used:
every spec here loads with stock transformers code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class TextSpec:
    name: str
    revision: str
    pooling: str  # "cls" or "mean"
    max_length: int
    query_prefix: str = ""
    passage_prefix: str = ""


@dataclass(frozen=True)
class ImageSpec:
    name: str
    revision: str
    text_max_length: int


# Candidates compared by eval/run_eval.py. The pair actually served is TEXT_SPEC / IMAGE_SPEC below.
TEXT_CANDIDATES: dict[str, TextSpec] = {
    "bge-m3": TextSpec(
        name="BAAI/bge-m3",
        revision="5617a9f61b028005a4858fdac845db406aefb181",
        pooling="cls",
        max_length=512,
    ),
    "multilingual-e5-large": TextSpec(
        name="intfloat/multilingual-e5-large",
        revision="3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3",
        pooling="mean",
        max_length=512,
        query_prefix="query: ",
        passage_prefix="passage: ",
    ),
}

IMAGE_CANDIDATES: dict[str, ImageSpec] = {
    "siglip2-base-384": ImageSpec(
        name="google/siglip2-base-patch16-384",
        revision="f775b65a79762255128c981547af89addcfe0f88",
        text_max_length=64,
    ),
    "siglip2-so400m-384": ImageSpec(
        name="google/siglip2-so400m-patch14-384",
        revision="e8e487298228002f3d8a82e0cd5c8ea9c567f57f",
        text_max_length=64,
    ),
}

TEXT_SPEC = TEXT_CANDIDATES[os.environ.get("REVERIE_ML_TEXT_MODEL", "bge-m3")]
IMAGE_SPEC = IMAGE_CANDIDATES[os.environ.get("REVERIE_ML_IMAGE_MODEL", "siglip2-so400m-384")]
