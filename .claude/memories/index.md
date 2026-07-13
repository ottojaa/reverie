# Project Memories

Persistent, project-level notes and gotchas worth remembering across sessions. Add an entry here for architectural knowledge or cross-file gotchas; use inline code comments for knowledge specific to a single line or function. (See the Memories Workflow section in `CLAUDE.md`.)

Format each entry as a short dated bullet:

- `YYYY-MM-DD` — <the gotcha / decision / non-obvious fact>.

## Entries

- `2026-07-13` — LLM provider is **Anthropic (Claude)**, not OpenAI. Single integration seam: `apps/backend/src/llm/anthropic.client.ts` (all LLM calls go through it). Models are env-configured: organize → `ANTHROPIC_ORGANIZE_MODEL` (Claude Sonnet 5, agentic tool-calling); per-document summary + vision → `ANTHROPIC_SUMMARY_MODEL`/`ANTHROPIC_VISION_MODEL` (Claude Haiku 4.5, high-volume/cheap). `ANTHROPIC_EFFORT` sets organize thinking depth.
- `2026-07-13` — Organize (`services/organize.service.ts`) uses the Anthropic Messages API, which is **stateless** (no OpenAI `previous_response_id`). Multi-turn state (message history + `group_id` → document-id stash) lives in Redis via `services/organize-conversation.store.ts`, keyed by the opaque `response_id` the web client round-trips (TTL 1h). The system prompt + tool defs are cached via `cache_control`.
- `2026-07-13` — Organize perf: `find_documents` never returns raw document UUIDs to the model — it hands back short `group_id`s and stashes the ids server-side; `propose_organization` references groups by `group_id`. Keeps context/token cost small on the stateless API. Don't reintroduce UUID lists into tool output.
- `2026-07-13` — Package manager is **Yarn Classic v1** (not pnpm). Root `package.json` has `workspaces` + `packageManager: yarn@1.22.22`; internal deps use `"@reverie/shared": "*"` (Yarn 1 has no `workspace:*` protocol). `.yarnrc` sets `--ignore-engines`. `resolutions` pins the whole `nx`/`@nx/*` ecosystem to 22.4.0 (mismatched Nx plugin minors break the project graph with a `Target.inputs` error) and `vite` to ^7 (avoids a Yarn 1 vitest/vite link "Invariant Violation").
