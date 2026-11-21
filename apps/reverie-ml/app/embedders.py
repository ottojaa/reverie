"""Embedders: thin wrappers over transformers that return L2-normalised float32 vectors.

Everything returned is unit length, so cosine similarity is a dot product and the backend can store the
vectors in pgvector with `vector_cosine_ops` without normalising again.
"""

from __future__ import annotations

import io
from typing import Protocol, Sequence

import torch
from PIL import Image, UnidentifiedImageError
from transformers import AutoModel, AutoProcessor, AutoTokenizer

from .specs import TEXT_BATCH_SIZE, ImageSpec, TextSpec


class ImageDecodeError(ValueError):
    """An image in the batch could not be decoded; `index` is its position in the request."""

    def __init__(self, index: int):
        super().__init__(f"Image {index} could not be decoded")
        self.index = index


class TextEmbedder(Protocol):
    name: str
    revision: str
    dimensions: int

    def embed(self, texts: Sequence[str], role: str) -> list[list[float]]: ...


class ImageEmbedder(Protocol):
    name: str
    revision: str
    dimensions: int

    def embed_images(self, images: Sequence[bytes]) -> list[list[float]]: ...

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]: ...


def _dtype(device: str) -> torch.dtype:
    # fp16 halves VRAM on the GPU; CPUs are faster and more exact in fp32.
    return torch.float16 if device == "cuda" else torch.float32


def _to_tensor(output: object) -> torch.Tensor:
    """Newer transformers return a ModelOutput from get_*_features, older ones a plain tensor."""
    if isinstance(output, torch.Tensor):
        return output
    pooled = getattr(output, "pooler_output", None)
    if pooled is None:
        raise TypeError("Unexpected feature output: " + type(output).__name__)
    return pooled


def _normalise(vectors: torch.Tensor) -> list[list[float]]:
    unit = torch.nn.functional.normalize(vectors.float(), dim=-1)
    return unit.cpu().tolist()


class TransformersTextEmbedder:
    def __init__(self, spec: TextSpec, device: str):
        self.spec = spec
        self.name = spec.name
        self.revision = spec.revision
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(spec.name, revision=spec.revision)
        self.model = AutoModel.from_pretrained(spec.name, revision=spec.revision, dtype=_dtype(device)).to(device).eval()
        self.dimensions = int(self.model.config.hidden_size)

    def embed(self, texts: Sequence[str], role: str) -> list[list[float]]:
        # One request may carry up to 64 texts; forward passes stay at TEXT_BATCH_SIZE so peak activation memory
        # stays inside the VRAM budget in the README.
        vectors: list[list[float]] = []
        for start in range(0, len(texts), TEXT_BATCH_SIZE):
            vectors.extend(self._embed_batch(texts[start : start + TEXT_BATCH_SIZE], role))
        return vectors

    @torch.inference_mode()
    def _embed_batch(self, texts: Sequence[str], role: str) -> list[list[float]]:
        prefix = self.spec.query_prefix if role == "query" else self.spec.passage_prefix
        batch = self.tokenizer(
            [prefix + text for text in texts],
            padding=True,
            truncation=True,
            max_length=self.spec.max_length,
            return_tensors="pt",
        ).to(self.device)
        hidden = self.model(**batch).last_hidden_state
        if self.spec.pooling == "cls":
            return _normalise(hidden[:, 0])
        mask = batch["attention_mask"].unsqueeze(-1).to(hidden.dtype)
        return _normalise((hidden * mask).sum(1) / mask.sum(1))


class SiglipImageEmbedder:
    def __init__(self, spec: ImageSpec, device: str):
        self.spec = spec
        self.name = spec.name
        self.revision = spec.revision
        self.device = device
        self.dtype = _dtype(device)
        self.processor = AutoProcessor.from_pretrained(spec.name, revision=spec.revision)
        self.tokenizer = AutoTokenizer.from_pretrained(spec.name, revision=spec.revision)
        self.model = AutoModel.from_pretrained(spec.name, revision=spec.revision, dtype=self.dtype).to(device).eval()
        self.dimensions = int(self.model.config.text_config.hidden_size)

    @torch.inference_mode()
    def embed_images(self, images: Sequence[bytes]) -> list[list[float]]:
        decoded = [_decode(data, index) for index, data in enumerate(images)]
        inputs = self.processor(images=decoded, return_tensors="pt").to(self.device)
        pixels = inputs["pixel_values"].to(self.dtype)
        extra = {key: value for key, value in inputs.items() if key != "pixel_values"}
        return _normalise(_to_tensor(self.model.get_image_features(pixel_values=pixels, **extra)))

    @torch.inference_mode()
    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        # SigLIP text towers are trained on lower-cased text padded to a fixed length.
        batch = self.tokenizer(
            [text.lower() for text in texts],
            padding="max_length",
            truncation=True,
            max_length=self.spec.text_max_length,
            return_tensors="pt",
        ).to(self.device)
        return _normalise(_to_tensor(self.model.get_text_features(input_ids=batch["input_ids"])))


def _decode(data: bytes, index: int) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise ImageDecodeError(index) from error
    return image.convert("RGB")
