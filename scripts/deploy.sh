#!/bin/bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/reverie}"
WEB_DIR="${DEPLOY_DIR}/web"
ENV_FILE="${DEPLOY_DIR}/.env.production"
LOG_FILE="${DEPLOY_DIR}/deploy.log"

# Mirror all output (stdout + stderr) to a log file on the host so an in-progress
# deploy can be followed live: ssh reverie 'tail -f /opt/reverie/deploy.log'.
# Fresh log per run so `tail -f` shows just the current deploy.
exec > >(tee "$LOG_FILE") 2>&1
echo "=== Deploy started: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

cd "$DEPLOY_DIR"
# Hard-reset to origin/main rather than `git pull`: the deploy box is a
# clean checkout of main, and any drift in tracked files (e.g. a local
# docker-compose tweak) would otherwise abort a rebase-pull and block deploys.
# Untracked/ignored files (.env.production, deploy.log, web/) are left intact.
git fetch origin main
git reset --hard origin/main

# Build the OCR base image (Node + Python + PaddleOCR + the multi-GB CUDA/cuDNN
# stack) only when it's missing or its inputs changed. Splitting this off means
# ordinary code deploys reuse the existing base and never re-download CUDA — see
# Dockerfile.ocr-base. GPU-enabled by default (OCR_GPU=true); requires the NVIDIA
# driver + Container Toolkit on this host. CPU-only: set OCR_GPU=false.
OCR_GPU="${OCR_GPU:-true}"
OCR_BASE_IMAGE="reverie-ocr-base:latest"
# Anything that changes what lands in the base image invalidates the hash.
OCR_BASE_INPUTS=(
    Dockerfile.ocr-base
    apps/backend/ocr_service/requirements.txt
    apps/backend/ocr_service/requirements-gpu.txt
    apps/backend/ocr_service/requirements-cpu.txt
)
OCR_HASH_FILE="${DEPLOY_DIR}/.ocr-base-hash"
OCR_HASH="OCR_GPU=${OCR_GPU} $(cat "${OCR_BASE_INPUTS[@]}" | sha256sum | cut -d' ' -f1)"

if ! docker image inspect "$OCR_BASE_IMAGE" >/dev/null 2>&1 ||
    [ "$(cat "$OCR_HASH_FILE" 2>/dev/null || true)" != "$OCR_HASH" ]; then
    echo "Building OCR base image ($OCR_BASE_IMAGE): missing or OCR deps changed..."
    docker build -f Dockerfile.ocr-base --build-arg "OCR_GPU=${OCR_GPU}" -t "$OCR_BASE_IMAGE" .
    echo "$OCR_HASH" >"$OCR_HASH_FILE"
else
    echo "OCR base image up to date ($OCR_BASE_IMAGE) — skipping CUDA rebuild."
fi

# Build backend image (runtime stage = FROM reverie-ocr-base + built app).
# This is the fast, per-deploy build; it does NOT touch Python/CUDA.
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" build backend

# Extract web dist from builder stage
docker build \
    --target builder \
    --build-arg VITE_API_URL=https://api.reverieapp.dev \
    -t reverie-builder \
    .
cid=$(docker create reverie-builder)
mkdir -p "$WEB_DIR"
rm -rf "${WEB_DIR:?}"/*
docker cp "$cid:/app/apps/web/dist/." "$WEB_DIR/"
docker rm "$cid"
docker rmi reverie-builder

# Start/restart containers
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

# Run migrations (use run not exec — one-off container, more reliable than exec into possibly-starting container)
MIGRATE_PATH="apps/backend/dist/apps/backend/src/db/migrate.js"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm backend sh -c "
    if [ ! -f \"$MIGRATE_PATH\" ]; then
        echo 'ERROR: Migration script not found at $MIGRATE_PATH'
        echo 'Contents of apps/backend/dist:'
        ls -la apps/backend/dist/ 2>/dev/null || true
        echo 'Looking for migrate.js:'
        find apps/backend/dist -name 'migrate.js' 2>/dev/null || true
        exit 1
    fi
    node \"$MIGRATE_PATH\"
"

# Clean up old images
docker image prune -f

echo "Deploy complete"
