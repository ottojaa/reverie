# Reverie

Self-hosted Google Drive-like app with OCR and LLM capabilities for organizing and searching document collections. Nx + Yarn 4 (Berry) monorepo, TypeScript/ESM throughout, Node 22+.

## Monorepo Structure

- `apps/backend` — Fastify API server + BullMQ workers
- `apps/web` — Electron + React 19 desktop app
- `apps/android` — Kotlin + Jetpack Compose mobile app
- `libs/shared` — Zod schemas and TypeScript types shared between backend and web

## Tech Stack

| Layer           | Technology                                        |
| --------------- | ------------------------------------------------- |
| Backend Runtime | Node.js + Fastify                                 |
| Database        | PostgreSQL + Kysely                               |
| Validation      | Zod                                               |
| Job Queue       | BullMQ + Redis                                    |
| Real-time       | Socket.io                                         |
| Web UI          | React + TanStack Router/Query + Tailwind + shadcn |
| Desktop         | Electron                                          |
| Mobile          | Kotlin + Jetpack Compose                          |
| OCR             | Tesseract.js / PaddleOCR                          |
| LLM             | Anthropic (Claude) API                            |

## Key Conventions

- Run tasks through Nx: `nx serve backend`, `nx build web`, `nx run-many -t lint`.
- API contracts are defined once as Zod schemas in `libs/shared` (`@reverie/shared`) and used by both backend validation and web client types.
- ESM modules throughout; use `.js` extensions in relative imports.
- Never use the `any` type unless absolutely necessary.

## Commands

- `yarn lint` — runs both **lint and typecheck** (`nx run-many -t lint typecheck`).
- `yarn lint:fix` — eslint autofix.
- `yarn format` / `yarn format:check` — Prettier via `nx format:write` / `nx format:check`.
- Only run tests/typecheck/lint when it's relevant to the change or the user asks — don't run them reflexively after every edit.

## Code Style

- **Prefer early returns.** Exit early when preconditions fail; keep the primary path unindented.
- **Avoid nested conditionals.** Flatten with early returns or named helpers; inner functions are fine when they don't warrant extraction.
- **Prefer Immer over deep object spreads** for nested updates:

    ```typescript
    const next = produce(state, (draft) => {
        draft.user.profile.name = 'Jane';
        draft.items.push(newItem);
    });
    ```

    Use shallow spreads only for simple, one-level updates.

## Coding Conventions

- Treat objects as **immutable**; produce new values rather than mutating in place.
- **Static error-message text**, with any dynamic part after a colon (e.g. `throw new Error('Failed to load document: ' + id)`) — keeps errors groupable in logging/Sentry.
- Keep functions under ~40 lines and files under ~300 lines; extract when they grow past that.
- **Naming**: `fetchX` (remote/async fetch), `loadX` (load into memory/state), `isX`/`hasX` (booleans), `assertX` (throws on failure), `toX` (pure converters).
- Mark follow-ups with `// TODO <initials>:` and actionable text, e.g. `// TODO oj: handle empty-folder case`.
- Prefer `function` declarations for top-level functions; arrow functions for inline callbacks and React components as idiomatic.
- Don't refactor existing/legacy code to match these conventions unless asked — follow them for new code and maintain local consistency in files you touch.

Area-specific conventions live in on-demand skills (see below) — those take precedence within their area.

## Memories Workflow

When you discover a non-obvious gotcha or make a mistake worth not repeating, in addition to fixing it:

- Add a **code comment** for knowledge specific to a single line/function.
- Add an entry to **`.claude/memories/index.md`** for project-level, architectural, or cross-file knowledge.

This memories file is git-ignored, per-machine state; it complements Claude Code's built-in per-user memory.

## Skills (area conventions, loaded on demand)

`.claude/skills/`: `backend-conventions`, `database-conventions`, `web-conventions`, `workers-conventions`, `android-conventions`, `shared-conventions`, `brand-guidelines`, `frontend-design`.

## Subagents (specialized tasks)

`.claude/agents/`: `api-contract-sync`, `worker-job-pipeline`, `migration-writer`, `document-viewer`, `schema-change-propagator`, `search-filter-sync`, and the read-only `dependency-trace`. Delegate to these for the multi-file, cross-stack tasks they describe.

## Commands

`.claude/commands/finalize-pr.md` — the PR-prep playbook (`/finalize-pr`).

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.

<!-- nx configuration end-->
