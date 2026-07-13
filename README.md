# Reverie

Self-hosted document manager with OCR, AI summaries, and smart organization—like a private Google Drive with built-in intelligence.

# This project is a work in progress. Here are some things to note:

- Organize chat assistant needs fine-tuning and prompt work, as well as context management improvements.
- Performance: PaddleOCR can now run on the GPU — set `OCR_DEVICE=gpu:0` on a CUDA host and build the GPU image (`OCR_GPU=true`, the default). See [Deployment → GPU / OCR](#gpu--ocr). On CPU, 4k images can take 10s+.
- UI work needed in various areas

## Features

- **Document management**: Upload, browse, organize in folder hierarchy (categories → sections)
- **OCR**: Extract text from images/PDFs via PaddleOCR (default) or Tesseract.js
- **AI processing**: Claude-powered summaries, tags, categories; optional vision for images without text
- **Smart organize**: Chat-based AI assistant that searches documents and proposes moves; streaming SSE, tool-call loop
- **Full-text search**: Faceted search (date, category, type, location from EXIF); command palette in web
- **Document viewer**: PDF, images, video, text with viewer registry
- **Real-time updates**: Socket.io for job progress (OCR, thumbnail, LLM)
- **Auth**: JWT + optional Google OAuth
- **Admin**: User management for multi-user setups

## Tech Stack

| Layer    | Tech                                                      |
| -------- | --------------------------------------------------------- |
| Backend  | Node.js, Fastify                                          |
| Database | PostgreSQL, Kysely                                        |
| Queue    | BullMQ, Redis                                             |
| Storage  | Local FS or S3                                            |
| OCR      | PaddleOCR (Python) or Tesseract.js                        |
| LLM      | Anthropic (Claude) API                                    |
| Web      | React 19, TanStack Router/Query, Tailwind, shadcn, Motion |
| Desktop  | Electron                                                  |
| Shared   | Zod schemas in `libs/shared`                              |

## Project Structure

```
reverie/
├── apps/
│   ├── backend/     # Fastify API + BullMQ workers
│   └── web/         # Electron + React desktop app
├── libs/
│   └── shared/      # Zod schemas, types, API contracts
├── .env.example
├── docker-compose.prod.yml
└── Dockerfile
```

## Prerequisites

- Node.js 22+
- Yarn (Classic v1)
- PostgreSQL
- Redis
- (Optional) Anthropic (Claude) API key for LLM features
- (Optional) Python 3 + PaddleOCR for OCR (or Tesseract fallback. NOTE: tesseract does not handle rotated text currently)

## Quick Start

1. Clone, `yarn install`
2. Copy `.env.example` → `.env`, fill `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FILE_URL_SECRET`, optionally `ANTHROPIC_API_KEY`
3. `docker-compose up -d`
4. `nx run @reverie/backend:migrate`
5. `nx run @reverie/backend:create-user` (create first user)
6. `nx serve @reverie/backend` (API)
7. `nx serve @reverie/web` (web) or `yarn dev:electron` (Electron)

## Nx Commands

| Task          | Command                                   |
| ------------- | ----------------------------------------- |
| Serve backend | `nx serve @reverie/backend`               |
| Serve web     | `nx serve @reverie/web`                   |
| Electron dev  | `yarn dev:electron` (from apps/web)       |
| Migrate DB    | `nx run @reverie/backend:migrate`         |
| Create user   | `nx run @reverie/backend:create-user`     |
| Workers       | `nx run @reverie/backend:worker:ocr` etc. |
| OCR benchmark | `nx run @reverie/backend:bench:ocr`       |
| Build all     | `nx run-many -t build`                    |
| Lint          | `nx run-many -t lint typecheck`           |

## Environment Variables

See [.env.example](.env.example) for the full reference. Key variables:

- `DATABASE_URL`, `REDIS_URL` (required)
- `STORAGE_PROVIDER` (local/s3), `STORAGE_LOCAL_ROOT` or S3 config
- `ANTHROPIC_API_KEY`, `LLM_ENABLED` for AI features
- `OCR_ENGINE` (paddleocr/tesseract), `OCR_DEVICE` (cpu / gpu:0)
- `JWT_SECRET`, `FILE_URL_SECRET` (min 32 chars)
- `GOOGLE_CLIENT_ID` etc. for OAuth

## Deployment

- Docker: `docker compose -f docker-compose.prod.yml` with `.env.production`
- Deploy script: `scripts/deploy.sh` (builds backend image with PaddleOCR, extracts web dist, runs migrations)
- Nginx: `config/nginx.example.conf` for secure file serving

### GPU / OCR

PaddleOCR runs on CPU by default. To run OCR on an NVIDIA GPU (e.g. an RTX 3080):

**Host setup (once):**

1. Install the NVIDIA driver; verify `nvidia-smi` reports **CUDA Version ≥ 12.6** in its header
   (the driver's max supported runtime — not an installed toolkit). A 12.0–12.5 driver usually still
   works via CUDA minor-version compatibility, but a bump is recommended; below 12.0, upgrade the driver.
2. Install the **NVIDIA Container Toolkit** and wire it into Docker:
   ```sh
   sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
   ```
3. Smoke-test GPU access from a container (must list your GPU):
   ```sh
   docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi
   ```

**Enable it:**

- The prod image is GPU-enabled by default (`OCR_GPU=true` → CUDA 12.6 `paddlepaddle-gpu` wheel, which
  bundles CUDA/cuDNN via pip). Build CPU-only with `--build-arg OCR_GPU=false`.
- Set `OCR_DEVICE=gpu:0` in `/opt/reverie/.env.production`. `docker-compose.prod.yml` already reserves
  the GPU for the backend service. OCR falls back to CPU automatically if GPU init fails.

**Verify / benchmark** (inside the running container):

```sh
docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 apps/backend/ocr_service/ocr_bench.py --check
docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 apps/backend/ocr_service/ocr_bench.py --compare
```

`--check` confirms CUDA is compiled in and the GPU is visible; `--compare` runs CPU vs GPU on a sample
image and prints the speedup.

## Roadmap

- Android app (Kotlin + Jetpack Compose) — WIP (comes some day [probably])

## License

MIT
