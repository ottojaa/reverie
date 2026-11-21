# reverie-ml

Local embedding models behind a small FastAPI service. The backend sends the text or image bytes it wants embedded;
the service has no access to the library, no database and no published port in production (compose network only).

| Endpoint                 | Body                                      | Returns                                                           |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| `GET /health`            |                                           | `ready`, `device`, `gpu`, `gpu_warning`, `torch`, `error`, models |
| `POST /embed/text`       | `{texts: string[]}` (max 64)              | `{model, embeddings}` from the text model                         |
| `POST /embed/image`      | `{images: base64[]}` (max 16, 8 MiB each) | `{model, embeddings}` from the image model                        |
| `POST /embed/image-text` | `{texts: string[]}`                       | text-tower vectors of the image model (for text -> photo queries) |

Models load in a background thread, so the port is up immediately; the embed endpoints answer 503 until `/health`
says `ready`. Weights are downloaded on first start into `HF_HOME=/models` (the `ml_models` named volume).

## Models

Chosen by the committed synthetic eval, see [`eval/RESULTS.md`](eval/RESULTS.md):

- Text: `BAAI/bge-m3`, 1024 dimensions, suggested cosine floor **0.53**.
- Image: `google/siglip2-so400m-patch14-384`, 1152 dimensions, suggested cosine floor **0.17** (text -> image).

Both are pinned to a Hugging Face commit in `app/specs.py`; that revision is the `model_version` stored on every
embedding row, so bumping it makes the backfill re-embed the library. The vector sizes are fixed by migration 017, so a
model with other dimensions needs a new migration. The floors are starting points from synthetic data: re-tune them on
the real library when search starts using the vectors.

## GPU and the torch build

The home server's NVIDIA driver is 535 (CUDA 12.2). PyPI's default Linux torch wheel is built for CUDA 13.x, which that
driver cannot run: `torch.cuda.is_available()` is False and the models quietly load on the CPU. So `requirements.txt`
installs `torch==2.14.1+cu126` from PyTorch's CUDA 12.6 index on Linux x86_64 (the newest torch with a CUDA 12.x Linux
wheel; cu129 stops at 2.13.0). CUDA 12.x wheels run on any driver >= 525. macOS and arm64 Linux get the plain PyPI wheel
(no CUDA 12 build there; dev and the tests run on the CPU).

- The Docker build runs `python -m app.runtime`, which fails the build unless `torch.version.cuda` starts with `12` on
  Linux x86_64. It needs no GPU.
- `/health` reports `device` (where the models actually are), `gpu` (name and this process's allocated, reserved and
  total MiB; null on CPU), `torch` (version and CUDA build) and `gpu_warning`.
- At start the service logs one WARNING, `A GPU is visible to this container but torch cannot use it`, when a GPU is
  visible (`NVIDIA_VISIBLE_DEVICES` or `/dev/nvidiactl`) but torch fell back to the CPU, with the torch build and driver
  version. It logs the measured VRAM once the models are loaded.
- Models run in fp16 on CUDA, fp32 on the CPU. Texts go through the model 16 at a time even when a request carries up to 64.

After a deploy, check on the server: `docker exec reverie-ml python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"`
prints `True 12.6`; `curl` the container's `/health` for `device: "cuda"` and the `gpu` memory; `docker logs reverie-ml`
has no GPU warning; `nvidia-smi` on the host (inside containers it often lists no processes) shows reverie-ml's memory.

## VRAM budget (RTX 3080, 10 GB)

Estimates from parameter counts (fp16 = 2 bytes per weight, +20% activations) plus a CUDA context per process. They are
not measurements: there is no GPU on the machine this was written on. After the first deploy on the GPU, compare them with
the "Models loaded" log line, `/health` `gpu` and `nvidia-smi`, and fix the numbers here.

| Consumer                          | Estimate    | How it is bounded                                                                                                                                                              |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| reverie-ml: bge-m3 (fp16)         | 1.4 GB      | fixed weights; the backend sends 16 chunks (<= 512 tokens) per request, and the service runs any larger request (up to 64) 16 at a time, so the activations stay in the margin |
| reverie-ml: SigLIP2 so400m (fp16) | 2.7 GB      | fixed weights; max 16 images per request                                                                                                                                       |
| reverie-ml: CUDA context + cache  | ~0.6 GB     | one process                                                                                                                                                                    |
| PaddleOCR (backend container)     | <= 4.0 GB   | `FLAGS_gpu_memory_limit_mb=4096`, `FLAGS_allocator_strategy=auto_growth`                                                                                                       |
| PaddleOCR CUDA context            | ~0.4 GB     | one process                                                                                                                                                                    |
| **Total**                         | **~9.1 GB** | leaves ~0.9 GB of the card's 10 GB                                                                                                                                             |

Paddle's flags are set on the backend service in `docker-compose.prod.yml` and reach the OCR subprocess because the
backend spawns it with `...process.env`. If Paddle needs more than the cap, OCR fails with an out-of-memory error
rather than starving reverie-ml; raise the cap only after re-doing this table. If no CUDA device is visible reverie-ml runs on
CPU (slow: see the throughput in `eval/RESULTS.md`), and the backend never blocks OCR or uploads on it.

## Development

```
nx test reverie-ml                # CPU, stub models, nothing downloaded
python -m eval.run_eval           # real models, downloads them; writes eval/results.json
python -m eval.report             # renders eval/RESULTS.md from results.json
```

Run it locally with `docker compose up -d reverie-ml` (published on `127.0.0.1:8090`; set `ML_URL` for the backend). On
an NVIDIA machine add the GPU override: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`.
