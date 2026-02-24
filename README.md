# Reverie

Self-hosted document manager with OCR, AI summaries, and smart organization—like a private Google Drive with built-in intelligence.

## Features

- **Document management**: Upload, browse, organize in folder hierarchy (categories → sections)
- **OCR**: Extract text from images/PDFs via PaddleOCR (default) or Tesseract.js
- **AI processing**: OpenAI-powered summaries, tags, categories; optional vision for images without text
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
| LLM      | OpenAI API                                                |
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
- pnpm
- PostgreSQL
- Redis
- (Optional) OpenAI API key for LLM features
- (Optional) Python 3 + PaddleOCR for OCR (or Tesseract fallback. NOTE: tesseract does not handle rotated text currently)

## Quick Start

1. Clone, `pnpm install`
2. Copy `.env.example` → `.env`, fill `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FILE_URL_SECRET`, optionally `OPENAI_API_KEY`
3. `docker-compose up -d`
4. `nx run @reverie/backend:migrate`
5. `nx run @reverie/backend:create-user` (create first user)
6. `nx serve @reverie/backend` (API)
7. `nx serve @reverie/web` (web) or `pnpm dev:electron` (Electron)

## Nx Commands

| Task          | Command                                   |
| ------------- | ----------------------------------------- |
| Serve backend | `nx serve @reverie/backend`               |
| Serve web     | `nx serve @reverie/web`                   |
| Electron dev  | `pnpm dev:electron` (from apps/web)       |
| Migrate DB    | `nx run @reverie/backend:migrate`         |
| Create user   | `nx run @reverie/backend:create-user`     |
| Workers       | `nx run @reverie/backend:worker:ocr` etc. |
| Build all     | `nx run-many -t build`                    |
| Lint          | `nx run-many -t lint typecheck`           |

## Environment Variables

See [.env.example](.env.example) for the full reference. Key variables:

- `DATABASE_URL`, `REDIS_URL` (required)
- `STORAGE_PROVIDER` (local/s3), `STORAGE_LOCAL_ROOT` or S3 config
- `OPENAI_API_KEY`, `LLM_ENABLED` for AI features
- `OCR_ENGINE` (paddleocr/tesseract)
- `JWT_SECRET`, `FILE_URL_SECRET` (min 32 chars)
- `GOOGLE_CLIENT_ID` etc. for OAuth

## Deployment

- Docker: `docker compose -f docker-compose.prod.yml` with `.env.production`
- Deploy script: `scripts/deploy.sh` (builds backend image with PaddleOCR, extracts web dist, runs migrations)
- Nginx: `config/nginx.example.conf` for secure file serving

## Roadmap

- Android app (Kotlin + Jetpack Compose) — WIP (comes some day [probably])

## License

MIT
