#!/usr/bin/env python3
"""
PaddleOCR benchmark & GPU-health tool.

Uses the SAME model configuration as the production runner (imports _build_ocr
from ocr_runner), so the timings reflect real OCR performance rather than a
toy config.

Usage:
    # GPU health check — the first thing to run when debugging "is the GPU used?"
    python ocr_bench.py --check

    # Benchmark a device (defaults to the bundled sample image)
    python ocr_bench.py --device gpu:0 --iterations 10
    python ocr_bench.py --device cpu path/to/image.png

    # Head-to-head CPU vs GPU with a speedup ratio (the headline number)
    python ocr_bench.py --compare

    # Machine-readable output
    python ocr_bench.py --device gpu:0 --json

The GPU wheel/driver live in the prod container, so run the real GPU numbers there:
    docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 \\
        apps/backend/ocr_service/ocr_bench.py --compare
    docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 \\
        apps/backend/ocr_service/ocr_bench.py --check
"""

import argparse
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path

# Reuse the production model builder + warmup so the benchmark matches reality.
from ocr_runner import MIN_BLOCK_CONFIDENCE, _build_ocr, _warmup

# Bundled sample (a real ~4k photo) used as the default benchmark input.
DEFAULT_IMAGE = Path(__file__).resolve().parent / "IMG20260211193945.jpg"


def _percentile(values, pct):
    """Nearest-rank pct-th percentile (pct in 0-100)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = math.ceil(pct / 100.0 * len(ordered))
    idx = min(len(ordered) - 1, max(0, rank - 1))
    return ordered[idx]


def gpu_check():
    """Collect GPU/CUDA health info from paddle."""
    import paddle

    info = {
        "paddle_version": paddle.__version__,
        "compiled_with_cuda": bool(paddle.is_compiled_with_cuda()),
    }
    try:
        count = paddle.device.cuda.device_count()
        info["cuda_device_count"] = count
        if count > 0:
            info["device_name"] = paddle.device.cuda.get_device_name(0)
    except Exception as e:  # noqa: BLE001 — surface any probe failure to the user
        info["cuda_device_count"] = 0
        info["cuda_error"] = str(e)
    try:
        info["cudnn_version"] = paddle.get_cudnn_version()
    except Exception as e:  # noqa: BLE001
        info["cudnn_error"] = str(e)
    return info


def _extract(page):
    """Return (kept_blocks, filtered_blocks, avg_confidence_pct) for a predict() page."""
    scores = [float(s) for s in (page.get("rec_scores", []) if page else [])]
    kept = [s for s in scores if s >= MIN_BLOCK_CONFIDENCE]
    avg = (sum(kept) / len(kept) * 100) if kept else 0.0
    return len(kept), len(scores) - len(kept), round(avg, 2)


def benchmark(device, image_path, iterations):
    """Time model load, warmup, and N predict() runs on the given device."""
    load_start = time.perf_counter()
    ocr = _build_ocr(device)  # no CPU fallback here — a GPU failure should surface
    load_ms = (time.perf_counter() - load_start) * 1000

    warmup_start = time.perf_counter()
    _warmup(ocr)
    warmup_ms = (time.perf_counter() - warmup_start) * 1000

    latencies = []
    kept = filtered = 0
    confidence = 0.0
    for _ in range(iterations):
        started = time.perf_counter()
        results = ocr.predict(str(image_path))
        latencies.append((time.perf_counter() - started) * 1000)
        if results:
            kept, filtered, confidence = _extract(results[0])

    mean_ms = statistics.mean(latencies) if latencies else 0.0
    return {
        "device": device,
        "iterations": iterations,
        "image": str(image_path),
        "model_load_ms": round(load_ms, 1),
        "warmup_ms": round(warmup_ms, 1),
        "latency_ms": {
            "min": round(min(latencies), 1) if latencies else 0.0,
            "mean": round(mean_ms, 1),
            "median": round(statistics.median(latencies), 1) if latencies else 0.0,
            "p95": round(_percentile(latencies, 95), 1),
            "max": round(max(latencies), 1) if latencies else 0.0,
        },
        "throughput_img_per_s": round(1000.0 / mean_ms, 2) if mean_ms else 0.0,
        "kept_blocks": kept,
        "filtered_blocks": filtered,
        "avg_confidence": confidence,
    }


def _print_check(info):
    print("=" * 60)
    print("  GPU / CUDA HEALTH")
    print("=" * 60)
    print(f"  paddle version     : {info.get('paddle_version')}")
    print(f"  compiled with cuda : {info.get('compiled_with_cuda')}")
    print(f"  cuda device count  : {info.get('cuda_device_count')}")
    print(f"  device name        : {info.get('device_name', 'n/a')}")
    print(f"  cudnn version      : {info.get('cudnn_version', 'n/a')}")
    if info.get("cuda_error"):
        print(f"  cuda probe error   : {info['cuda_error']}")
    print("=" * 60)


def _print_result(r):
    lat = r["latency_ms"]
    print("=" * 60)
    print(f"  BENCHMARK  [{r['device']}]  ({r['iterations']} iterations)")
    print("=" * 60)
    print(f"  image          : {r['image']}")
    print(f"  model load     : {r['model_load_ms']} ms")
    print(f"  warmup         : {r['warmup_ms']} ms")
    print(f"  latency (ms)   : min {lat['min']} | mean {lat['mean']} | median {lat['median']} | p95 {lat['p95']} | max {lat['max']}")
    print(f"  throughput     : {r['throughput_img_per_s']} img/s")
    print(f"  kept/filtered  : {r['kept_blocks']} / {r['filtered_blocks']} blocks")
    print(f"  avg confidence : {r['avg_confidence']}%")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Benchmark PaddleOCR / check GPU health")
    parser.add_argument(
        "image",
        nargs="?",
        default=str(DEFAULT_IMAGE),
        help="Image to OCR (default: bundled sample image)",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("OCR_DEVICE", "cpu"),
        help="Inference device: cpu, gpu, gpu:0 (default: $OCR_DEVICE or cpu)",
    )
    parser.add_argument(
        "--iterations", type=int, default=5, help="Timed iterations (default: 5)"
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Run cpu then gpu:0 back-to-back and report the speedup",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Print GPU/CUDA health info and exit",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Output raw JSON instead of human-readable format",
    )
    args = parser.parse_args()

    if args.check:
        info = gpu_check()
        if args.json_output:
            print(json.dumps(info, ensure_ascii=False, indent=2))
        else:
            _print_check(info)
        return

    image_path = Path(args.image).expanduser().resolve()
    if not image_path.is_file():
        print(f"Error: file not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    if args.compare:
        cpu = benchmark("cpu", image_path, args.iterations)
        gpu = benchmark("gpu:0", image_path, args.iterations)
        gpu_mean = gpu["latency_ms"]["mean"]
        speedup = round(cpu["latency_ms"]["mean"] / gpu_mean, 2) if gpu_mean else None
        if args.json_output:
            print(json.dumps({"cpu": cpu, "gpu": gpu, "speedup": speedup}, ensure_ascii=False, indent=2))
            return
        _print_result(cpu)
        _print_result(gpu)
        print(f"\n  GPU speedup vs CPU (mean latency): {speedup}x\n")
        return

    result = benchmark(args.device, image_path, args.iterations)
    if args.json_output:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    _print_result(result)


if __name__ == "__main__":
    main()
