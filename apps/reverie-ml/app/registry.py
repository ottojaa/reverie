"""Loads the models in a background thread so the HTTP port is up (and /health answers) while weights download."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Callable

from .embedders import ImageEmbedder, SiglipImageEmbedder, TextEmbedder, TransformersTextEmbedder, pick_device
from .specs import IMAGE_SPEC, TEXT_SPEC

logger = logging.getLogger("reverie-ml")


@dataclass
class Registry:
    device: str
    text: TextEmbedder | None = None
    image: ImageEmbedder | None = None
    error: str | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def ready(self) -> bool:
        return self.text is not None and self.image is not None

    def load(self, load_text: Callable[[], TextEmbedder], load_image: Callable[[], ImageEmbedder]) -> None:
        try:
            self.text = load_text()
            self.image = load_image()
        except Exception as error:  # surfaced on /health; the backend keeps retrying until it clears
            logger.exception("Model load failed")
            self.error = f"{type(error).__name__}: {error}"

    def start(self) -> None:
        device = self.device
        thread = threading.Thread(
            target=self.load,
            args=(lambda: TransformersTextEmbedder(TEXT_SPEC, device), lambda: SiglipImageEmbedder(IMAGE_SPEC, device)),
            name="model-loader",
            daemon=True,
        )
        thread.start()


def new_registry() -> Registry:
    return Registry(device=pick_device())
