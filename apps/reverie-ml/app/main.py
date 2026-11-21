"""reverie-ml: embedding models behind a small HTTP API. Compose network only; no library volume.

The backend sends the bytes (text, or a downscaled image) and gets L2-normalised vectors back.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .embedders import ImageDecodeError
from .registry import Registry, new_registry
from .runtime import describe

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

MAX_TEXTS = 64
MAX_IMAGES = 16
MAX_TEXT_CHARS = 20_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class TextRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)
    role: Literal["passage", "query"] = "passage"


class ImageRequest(BaseModel):
    images: list[str] = Field(min_length=1, max_length=MAX_IMAGES, description="base64-encoded image bytes")


class ImageTextRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=MAX_TEXTS)


class ModelInfo(BaseModel):
    name: str
    revision: str
    dimensions: int


class EmbeddingsResponse(BaseModel):
    model: ModelInfo
    embeddings: list[list[float]]


def create_app(registry: Registry | None = None, autostart: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if autostart:
            app.state.registry.start()
        yield

    app = FastAPI(title="reverie-ml", lifespan=lifespan)
    app.state.registry = registry or new_registry()

    def ready(request: Request) -> Registry:
        current: Registry = request.app.state.registry
        if not current.ready:
            raise HTTPException(status_code=503, detail=current.error or "Models are still loading")
        return current

    @app.get("/health")
    def health(request: Request):
        current: Registry = request.app.state.registry
        models = {}
        if current.text:
            models["text"] = ModelInfo(name=current.text.name, revision=current.text.revision, dimensions=current.text.dimensions)
        if current.image:
            models["image"] = ModelInfo(name=current.image.name, revision=current.image.revision, dimensions=current.image.dimensions)
        return {
            "ready": current.ready,
            "device": current.device,
            "gpu_warning": current.device_warning,
            "error": current.error,
            "models": models,
            **describe(current.device),
        }

    @app.post("/embed/text", response_model=EmbeddingsResponse)
    async def embed_text(body: TextRequest, request: Request):
        current = ready(request)
        if any(len(text) > MAX_TEXT_CHARS for text in body.texts):
            raise HTTPException(status_code=413, detail="Text too long")
        assert current.text is not None
        vectors = await run_in_threadpool(current.text.embed, body.texts, body.role)
        embedder = current.text
        return EmbeddingsResponse(model=ModelInfo(name=embedder.name, revision=embedder.revision, dimensions=embedder.dimensions), embeddings=vectors)

    @app.post("/embed/image", response_model=EmbeddingsResponse)
    async def embed_image(body: ImageRequest, request: Request):
        current = ready(request)
        assert current.image is not None
        decoded = [_decode_base64(item, index) for index, item in enumerate(body.images)]
        try:
            vectors = await run_in_threadpool(current.image.embed_images, decoded)
        except ImageDecodeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        embedder = current.image
        return EmbeddingsResponse(model=ModelInfo(name=embedder.name, revision=embedder.revision, dimensions=embedder.dimensions), embeddings=vectors)

    @app.post("/embed/image-text", response_model=EmbeddingsResponse)
    async def embed_image_text(body: ImageTextRequest, request: Request):
        current = ready(request)
        assert current.image is not None
        vectors = await run_in_threadpool(current.image.embed_texts, body.texts)
        embedder = current.image
        return EmbeddingsResponse(model=ModelInfo(name=embedder.name, revision=embedder.revision, dimensions=embedder.dimensions), embeddings=vectors)

    return app


def _decode_base64(value: str, index: int) -> bytes:
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"Image {index} is not valid base64") from error
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Image {index} is too large")
    return data


app = create_app(autostart=os.environ.get("REVERIE_ML_AUTOSTART", "1") == "1")
