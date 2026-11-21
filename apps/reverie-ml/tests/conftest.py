from __future__ import annotations

import hashlib
import io
from typing import Sequence

import pytest
from fastapi.testclient import TestClient

from app.embedders import ImageDecodeError
from app.main import create_app
from app.registry import Registry
from PIL import Image, UnidentifiedImageError

DIMS = 8


def _vector(seed: str) -> list[float]:
    digest = hashlib.sha256(seed.encode()).digest()[:DIMS]
    raw = [b - 127.5 for b in digest]
    norm = sum(v * v for v in raw) ** 0.5
    return [v / norm for v in raw]


class StubText:
    name, revision, dimensions = "stub-text", "r1", DIMS

    def embed(self, texts: Sequence[str], role: str) -> list[list[float]]:
        return [_vector(role + text) for text in texts]


class StubImage:
    name, revision, dimensions = "stub-image", "r2", DIMS

    def embed_images(self, images: Sequence[bytes]) -> list[list[float]]:
        out = []
        for index, data in enumerate(images):
            try:
                Image.open(io.BytesIO(data)).load()
            except (UnidentifiedImageError, OSError) as error:
                raise ImageDecodeError(index) from error
            out.append(_vector(hashlib.md5(data).hexdigest()))
        return out

    def embed_texts(self, texts: Sequence[str]) -> list[list[float]]:
        return [_vector("t" + text) for text in texts]


@pytest.fixture
def ready_client() -> TestClient:
    registry = Registry(device="cpu", text=StubText(), image=StubImage())
    return TestClient(create_app(registry, autostart=False))


@pytest.fixture
def loading_client() -> TestClient:
    return TestClient(create_app(Registry(device="cpu"), autostart=False))
