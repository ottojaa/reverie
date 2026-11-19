# The in-app agent: the stock Claude Code binary behind a small HTTP wrapper (server.mjs).
# Build context is apps/agent. The image holds no library data, no database credentials and no
# Docker socket; Claude reaches Reverie only through the backend's /mcp with a per-request token.
FROM node:22-slim

# Pinned release; bump on purpose. Installed with npm, the documented install route.
ARG CLAUDE_CODE_VERSION=2.1.329
RUN npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force

# /data/claude holds the one-time login, config and session transcripts (--resume needs them), so it is a volume.
# /run/reverie-agent is where the backend's shared-secret volume is mounted (read-only).
# /work is an empty working directory: no project files, skills or CLAUDE.md for Claude to pick up.
RUN mkdir -p /data/claude /run/reverie-agent /work && chown -R node:node /data/claude /work

WORKDIR /app
COPY server.mjs claude-args.mjs ./

USER node
ENV CLAUDE_CONFIG_DIR=/data/claude \
    DISABLE_AUTOUPDATER=1 \
    AGENT_CWD=/work \
    PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
