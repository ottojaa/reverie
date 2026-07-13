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

# 1. Build shared, backend, and web in parallel (nx respects dependency graph)
ARG VITE_API_URL=https://api.reverieapp.dev
ENV VITE_API_URL=$VITE_API_URL
ENV CI=true
RUN pnpm nx run-many -t build --configuration=production

# 2. Prune backend to standalone dist (package.json + lockfile + workspace_modules)
RUN pnpm nx run @reverie/backend:prune


# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# Minimal Node.js image with Python + PaddleOCR for the OCR subprocess.
FROM node:22-slim AS runtime
WORKDIR /app

# Install deps in runtime — no pnpm-workspace here, so pnpm creates local node_modules
RUN npm install -g pnpm

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libfontconfig1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install PaddleOCR in an isolated venv.
# Copied early so this expensive layer is cached independently of app code.
# OCR_GPU=true (default) installs the CUDA 12.6 paddlepaddle-gpu wheel (bundles
# CUDA/cuDNN via pip — the host only needs an NVIDIA driver + Container Toolkit).
# Build with --build-arg OCR_GPU=false for a CPU-only image.
# The framework wheel is installed BEFORE requirements.txt so paddleocr does not
# pull in the CPU paddlepaddle wheel (the two must not coexist).
ARG OCR_GPU=true
COPY apps/backend/ocr_service/requirements.txt \
     apps/backend/ocr_service/requirements-gpu.txt \
     apps/backend/ocr_service/requirements-cpu.txt \
     /tmp/
RUN python3 -m venv /opt/paddleocr-env && \
    if [ "$OCR_GPU" = "true" ]; then \
        /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements-gpu.txt; \
    else \
        /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements-cpu.txt; \
    fi && \
    /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# Fallback for the GPU build: if paddle fails to dlopen its bundled CUDA/cuDNN
# at runtime (e.g. "libcudnn.so.* cannot open shared object file"), uncomment and
# point at the venv's bundled nvidia libs (adjust the python3.X version to match):
# ENV LD_LIBRARY_PATH=/opt/paddleocr-env/lib/python3.11/site-packages/nvidia/cudnn/lib:/opt/paddleocr-env/lib/python3.11/site-packages/nvidia/cublas/lib:$LD_LIBRARY_PATH
# If that still fails, switch this runtime stage to an nvidia/cuda cudnn-runtime base.

# Copy pruned backend dist (JS, package.json, lockfile, workspace_modules)
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
RUN cd apps/backend/dist && pnpm install --frozen-lockfile --prod

# Copy OCR runner script.
# Must be at apps/backend/ocr_service/ relative to WORKDIR (/app) because
# paddleocr.client.ts resolves: join(process.cwd(), 'apps/backend/ocr_service/ocr_runner.py')
COPY --from=builder /app/apps/backend/ocr_service ./apps/backend/ocr_service

ENV NODE_ENV=production
ENV PYTHON_PATH=/opt/paddleocr-env/bin/python3

EXPOSE 3000

# Create user (in container): docker exec -it reverie-backend sh -c 'cd apps/backend/dist && pnpm run create-user'
CMD ["node", "apps/backend/dist/main.js"]
