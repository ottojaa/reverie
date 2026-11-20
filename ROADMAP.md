# Reverie Roadmap

A living plan for where Reverie is headed. It's benchmarked against [Immich](https://immich.app)
(the most mature self-hosted photo/video manager), but Reverie is **not** an Immich clone — see
_Positioning_ below. Priorities and scope will shift; treat this as direction, not commitment.

## Positioning

Reverie and Immich look alike but have different centers of gravity:

- **Immich is Google Photos** — timeline-first, photos/videos only, local discriminative ML
  (CLIP embeddings, face recognition, OCR).
- **Reverie is Google Drive + intelligence** — a folder hierarchy over _any_ file type
  (documents, photos, videos), with generative LLM features (summaries, entities, topics, a
  library agent) layered on top. The AI is **hybrid**: the heavy, high-volume work (OCR, layout,
  embeddings) runs locally; documents and screenshots get one Claude Haiku call each; personal
  photos and locked items never go to Anthropic.

"Parity" therefore means borrowing the handful of Immich pillars that any everything-app needs
(reliable backup, sharing, semantic search, safety nets) **without** diluting the document + LLM
story Immich can't touch.

### Moat to protect (things Immich does _not_ have)

Per-document LLM summaries/entities/topics · a library agent (in-app and over MCP) · real
document-type support (Office/PDF/text/code with rendered thumbnails) · hierarchical
collections→folders · pluggable **S3** storage · Electron desktop app · content-addressable dedup
storage · per-folder locks for private folders · document-date-vs-photo-date distinction.

---

## Status legend

| Marker | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| ✅     | Shipped                                                             |
| 🚧     | In progress                                                         |
| 🔜     | Next up                                                             |
| 🛠️     | Planned                                                             |
| 🧊     | Deferred — but capture the data now (see _Data to start capturing_) |
| ❌     | Not planned (for now)                                               |

---

## Where Reverie stands vs Immich

### Ingest & backup

| Capability                                      | Immich   | Reverie                           | Plan                                        |
| ----------------------------------------------- | -------- | --------------------------------- | ------------------------------------------- |
| Background camera auto-backup                   | ✅ core  | ❌ manual upload only             | 🔜 **next core feature**                    |
| Selective/excluded album backup, Wi-Fi-only     | ✅       | ❌                                | 🛠️ with auto-backup                         |
| De-dup on upload                                | checksum | ⚠️ filename + folder-scoped only  | 🛠️ move to content-hash, global (see below) |
| Large uploads                                   | ✅       | ✅ up to 20 GB, clear size errors | ✅ (#66)                                    |
| On-device cleanup after verified backup         | ✅       | ❌                                | 🛠️ after auto-backup                        |
| Server-side external libraries (watch a folder) | ✅       | ❌                                | 🧊                                          |
| CLI bulk upload                                 | ✅       | ❌                                | 🧊                                          |

### Safety & data lifecycle

| Capability          | Immich          | Reverie                                                     | Plan     |
| ------------------- | --------------- | ----------------------------------------------------------- | -------- |
| Trash / recycle bin | ✅ w/ retention | ✅ restore, empty, retention purge (TTL in server settings) | ✅ (#71) |

### Search & intelligence

| Capability                                                  | Immich             | Reverie                                     | Plan                                                  |
| ----------------------------------------------------------- | ------------------ | ------------------------------------------- | ----------------------------------------------------- |
| Full-text + rich filter DSL                                 | basic              | ✅ ahead (`type:`/`date:`/`entity:`/`has:`) | ✅                                                    |
| OCR text search                                             | ✅ recent          | ✅ ahead (PaddleOCR/Tesseract)              | ✅                                                    |
| LLM summaries / entities / auto-organize                    | ❌                 | ✅ unique                                   | ✅                                                    |
| Locked items never sent to Anthropic                        | n/a (local ML)     | ✅ enforced in the LLM workers              | ✅ (#68)                                              |
| Background AI on Claude Haiku 5.5                           | n/a                | ✅ Haiku 5.5                                | ✅ (#70)                                              |
| Conversational AI assistant (organize + bulk edit + search) | ❌                 | ⚠️ organize-only chat                       | ✅ in-app agent over the shared tool registry         |
| Semantic / natural-language search                          | ✅ CLIP + vectors  | ❌                                          | 🛠️ local embeddings + pgvector (hybrid with tsvector) |
| Near-duplicate detection                                    | ✅ embedding-based | ❌ exact-hash only                          | 🛠️ after pgvector                                     |
| Face detection & people                                     | ✅ InsightFace     | ❌                                          | ❌ low ROI for now                                    |

### Sharing & access control

| Capability                           | Immich | Reverie | Plan                         |
| ------------------------------------ | ------ | ------- | ---------------------------- |
| Public share links (password/expiry) | ✅     | ❌      | 🛠️ **first sharing feature** |
| Shared folders (editor/viewer roles) | ✅     | ❌      | 🛠️ after public links        |
| Partner sharing (whole library)      | ✅     | ❌      | 🛠️ after shared folders      |

### Organization & browsing

| Capability                          | Immich          | Reverie                          | Plan                             |
| ----------------------------------- | --------------- | -------------------------------- | -------------------------------- |
| Collections / folder hierarchy      | flat albums     | ✅ two-level tree                | ✅                               |
| Timeline (scrubbable, date-grouped) | ✅ core         | ❌                               | 🧊 capture data now, build later |
| Geographic map / places view        | ✅ web + mobile | ⚠️ Android per-doc map card only | 🧊                               |
| Favorites / Archive / Memories      | ✅              | ❌                               | 🧊                               |

### Media handling

| Capability                               | Immich      | Reverie                  | Plan                                               |
| ---------------------------------------- | ----------- | ------------------------ | -------------------------------------------------- |
| Video transcoding + adaptive streaming   | ✅ HW-accel | ❌ stream-copy trim only | 🛠️ "personal Netflix" — **ahead of photo editing** |
| Rich EXIF capture (camera/lens/exposure) | ✅          | ⚠️ only GPS + `taken_at` | 🧊 capture now                                     |
| RAW / Live Photos / 360°                 | ✅          | ❌                       | 🧊                                                 |
| EXIF editing                             | ✅          | ❌                       | 🧊                                                 |

### Platform & integrations

| Capability                                             | Immich              | Reverie                            | Plan                        |
| ------------------------------------------------------ | ------------------- | ---------------------------------- | --------------------------- |
| REST API + OpenAPI spec                                | ✅                  | ✅ (`/docs`)                       | ✅                          |
| Published client SDK                                   | ✅ TS + Dart        | ❌                                 | 🧊 until traction           |
| Per-user API keys                                      | ✅                  | ✅ revocable tokens (#73)          | ✅                          |
| MCP server (expose library to LLM agents)              | ❌                  | ✅ `/mcp` (#73)                    | ✅                          |
| Local, self-hosted LLM providers (for self-hosters)    | ✅ own ML container | ❌ cloud (Anthropic) only          | 🛠️ optional, per-capability |
| Runtime admin settings (change config without restart) | ✅ admin UI         | ✅ settings store + admin UI (#69) | ✅                          |

### Auth & security

| Capability                                         | Immich      | Reverie              | Plan               |
| -------------------------------------------------- | ----------- | -------------------- | ------------------ |
| Password + OAuth                                   | OAuth2/OIDC | ⚠️ Google OAuth only | 🛠️ generalize OIDC |
| Email verification (signup, password change/reset) | ✅          | ❌                   | 🛠️                 |
| 2FA / TOTP                                         | ⚠️ recent   | ❌                   | 🧊                 |
| Authenticated realtime socket                      | ✅          | ✅ JWT handshake     | ✅ (#60, #65)      |
| Per-item lock (private items, re-prompt to open)   | —           | ✅ per-folder lock   | ✅ (#64)           |

---

## Roadmap by priority

### 🔜 Now / Next — core everything-app foundations

1. **Background auto-backup (Android).** The single biggest gap vs Immich and the reason people run
   it. Foundation already exists (content-addressable storage, `file_hash`, `check-duplicates`,
   foreground `UploadWorker`). Needs: `PeriodicWorkRequest` + `MediaStore` observer, a
   "back up these albums / Wi-Fi-only" settings surface, and a local backed-up-asset ledger.
2. ✅ **Trash + soft-delete with configurable TTL** (#71). Deletes set `deleted_at`; trashed items are
   hidden from listings, search and every AI path, and can be restored or deleted forever from the
   Trash view. A retention worker purges them after `trash.retentionDays` (server-settings store).
   Folders keep their meaning: deleting one drops its documents to the root and the folder itself is
   restorable (empty).
3. ✅ **Authenticate the realtime socket** (#60, #65). The JWT is verified in the socket handshake and
   rooms are scoped to the authenticated `user_id`. Shipped alongside the first lock for private
   items (#64, since replaced by one lock per private folder) and uploads up to 20 GB (#66).
4. **Fix duplicate detection.** Today it matches `original_filename` within a single folder. Switch
   to **`file_hash`, globally** (drop the `folder_id` filter; `idx_documents_hash` already exists),
   matching what content-addressable storage already does physically. Keep filename as a secondary
   "same name, different content" warning.

### 🛠️ Then — sharing, search intelligence, media

- **Public share links** (share token + optional password/expiry; leans on the existing signed-URL
  file-serving scheme) → **shared folders** (editor/viewer roles, needs a grant/ACL table threaded
  through the `user_id`-scoped queries) → **partner sharing**.
- **Semantic search:** add pgvector + embeddings, computed **locally** (no per-document API cost,
  and nothing leaves the machine). Hybrid with tsvector (keep lexical for exact matches).
  Reverie-specific angle: embed **LLM summaries + OCR text** (semantic doc search Immich can't do),
  optionally plus CLIP image embeddings. Near-dup detection follows for near-free.
- **Video transcoding + adaptive streaming** — the "personal Netflix" use case, prioritized ahead of
  photo editing.
- **Hybrid AI** — OCR, layout and embeddings run locally. Documents and screenshots get one Claude
  **Haiku** call each (summary, entities, tags). **Personal photos and locked items never go to
  Anthropic.**
    - ✅ **Privacy gate** (#68) — the LLM workers refuse any private item (one in a private folder or
      collection) at processing time, even when it was locked while its job waited.
    - ✅ **Haiku 5.5** (#70) for the background jobs (summaries and image descriptions), on SDK 1.x and
      the current API version, with model, tokens and cost logged per summary.
    - ✅ **Shared tool registry** (#72) — one set of library tools (search, get, list, overview, tags, move,
      create/rename folder, rename document) with selections instead of ID lists, locked and trashed
      items invisible, a dry run on every write, and an audit log that can undo each write. Photos
      expose details only (name, date, place, tags), never the image. No delete tool.
    - ✅ **MCP server** (#73) — the registry exposed at `/mcp` over Streamable HTTP, with revocable per-user
      API tokens (made and revoked on the settings page), so Claude Code and other agents can work
      against a Reverie library directly.

    - ✅ **In-app agent** — a chat window onto stock Claude Code in its own container, restricted to the
      same registry via `/mcp`, for the admin only, with an Undo on every write. Replaced the organize-only
      chat (manual organize stays).

- **Optional: pluggable local LLM providers** — for self-hosters who want no cloud AI at all. A
  provider seam so a capability (summaries, vision) can target a local model over an
  OpenAI-compatible endpoint (Ollama, llama.cpp, …) in a separate container, configured from the
  admin UI. Not on the critical path: local summaries are weak at the sizes that fit a 10 GB GPU
  shared with PaddleOCR, so Claude stays the default.
- **Better auth** — generalize OAuth→OIDC (Google login), add email verification for signup and
  password change/reset.

### 🧊 Deferred — build later, but capture the data _now_

These are intentionally postponed, but the metadata they need should be captured at ingest today so
they don't require a full reprocess later.

- **Timeline view** (needs reliable capture timestamps — already have `taken_at`/`extracted_date`).
- **Geographic map/places browsing** (GPS already captured; reverse-geo city/country already stored).
- **Rich media features** — RAW / Live Photos / 360°, EXIF editing, HEIC original conversion.
- **Published SDK** — gated on the project gaining traction (per-user API tokens shipped with the MCP server).
- **Favorites / Archive / Memories**, server-side external libraries, CLI bulk upload, 2FA.

#### Data to start capturing now

To keep the 🧊 items cheap later, extend ingest to persist (beyond today's GPS + `taken_at`):

- **Full EXIF:** camera make/model, lens, ISO/aperture/shutter, focal length, orientation, precise
  original capture timestamp.
- **Video technical metadata:** codec, container, bitrate, resolution, frame rate (duration already
  captured) — needed for transcoding decisions.
- Keep everything in a metadata table so Timeline, map, and media features are a UI/query concern
  later, not a re-processing job.

### ❌ Not planned (for now)

- **Face detection / recognition / people grouping** — high effort (a separate ML microservice),
  low personal ROI. Revisit only if photos become the primary use case.

---

## Guardrails

- **Don't adopt a storage-template engine.** Reverie's content-addressable storage (path = content
  hash) gives automatic dedup, free moves/renames, and clean S3 support. "Where a file lives"
  (storage) stays separate from "how it's organized" (folders/collections — a DB/query concern).
- **Don't replace folders with albums.** The hierarchy is a Drive-grade advantage. If albums are
  ever wanted, add them as an optional cross-cutting layer, not a replacement.
- **One server-settings store, not per-feature configs** (✅ shipped in #69). Runtime AI settings and
  the configurable trash TTL want the same primitive — a typed, DB-backed settings store (admin UI +
  API, env as the fallback default). Build it once. Classify each setting as **live** (read at use,
  applies on the next job — models, provider, toggles, TTL) or **boot** (needs a restart — worker
  concurrency, queues, storage provider); mark boot-only settings in the UI and add an admin restart
  action for them, rather than building hot-reload machinery.
