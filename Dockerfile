# Base image for the runtime stage: reverie-ocr-base provides Node 22 (slim) +
# Python + PaddleOCR + the CUDA/cuDNN stack. Built separately and rarely (see
# Dockerfile.ocr-base + scripts/deploy.sh) so code deploys never re-download CUDA.
# Declared here (global scope) so it can be used in the runtime `FROM` below.
# Override with --build-arg OCR_BASE=<image:tag>; defaults to :latest.
ARG OCR_BASE=reverie-ocr-base:latest

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
# Built FROM reverie-ocr-base, which provides Node 22 (slim) + Python + PaddleOCR
# and the multi-GB CUDA/cuDNN stack. That base is built separately and rarely (see
# Dockerfile.ocr-base + scripts/deploy.sh), so ordinary code deploys never rebuild
# or re-download CUDA — this stage just layers the built app on top.
# (OCR_BASE is declared in the global scope at the top of this file.)
FROM ${OCR_BASE} AS runtime
WORKDIR /app

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
