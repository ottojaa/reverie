"""Which torch build is installed and whether it can use the GPU.

The server's NVIDIA driver (535, CUDA 12.2) cannot run torch wheels built for CUDA 13, and torch then quietly reports
`cuda.is_available() == False`. Everything in here exists so that failure is loud: a build-time check on the wheel, a
start-up warning, and the details on /health.

`python -m app.runtime` is the build-time check: it needs no GPU, because `torch.version.cuda` is a string baked into
the wheel.
"""

from __future__ import annotations

import logging
import os
import platform
import sys
import warnings
from dataclasses import dataclass

import torch

logger = logging.getLogger("reverie-ml")

MIB = 1024 * 1024
NVIDIA_DRIVER_INFO = "/proc/driver/nvidia/version"
NVIDIA_DEVICE_NODE = "/dev/nvidiactl"
NO_GPU_VALUES = {"", "void", "none"}


@dataclass(frozen=True)
class DeviceChoice:
    device: str  # "cuda" or "cpu": where the models are loaded
    warning: str | None = None  # set when a GPU is visible but torch cannot use it


def is_linux_x86_64() -> bool:
    return sys.platform == "linux" and platform.machine() in ("x86_64", "AMD64")


def assert_cuda12_build(cuda_build: str | None, linux_x86_64: bool | None = None) -> str:
    """The Linux x86_64 image must carry a CUDA 12.x torch (see requirements.txt); other platforms may be CPU builds."""
    if not (is_linux_x86_64() if linux_x86_64 is None else linux_x86_64):
        return "skipped: not Linux x86_64"
    if cuda_build is None or not cuda_build.startswith("12"):
        raise RuntimeError(
            f"torch {torch.__version__} is built for CUDA {cuda_build}, not 12.x: the server driver (535) cannot run it. "
            "Pin a cu12x wheel in requirements.txt"
        )
    return f"torch.version.cuda={cuda_build}"


def gpu_visible() -> bool:
    """True when the container was handed an NVIDIA GPU (the NVIDIA runtime sets the variable and mounts the device)."""
    requested = os.environ.get("NVIDIA_VISIBLE_DEVICES", "").strip().lower()
    return requested not in NO_GPU_VALUES or os.path.exists(NVIDIA_DEVICE_NODE)


def read_driver_version() -> str | None:
    try:
        with open(NVIDIA_DRIVER_INFO) as handle:
            return handle.readline().strip() or None
    except OSError:
        return None


def build_gpu_warning(torch_message: str | None) -> str:
    """Spells out why a visible GPU is unused. The driver line comes from /proc, because torch's own message is only
    emitted by the first CUDA probe in the process and may already have been consumed."""
    driver = read_driver_version() or "unknown (could not read " + NVIDIA_DRIVER_INFO + ")"
    lines = [
        "A GPU is visible to this container but torch cannot use it: embeddings will run on the CPU, which is far too slow.",
        f"  torch {torch.__version__}, built for CUDA {torch.version.cuda}",
        f"  NVIDIA driver: {driver}",
        "  A torch wheel built for a newer CUDA than the driver supports is the usual cause: install a cu12x wheel.",
    ]
    if torch_message:
        lines.append("  torch says: " + torch_message)
    return "\n".join(lines)


def choose_device() -> DeviceChoice:
    """Probes CUDA once; call it a single time per process so the warning is logged once."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        usable = torch.cuda.is_available()
    if usable:
        return DeviceChoice("cuda")
    if not gpu_visible():
        return DeviceChoice("cpu")
    message = " ".join(str(item.message) for item in caught) or None
    return DeviceChoice("cpu", build_gpu_warning(message))


def describe(device: str) -> dict:
    """What /health reports about the runtime. `gpu` is null unless the models are on a CUDA device."""
    info: dict = {"torch": {"version": torch.__version__, "cuda": torch.version.cuda}, "gpu": None}
    if device != "cuda":
        return info
    properties = torch.cuda.get_device_properties(0)
    info["gpu"] = {
        "name": properties.name,
        "memory_total_mb": properties.total_memory // MIB,
        "memory_allocated_mb": torch.cuda.memory_allocated(0) // MIB,
        "memory_reserved_mb": torch.cuda.memory_reserved(0) // MIB,
    }
    return info


def memory_summary(device: str) -> str:
    gpu = describe(device)["gpu"]
    if gpu is None:
        return "no GPU in use"
    return (
        f"{gpu['name']}: {gpu['memory_allocated_mb']} MiB allocated, {gpu['memory_reserved_mb']} MiB reserved "
        f"by this process of {gpu['memory_total_mb']} MiB"
    )


def log_startup(choice: DeviceChoice) -> None:
    if choice.warning:
        logger.warning(choice.warning)
        return
    logger.info("Serving on %s (torch %s, CUDA build %s)", choice.device, torch.__version__, torch.version.cuda)


def main() -> None:
    print("torch", torch.__version__, "| CUDA build:", torch.version.cuda, "|", assert_cuda12_build(torch.version.cuda))


if __name__ == "__main__":
    main()
