---
name: reverie-jobs
description: Operate and debug Reverie's background job pipeline — inspect OCR/LLM/thumbnail/trim job status, read a document's processing results, find failed jobs, and force-reprocess a document. Load when asked why a document didn't get OCR/tags/a summary/thumbnail, to retry or reprocess a document, or to inspect the BullMQ queues / processing_jobs. For writing new worker/queue code, use `workers-conventions` instead.
---

# Reverie job pipeline (operate & debug)

Background processing runs on **BullMQ (Redis) queues** with per-type workers. This skill is about *operating* the pipeline (inspect / retry / reprocess); for the code conventions of *adding* a job type, use `workers-conventions`.

## Model

Upload kicks off, per document:

```
upload ──> OCR ──(on success & eligible)──> LLM analysis
      └──> thumbnail        (independent)
      └──> video trim       (independent, videos only)
```

The **OCR worker chains into LLM** on success (`ocr.worker.ts` → `shouldQueueLlmJob(result)` → `addLlmJob`). So re-running OCR re-runs LLM too; re-running LLM alone reuses the existing OCR text.

| Queue (`QUEUE_NAMES`) | Job name | Enqueue fn | Worker | Data |
| --- | --- | --- | --- | --- |
| `ocr-queue` | `process-ocr` | `addOcrJob(data, jobId)` | `workers/ocr.worker.ts` | `{ documentId, filePath, forceReprocess? }` |
| `llm-queue` | `process-llm` | `addLlmJob(data, jobId)` | `workers/llm.worker.ts` | `{ documentId, type? }` |
| `thumbnail-queue` | `generate-thumbnail` | `addThumbnailJob` | `workers/thumbnail.worker.ts` | `{ documentId, ... }` |
| `trim-queue` | `trim-video` | `addTrimJob` | `workers/trim.worker.ts` | `{ ... }` |

Two places record state:

- **`processing_jobs` table** — one row per enqueued job. Columns: `job_type` (`ocr` \| `thumbnail` \| `llm_summary` \| `video_trim`), `target_type` (`document` \| `folder`), `target_id`, `status` (`pending` \| `processing` \| `complete` \| `failed` \| `skipped`), `attempts`, `error_message`, `result`, `started_at` / `completed_at` / `duration_ms`. **The BullMQ job id == the `processing_jobs.id`** (same UUID) — that's the link between the queue and the DB row. Workers move the row through the statuses (`worker.utils.ts`) and retry up to `attempts` (default 3) unless the error is non-retryable.
- **`documents.{ocr_status, llm_status, thumbnail_status}`** — the current per-stage state shown in the UI.

Results land in `ocr_results` (raw_text, confidence_score, ocr_engine) and `llm_results` (summary, metadata JSONB with entities/topics/title, token_count); auto tags go to `document_tags` (source `auto`).

## Reading state (read-only)

Use the `reverie-server` skill's `db-query.sh` wrapper (read-only by default). Common questions:

```bash
DB=~/.claude/skills/reverie-server/db-query.sh

# Where is this document stuck?
$DB prod "SELECT ocr_status, llm_status, thumbnail_status FROM documents WHERE id='<id>';"

# Its recent jobs (newest first) with failure reasons
$DB prod "SELECT job_type, status, attempts, error_message, created_at, completed_at, duration_ms
          FROM processing_jobs WHERE target_id='<id>' ORDER BY created_at DESC LIMIT 10;"

# What OCR/LLM actually produced
$DB prod "SELECT ocr_engine, confidence_score, left(raw_text, 400) FROM ocr_results WHERE document_id='<id>';"
$DB prod "SELECT summary, metadata->'entities', metadata->'topics' FROM llm_results WHERE document_id='<id>';"
$DB prod "SELECT source, tag FROM document_tags WHERE document_id='<id>' ORDER BY source, tag;"

# Fleet health: failed / stuck jobs across everyone
$DB prod "SELECT job_type, status, count(*) FROM processing_jobs GROUP BY 1,2 ORDER BY 1,2;"
$DB prod "SELECT id, job_type, target_id, error_message, created_at FROM processing_jobs
          WHERE status='failed' ORDER BY created_at DESC LIMIT 20;"
```

## Reprocessing a document

**Preferred (ops, no auth): the `reprocess` script** — mirrors the retry routes and enqueues real jobs (workers must be running):

```bash
# Full pipeline (OCR, then chained LLM). cwd must be apps/backend/dist (nested esbuild output).
ssh reverie "docker exec reverie-backend sh -c 'cd apps/backend/dist && yarn run reprocess <documentId>'"

# LLM only, against existing OCR text
ssh reverie "docker exec reverie-backend sh -c 'cd apps/backend/dist && node apps/backend/src/scripts/reprocess.js <documentId> --stage llm'"
```

Then watch it land with the `processing_jobs` / status queries above.

**Via the app (auth'd HTTP)** — what the UI calls; use when a real user session is in play:

- `POST /documents/:id/ocr/retry` — force OCR reprocess (chains into LLM).
- `POST /documents/:id/process-llm` — LLM only, **no-op if an `llm_results` row already exists** (returns `already_complete`).
- `POST /documents/:id/reprocess-llm` — deletes the existing `llm_results` then re-runs LLM (the true LLM re-do).

## Inspecting the queues directly (BullMQ / Redis)

`processing_jobs` answers most questions; drop to Redis only for queue-internal state (stuck/delayed/stalled):

```bash
ssh reverie 'docker exec reverie-redis redis-cli KEYS "bull:ocr-queue:*"'
ssh reverie 'docker exec reverie-redis redis-cli LLEN "bull:ocr-queue:wait"'
```

## Gotchas

- **Retrying OCR re-runs LLM** (the chain). To regenerate only tags/summary, use `--stage llm` / `reprocess-llm`.
- **`process-llm` is idempotent-guarded**: it skips if an `llm_results` row exists. Use `reprocess-llm` (deletes first) or the script's `--stage llm` (also deletes) to force.
- **`ocr_results.processed_at` is not bumped on reprocess** (`saveOcrResult`'s update branch doesn't set it), so trust `ocr_engine` / job timestamps over that column to tell whether a reprocess ran.
- **`db-query.sh` is read-only**; only pass `--write` for a deliberate, user-requested state change (prefer the script/route for reprocessing over hand-writing job rows).
- OCR/LLM run on the GPU; the live service reserves most of the RTX 3080, so don't try to run a second PaddleOCR process alongside it (see the OCR notes in project memory).
