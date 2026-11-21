# reverie-ml

Local embedding models behind a small FastAPI service. The backend sends the text or image bytes it wants embedded;
the service has no access to the library, no database and no published port in production (compose network only).

| Endpoint                 | Body                                      | Returns                                                           |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| `GET /health`            |                                           | `ready`, `device`, `error`, per-model name, revision, dimensions  |
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

## VRAM budget (RTX 3080, 10 GB)

Estimates from parameter counts (fp16 = 2 bytes per weight, +20% activations) plus a CUDA context per process. They are
not measurements: there is no GPU on the machine this was written on. Measure with `nvidia-smi` after the first deploy
and fix the numbers here.

| Consumer                          | Estimate    | How it is bounded                                                                                                                                              |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reverie-ml: bge-m3 (fp16)         | 1.4 GB      | fixed weights; the backend sends 16 chunks (<= 512 tokens) per request; the service accepts up to 64, which needs more temporary memory than the margin covers |
| reverie-ml: SigLIP2 so400m (fp16) | 2.7 GB      | fixed weights; max 16 images per request                                                                                                                       |
| reverie-ml: CUDA context + cache  | ~0.6 GB     | one process                                                                                                                                                    |
| PaddleOCR (backend container)     | <= 4.0 GB   | `FLAGS_gpu_memory_limit_mb=4096`, `FLAGS_allocator_strategy=auto_growth`                                                                                       |
| PaddleOCR CUDA context            | ~0.4 GB     | one process                                                                                                                                                    |
| **Total**                         | **~9.1 GB** | leaves ~0.9 GB of the card's 10 GB                                                                                                                             |

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
