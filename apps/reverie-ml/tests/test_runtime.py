import logging
import warnings

import pytest
import torch
from fastapi.testclient import TestClient

from app import runtime
from app.embedders import TransformersTextEmbedder
from app.main import create_app
from app.registry import Registry
from app.runtime import DeviceChoice, assert_cuda12_build, choose_device, describe, log_startup
from app.specs import TEXT_BATCH_SIZE

DRIVER_TOO_OLD = "The NVIDIA driver on your system is too old (found version 12020)."


def test_cuda12_build_passes_on_linux_x86_64():
    assert assert_cuda12_build("12.6", linux_x86_64=True) == "torch.version.cuda=12.6"


@pytest.mark.parametrize("build", ["13.2", "11.8", None])
def test_other_cuda_builds_fail_on_linux_x86_64(build):
    with pytest.raises(RuntimeError, match="not 12.x"):
        assert_cuda12_build(build, linux_x86_64=True)


def test_cuda12_build_is_not_required_elsewhere():
    assert assert_cuda12_build(None, linux_x86_64=False).startswith("skipped")


def _cuda_unavailable(monkeypatch, message: str | None = None):
    def probe() -> bool:
        if message:
            warnings.warn(message, UserWarning)
        return False

    monkeypatch.setattr(torch.cuda, "is_available", probe)


def test_cpu_without_a_gpu_is_quiet(monkeypatch):
    _cuda_unavailable(monkeypatch)
    monkeypatch.delenv("NVIDIA_VISIBLE_DEVICES", raising=False)
    monkeypatch.setattr(runtime, "NVIDIA_DEVICE_NODE", "/nonexistent/nvidiactl")
    assert choose_device() == DeviceChoice("cpu")


@pytest.mark.parametrize("value", ["", "void", "none"])
def test_gpu_hidden_by_the_runtime_is_not_a_warning(monkeypatch, value):
    _cuda_unavailable(monkeypatch)
    monkeypatch.setenv("NVIDIA_VISIBLE_DEVICES", value)
    monkeypatch.setattr(runtime, "NVIDIA_DEVICE_NODE", "/nonexistent/nvidiactl")
    assert choose_device().warning is None


def test_visible_gpu_that_torch_cannot_use_warns_with_the_driver(monkeypatch):
    _cuda_unavailable(monkeypatch, DRIVER_TOO_OLD)
    monkeypatch.setenv("NVIDIA_VISIBLE_DEVICES", "all")
    monkeypatch.setattr(runtime, "read_driver_version", lambda: "NVRM version: NVIDIA UNIX x86_64 Kernel Module  535.309.01")
    choice = choose_device()
    assert choice.device == "cpu"
    assert choice.warning is not None
    assert "535.309.01" in choice.warning
    assert "too old (found version 12020)" in choice.warning
    assert f"built for CUDA {torch.version.cuda}" in choice.warning


def test_warning_still_names_the_driver_when_torch_said_nothing(monkeypatch):
    _cuda_unavailable(monkeypatch)
    monkeypatch.setenv("NVIDIA_VISIBLE_DEVICES", "all")
    monkeypatch.setattr(runtime, "read_driver_version", lambda: None)
    warning = choose_device().warning
    assert warning is not None and "unknown" in warning and "torch says" not in warning


def test_usable_gpu_is_chosen(monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert choose_device() == DeviceChoice("cuda")


def test_startup_logs_exactly_one_warning_when_the_gpu_is_unusable(caplog):
    with caplog.at_level(logging.INFO, logger="reverie-ml"):
        log_startup(DeviceChoice("cpu", "A GPU is visible"))
    assert [record.levelno for record in caplog.records] == [logging.WARNING]


def test_startup_logs_info_only_when_nothing_is_wrong(caplog):
    with caplog.at_level(logging.INFO, logger="reverie-ml"):
        log_startup(DeviceChoice("cpu"))
    assert [record.levelno for record in caplog.records] == [logging.INFO]


def test_describe_has_no_gpu_on_cpu():
    info = describe("cpu")
    assert info["gpu"] is None
    assert info["torch"]["version"] == torch.__version__


def test_health_reports_runtime_and_warning():
    client = TestClient(create_app(Registry(device="cpu", device_warning="A GPU is visible"), autostart=False))
    body = client.get("/health").json()
    assert body["device"] == "cpu"
    assert body["gpu"] is None
    assert body["gpu_warning"] == "A GPU is visible"
    assert body["torch"]["version"] == torch.__version__


class _FakeTokenizer:
    def __init__(self):
        self.sizes: list[int] = []

    def __call__(self, texts, **_):
        self.sizes.append(len(texts))
        return _Batch(len(texts))


class _Batch(dict):
    def __init__(self, rows: int):
        super().__init__(attention_mask=torch.ones(rows, 3))

    def to(self, _device):
        return self


class _FakeModel:
    def __call__(self, **batch):
        rows = batch["attention_mask"].shape[0]
        hidden = torch.ones(rows, 3, 4)
        return type("Output", (), {"last_hidden_state": hidden})()


def test_text_requests_are_split_into_micro_batches():
    embedder = object.__new__(TransformersTextEmbedder)
    embedder.spec = type("Spec", (), {"query_prefix": "", "passage_prefix": "", "max_length": 8, "pooling": "mean"})()
    embedder.device = "cpu"
    embedder.tokenizer = _FakeTokenizer()
    embedder.model = _FakeModel()

    vectors = embedder.embed(["text"] * (TEXT_BATCH_SIZE * 2 + 5), "passage")

    assert len(vectors) == TEXT_BATCH_SIZE * 2 + 5
    assert embedder.tokenizer.sizes == [TEXT_BATCH_SIZE, TEXT_BATCH_SIZE, 5]
