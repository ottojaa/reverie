"""Loads the models in a background thread so the HTTP port is up (and /health answers) while weights download."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from .embedders import ImageEmbedder, SiglipImageEmbedder, TextEmbedder, TransformersTextEmbedder, pick_device
from .specs import IMAGE_SPEC, TEXT_SPEC

logger = logging.getLogger("reverie-ml")

RETRY_BASE_SECONDS = 15
RETRY_MAX_SECONDS = 600


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

    def load(
        self,
        load_text: Callable[[], TextEmbedder],
        load_image: Callable[[], ImageEmbedder],
        sleep: Callable[[float], None] = time.sleep,
        max_attempts: int | None = None,
    ) -> None:
        """Loads both models, retrying with backoff: a network blip during the first multi-GB download must not leave
        the service broken until someone restarts the container. `error` shows on /health while it retries and is
        cleared once the load succeeds."""
        attempt = 0
        while True:
            attempt += 1
            try:
                if self.text is None:
                    self.text = load_text()
                if self.image is None:
                    self.image = load_image()
                self.error = None
                return
            except Exception as error:  # surfaced on /health; retried below
                logger.exception("Model load failed")
                self.error = f"{type(error).__name__}: {error}"
            if max_attempts is not None and attempt >= max_attempts:
                return
            sleep(min(RETRY_BASE_SECONDS * 2 ** (attempt - 1), RETRY_MAX_SECONDS))

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
