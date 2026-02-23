#!/bin/bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/reverie}"
WEB_DIR="${DEPLOY_DIR}/web"
ENV_FILE="${DEPLOY_DIR}/.env.production"

cd "$DEPLOY_DIR"
git pull origin main

# Build backend image (runtime stage with PaddleOCR)
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
