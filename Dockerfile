# ─── Stage 1: Builder ───────────────────────────────────────────────────────
# Compiles TypeScript, builds shared lib, backend dist, and web SPA.
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

# Copy manifests first for dependency layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY libs/shared/package.json ./libs/shared/

RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .

# 1. Build shared lib (backend + web both depend on it)
RUN pnpm nx run @reverie/shared:build

# 2. Build backend in production mode, then prune to a standalone dist
#    prune generates: dist/package.json, dist/pnpm-lock.yaml, dist/workspace_modules/
RUN pnpm nx run @reverie/backend:build:production
RUN pnpm nx run @reverie/backend:prune

# 3. Install production-only node_modules inside the pruned dist
RUN cd apps/backend/dist && pnpm install --frozen-lockfile --prod

# 4. Build web SPA (VITE_API_URL baked in at build time)
ARG VITE_API_URL=https://api.reverieapp.dev
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm nx run @reverie/web:build:production


# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# Minimal Node.js image with Python + PaddleOCR for the OCR subprocess.
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install PaddleOCR in an isolated venv.
# Copied early so this expensive layer is cached independently of app code.
COPY apps/backend/ocr_service/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/paddleocr-env && \
    /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# Copy pruned backend dist (JS files + node_modules + workspace_modules)
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# Copy OCR runner script.
# Must be at apps/backend/ocr_service/ relative to WORKDIR (/app) because
# paddleocr.client.ts resolves: join(process.cwd(), 'apps/backend/ocr_service/ocr_runner.py')
COPY --from=builder /app/apps/backend/ocr_service ./apps/backend/ocr_service

ENV NODE_ENV=production
ENV PYTHON_PATH=/opt/paddleocr-env/bin/python3

EXPOSE 3000

CMD ["node", "apps/backend/dist/main.js"]
