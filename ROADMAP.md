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

| Capability                                      | Immich   | Reverie                           | Plan                                     |
| ----------------------------------------------- | -------- | --------------------------------- | ---------------------------------------- |
| Background camera auto-backup                   | ✅ core  | ✅ Android, app closed            | ✅ shipped                               |
| Selective/excluded album backup, Wi-Fi-only     | ✅       | ✅ pick albums, Wi-Fi only        | ✅ shipped                               |
| De-dup on upload                                | checksum | ✅ content hash, library-wide     | ✅ shipped (web + Android manual upload) |
| Large uploads                                   | ✅       | ✅ up to 20 GB, clear size errors | ✅ (#66)                                 |
| On-device cleanup after verified backup         | ✅       | ❌                                | 🛠️ after auto-backup                     |
| Server-side external libraries (watch a folder) | ✅       | ❌                                | 🧊                                       |
| CLI bulk upload                                 | ✅       | ❌                                | 🧊                                       |

### Safety & data lifecycle

| Capability          | Immich          | Reverie                                                     | Plan     |
| ------------------- | --------------- | ----------------------------------------------------------- | -------- |
| Trash / recycle bin | ✅ w/ retention | ✅ restore, empty, retention purge (TTL in server settings) | ✅ (#71) |

### Search & intelligence

| Capability                                                  | Immich             | Reverie                                     | Plan                                          |
| ----------------------------------------------------------- | ------------------ | ------------------------------------------- | --------------------------------------------- |
| Full-text + rich filter DSL                                 | basic              | ✅ ahead (`type:`/`date:`/`entity:`/`has:`) | ✅                                            |
| OCR text search                                             | ✅ recent          | ✅ ahead (PaddleOCR/Tesseract)              | ✅                                            |
| LLM summaries / entities / auto-organize                    | ❌                 | ✅ unique                                   | ✅                                            |
| Locked items never sent to Anthropic                        | n/a (local ML)     | ✅ enforced in the LLM workers              | ✅ (#68)                                      |
| Background AI on Claude Haiku 5.5                           | n/a                | ✅ Haiku 5.5                                | ✅ (#70)                                      |
| Conversational AI assistant (organize + bulk edit + search) | ❌                 | ✅ in-app agent                             | ✅ in-app agent over the shared tool registry |
| Semantic / natural-language search                          | ✅ CLIP + vectors  | ❌                                          | ✅ hybrid search + "find similar images"      |
| Near-duplicate detection                                    | ✅ embedding-based | ❌ exact-hash only                          | ✅ Duplicates view + `find_duplicates` tool   |
| Face detection & people                                     | ✅ InsightFace     | ❌                                          | ❌ low ROI for now                            |

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

| Capability                               | Immich      | Reverie                                               | Plan    |
| ---------------------------------------- | ----------- | ----------------------------------------------------- | ------- |
| Video transcoding + adaptive streaming   | ✅ HW-accel | ✅ HLS ladder, served signed, played on web + Android | ✅ done |
| Rich EXIF capture (camera/lens/exposure) | ✅          | ✅ captured + shown                                   | ✅ done |
| RAW / Live Photos / 360°                 | ✅          | ❌                                                    | 🧊      |
| EXIF editing                             | ✅          | ❌                                                    | 🧊      |

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

1. ✅ **Background auto-backup (Android).** A settings screen turns it on, picks the albums (Camera
   preselected), a destination folder and Wi-Fi only (on by default). A periodic WorkManager job plus
   a new-media trigger hash each new photo and video, ask `check-content` first, and upload only what
   the library doesn't hold: content in a folder, a private folder or the trash is skipped and never
   copied back out. A device-side ledger (Room, one row per MediaStore item) remembers what's done.
   The worker is a plain background one working in slices of about 8 minutes; a video too big for one
   slice gets a slice to itself and, if that isn't enough, waits for "Back up now" with the app open
   (the server has no resumable upload yet). On-device cleanup stays planned.
2. ✅ **Trash + soft-delete with configurable TTL** (#71). Deletes set `deleted_at`; trashed items are
   hidden from listings, search and every AI path, and can be restored or deleted forever from the
   Trash view. A retention worker purges them after `trash.retentionDays` (server-settings store).
   Folders keep their meaning: deleting one drops its documents to the root and the folder itself is
   restorable (empty).
3. ✅ **Authenticate the realtime socket** (#60, #65). The JWT is verified in the socket handshake and
   rooms are scoped to the authenticated `user_id`. Shipped alongside the first lock for private
   items (#64, since replaced by one lock per private folder) and uploads up to 20 GB (#66).
4. ✅ **Fix duplicate detection.** Before an upload, web and the Android manual upload hash each file
   (SHA-256, the server's `file_hash`) and ask `POST /documents/check-content` where that content
   already is, anywhere in the library: a folder and filename, "in a private folder" (never an id, name
   or path, locked or not) or "in Trash". **Skip** is the default; **Upload anyway** and the replace /
   keep both choice for a same-name-different-content file are still offered. The endpoint takes name +
   hash in batches with or without a target folder, so the auto-backup can call it too.

### 🛠️ Then — sharing, search intelligence, media

- **Public share links** (share token + optional password/expiry; leans on the existing signed-URL
  file-serving scheme) → **shared folders** (editor/viewer roles, needs a grant/ACL table threaded
  through the `user_id`-scoped queries) → **partner sharing**.
- **Semantic search:** add pgvector + embeddings, computed **locally** (no per-document API cost,
  and nothing leaves the machine). Hybrid with tsvector (keep lexical for exact matches).
  Reverie-specific angle: embed **LLM summaries + OCR text** (semantic doc search Immich can't do),
  optionally plus CLIP image embeddings. Near-dup detection follows for near-free.
  _Status:_ shipped. Search fuses full text with the text and image embeddings (an exact word match still
  ranks first; ML down falls back to full text), and a document's view can list similar images. Near-duplicate
  detection has shipped too: image pairs above a similarity threshold are stored as they are embedded, and the Duplicates
  view groups them (no chains), suggests the copy to keep and moves the rest to the Trash, never deleting.
- ✅ **Video transcoding + adaptive streaming** — the "personal Netflix" use case, prioritized ahead of
  photo editing. Pipeline shipped: every video gets an H.264 HLS ladder (1080/720/480, fMP4, HDR tone
  mapped to SDR) from a `transcode` worker, NVENC when the card has it, with a resumable backfill. The
  ladder is served with a signed path token (`/files/hls/{exp}/{sig}/{hash}/…`, one token for the whole
  set, nginx `secure_link`, the same access rules and expiry as file URLs) and the web app (hls.js, native
  HLS where the browser has it) and Android (Media3) play it adaptively with a manual quality choice, the
  original when no ladder exists.
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

    - 🚧 **Image understanding** — screenshots and document images get one Haiku call that sees the
      downscaled image together with its OCR text (which may be empty) and returns what it is, the app or
      source (shown beside the summary, stored as an entity and a tag), a title, summary, entities and tags.
      Photos and private items never reach it.
      _Shipped:_ the local image-kind classifier (#87, #90), now deciding each image's category and which
      images may be sent (with a one-off script that rewrites the existing library from the verdicts); the
      call itself, its backfill over existing screenshots and document images, and the app/source display.
      _Still to do:_ checking real values on the server after the deploy, and `LLM_VISION_ENABLED=true` in
      production.

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

Captured at ingest and backfilled for existing files (done); nothing is built on it yet:

- ✅ **Full EXIF:** camera make/model, lens, ISO/aperture/shutter, focal length (and 35mm
  equivalent), flash, orientation, shot size, and the precise original capture time with its UTC
  offset (`photo_metadata`, one column per fact).
- ✅ **Video technical metadata:** container, video codec + profile, audio codec, bitrate,
  resolution, frame rate, rotation, HDR/colour transfer, creation time (`video_metadata`, read in
  the thumbnail worker's duration probe). A video's GPS and creation time feed the same place and
  date fields photos use.
- ✅ Everything lives in tables, so Timeline, map, and media features are a UI/query concern later,
  not a re-processing job. Still to capture: nothing on this list.

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
