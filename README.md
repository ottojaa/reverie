# Reverie

Self-hosted manager for documents, photos, and videos with OCR, AI summaries, and smart organization—like a private Google Drive with built-in intelligence.

See [ROADMAP.md](ROADMAP.md) for where the project is headed.

# This project is a work in progress. Here are some things to note:

- Performance: PaddleOCR can now run on the GPU — set `OCR_DEVICE=gpu:0` on a CUDA host and build the GPU image (`OCR_GPU=true`, the default). See [Deployment → GPU / OCR](#gpu--ocr). On CPU, 4k images can take 10s+.
- UI work needed in various areas

## Features

- **File management**: Upload, browse, and organize any file type in a two-level hierarchy (collections → folders); multi-select batch move/delete/download, plus duplicate-conflict handling on upload
- **OCR**: Extract text from images/PDFs via PaddleOCR (default) or Tesseract.js
- **AI processing**: Claude-powered summaries, titles, tags, entities, topics, categories, and extracted dates; optional vision for images without text
- **Library agent**: Admin-only chat in the web app that searches, moves, renames and tags documents through the same tool registry as `/mcp`; every write can be undone ([setup](#in-app-agent))
- **Manual organize**: Pick a destination and move a selection in one step
- **Full-text search**: Filter DSL + faceted search (date, category, type, tags, location from EXIF), autocomplete, and a command palette in web
- **Document viewer**: PDF, images, video, and text via a viewer registry, with an AI insight panel; in-app image crop editor and video trim editor
- **Thumbnails**: WebP thumbnails + blurhash for images, PDFs, Office docs (via LibreOffice), video frames, and text/code
- **Private folders**: Mark a collection or folder private and it gets its own lock; open it with your account password for the rest of the app session. Private documents stay out of search, "All documents" and the AI tools
- **Storage**: Local FS or S3, content-addressable dedup, per-user quotas
- **Real-time updates**: Socket.io for job progress (OCR, thumbnail, LLM)
- **Auth**: JWT + rotating refresh tokens, optional Google OAuth; multi-user with admin user management
- **Clients**: Electron/React desktop app + Android (Kotlin, Jetpack Compose)

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
│   ├── web/         # Electron + React desktop app
│   └── android/     # Kotlin + Jetpack Compose mobile app
├── libs/
│   └── shared/      # Zod schemas, types, API contracts
├── .env.example
├── docker-compose.prod.yml
└── Dockerfile
```

## Prerequisites

- Node.js 22+
- Yarn 4 (Berry) — pinned in-repo (`.yarn/releases`), no corepack needed
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

## AI & Model Providers

AI is **optional** — Reverie runs fully without it. Set `LLM_ENABLED=false` (or leave
`ANTHROPIC_API_KEY` unset) and files are still uploaded, OCR'd, thumbnailed, searched, and organized
by hand; only the AI summaries/tags are skipped (the library agent runs on a Claude Code sign-in, not on this key). Vision is off by default
(`LLM_VISION_ENABLED=false`).

Each AI capability chooses its model independently, so you can mix per task:

| Capability              | Env var                   | Default            |
| ----------------------- | ------------------------- | ------------------ |
| Document summary & tags | `ANTHROPIC_SUMMARY_MODEL` | `claude-haiku-4-5` |
| Image vision (opt-in)   | `ANTHROPIC_VISION_MODEL`  | `claude-haiku-4-5` |

The env vars above are today's mechanism (set at boot). **Planned:** these settings move into the
**admin UI, editable at runtime** — swap models or providers on the fly, no restart. A provider seam
lets each capability target either Claude or a **local, self-hosted model** over an OpenAI-compatible
endpoint (Ollama, llama.cpp, …) run as a **separate container** — e.g. a local model for summaries
with Claude for the agent, fully local, or fully off — all with sensible defaults. See
[ROADMAP.md](ROADMAP.md).

## In-app agent

The admin gets an **Agent** page in the web app: a chat with Claude working on their library. It is the
stock Claude Code binary (`claude -p`) running in its own `reverie-agent` container, and its only tools are
Reverie's `/mcp` (the same tool registry, with locked and trashed items hidden, photos as details only, no
delete). Reverie runs no agent loop and uses no Anthropic API key for it: the container signs in once with
the admin's own Claude plan, so it is meant for a single admin who owns that plan. Other users never see it.
Every write shows what changed and an **Undo** button.

The container has no library volume, no Docker socket and no database credentials. The backend sends each
prompt to it over the compose network with a shared secret it generates itself, plus a short-lived `/mcp`
token minted for that one run.

**One-time sign-in** (after the first deploy, and again if Claude asks for it):

```bash
docker compose -f docker-compose.prod.yml exec -it reverie-agent claude
```

Follow the login prompt (open the link in a browser, paste the code back), then exit. The login lives in the
`agent_claude` volume, so it survives restarts and redeploys.

**Check it is signed in:** the Agent page shows a "not signed in" banner with this command until it is, or run
`docker compose -f docker-compose.prod.yml exec reverie-agent claude auth status`.

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

- The Python/PaddleOCR + CUDA stack lives in a **separate base image** (`Dockerfile.ocr-base` →
  `reverie-ocr-base:latest`), built by `scripts/deploy.sh` only when the OCR requirements change. The
  per-deploy backend build does `FROM reverie-ocr-base`, so ordinary code deploys never rebuild or
  re-download the multi-GB CUDA/cuDNN wheels. GPU-enabled by default (`OCR_GPU=true` → CUDA 12.6
  `paddlepaddle-gpu`); build CPU-only with `OCR_GPU=false scripts/deploy.sh`, or rebuild the base by hand:
    ```sh
    docker build -f Dockerfile.ocr-base -t reverie-ocr-base:latest .   # add --build-arg OCR_GPU=false for CPU
    ```
- Set `OCR_DEVICE=gpu:0` in `/opt/reverie/.env.production`. `docker-compose.prod.yml` already reserves
  the GPU for the backend service. OCR falls back to CPU automatically if GPU init fails.

**Verify / benchmark** (inside the running container):

```sh
docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 apps/backend/ocr_service/ocr_bench.py --check
docker exec -it reverie-backend /opt/paddleocr-env/bin/python3 apps/backend/ocr_service/ocr_bench.py --compare
```

`--check` confirms CUDA is compiled in and the GPU is visible; `--compare` runs CPU vs GPU on a sample
image and prints the speedup.

### In-app agent: one-time Claude sign-in

The admin-only agent is the stock Claude Code binary in the `reverie-agent` container, signed in with
the server owner's own Claude account (Pro/Max). Until it is signed in, the agent page says so. Sign in
once on the server:

```sh
docker exec -it reverie-agent claude   # follow the sign-in prompts, then /exit
docker exec reverie-agent claude auth status   # should report you as logged in
```

The login lives in the container's `/data/claude` volume, so it survives redeploys. Use `docker exec`
rather than `docker compose exec`: compose parses `docker-compose.prod.yml` first and, without
`--env-file .env.production`, warns that the `POSTGRES_*` variables aren't set (harmless for `exec`,
but noisy).

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full plan (auto-backup, trash/soft-delete, sharing, semantic
search, MCP server, and more).

## License

MIT
