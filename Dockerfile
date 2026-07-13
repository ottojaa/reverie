# ─── Stage 1: Builder ───────────────────────────────────────────────────────
# Compiles TypeScript, builds shared lib, backend dist, and web SPA.
# Debian (glibc) base so native modules (bcrypt, sharp) built here are ABI-compatible
# with the node:22-slim runtime, letting us copy node_modules across stages.
FROM node:22 AS builder
WORKDIR /app

# Yarn Berry is pinned in .yarn/releases and invoked directly via node, so the build
# never depends on corepack (its bundled signing keys are unreliable in some envs).

# Copy Yarn config + manifests first for dependency-layer caching.
# Workspaces are declared in the root package.json (yarn workspaces).
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/ ./.yarn/
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY libs/shared/package.json ./libs/shared/

RUN node .yarn/releases/yarn-4.17.1.cjs install --immutable

# Copy all source
COPY . .

# 1. Build shared, backend, and web (nx respects the dependency graph)
ARG VITE_API_URL=https://api.reverieapp.dev
ENV VITE_API_URL=$VITE_API_URL
ENV CI=true
RUN node_modules/.bin/nx run-many -t build --configuration=production

# 2. Prune node_modules to the backend workspace's PRODUCTION deps (+ the
#    @reverie/shared workspace dep, symlinked into node_modules). Berry-native
#    replacement for the old nx lockfile-prune; the result is copied to the runtime.
RUN node .yarn/releases/yarn-4.17.1.cjs workspaces focus @reverie/backend --production


# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# Minimal Node.js image with Python + PaddleOCR for the OCR subprocess.
FROM node:22-slim AS runtime
WORKDIR /app

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
# PaddleOCR (paddlepaddle) wheels are published for x86_64 only. Auto-skip the OCR
# install on arm64 (e.g. local Apple-Silicon builds) so the image still builds — it
# just runs without OCR. Force-skip on any arch with --build-arg SKIP_OCR=true.
# Production is x86_64, so OCR installs there as normal.
ARG SKIP_OCR=false
ARG TARGETARCH
COPY apps/backend/ocr_service/requirements.txt \
     apps/backend/ocr_service/requirements-gpu.txt \
     apps/backend/ocr_service/requirements-cpu.txt \
     /tmp/
RUN if [ "$SKIP_OCR" = "true" ] || [ "$TARGETARCH" = "arm64" ]; then \
        echo "Skipping PaddleOCR install (SKIP_OCR=$SKIP_OCR, TARGETARCH=$TARGETARCH)"; \
    else \
        python3 -m venv /opt/paddleocr-env && \
        if [ "$OCR_GPU" = "true" ]; then \
            /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements-gpu.txt; \
        else \
            /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements-cpu.txt; \
        fi && \
        /opt/paddleocr-env/bin/pip install --no-cache-dir -r /tmp/requirements.txt; \
    fi

# Fallback for the GPU build: if paddle fails to dlopen its bundled CUDA/cuDNN
# at runtime (e.g. "libcudnn.so.* cannot open shared object file"), uncomment and
# point at the venv's bundled nvidia libs (adjust the python3.X version to match):
# ENV LD_LIBRARY_PATH=/opt/paddleocr-env/lib/python3.11/site-packages/nvidia/cudnn/lib:/opt/paddleocr-env/lib/python3.11/site-packages/nvidia/cublas/lib:$LD_LIBRARY_PATH
# If that still fails, switch this runtime stage to an nvidia/cuda cudnn-runtime base.

# Copy the focused production node_modules, the built backend, and the workspace lib.
# node_modules/@reverie/shared is a symlink → ../../libs/shared, so libs/shared (with
# its built dist) must be present at the same relative path. No install runs here.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/libs/shared ./libs/shared
COPY --from=builder /app/package.json ./package.json

# Copy OCR runner script.
# Must be at apps/backend/ocr_service/ relative to WORKDIR (/app) because
# paddleocr.client.ts resolves: join(process.cwd(), 'apps/backend/ocr_service/ocr_runner.py')
COPY --from=builder /app/apps/backend/ocr_service ./apps/backend/ocr_service

ENV NODE_ENV=production
ENV PYTHON_PATH=/opt/paddleocr-env/bin/python3

EXPOSE 3000

# Create user (in container):
#   docker exec -it reverie-backend node apps/backend/dist/apps/backend/src/scripts/create-user.js
CMD ["node", "apps/backend/dist/main.js"]
