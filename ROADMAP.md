# Reverie Roadmap

A living plan for where Reverie is headed. It's benchmarked against [Immich](https://immich.app)
(the most mature self-hosted photo/video manager), but Reverie is **not** an Immich clone — see
_Positioning_ below. Priorities and scope will shift; treat this as direction, not commitment.

## Positioning

Reverie and Immich look alike but have different centers of gravity:

- **Immich is Google Photos** — timeline-first, photos/videos only, local discriminative ML
  (CLIP embeddings, face recognition, OCR).
- **Reverie is Google Drive + intelligence** — a folder hierarchy over _any_ file type
  (documents, photos, videos), with generative LLM features (summaries, entities, topics, an
  agentic organize assistant) layered on top.

"Parity" therefore means borrowing the handful of Immich pillars that any everything-app needs
(reliable backup, sharing, semantic search, safety nets) **without** diluting the document + LLM
story Immich can't touch.

### Moat to protect (things Immich does _not_ have)

Per-document LLM summaries/entities/topics · agentic organize assistant · real document-type
support (Office/PDF/text/code with rendered thumbnails) · hierarchical collections→folders ·
pluggable **S3** storage · Electron desktop app · content-addressable dedup storage · the
password-locked Vault · document-date-vs-photo-date distinction.

---

## Status legend

| Marker | Meaning |
| ------ | ------- |
| ✅ | Shipped |
| 🔜 | Next up |
| 🛠️ | Planned |
| 🧊 | Deferred — but capture the data now (see _Data to start capturing_) |
| ❌ | Not planned (for now) |

---

## Where Reverie stands vs Immich

### Ingest & backup

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Background camera auto-backup | ✅ core | ❌ manual upload only | 🔜 **next core feature** |
| Selective/excluded album backup, Wi-Fi-only | ✅ | ❌ | 🛠️ with auto-backup |
| De-dup on upload | checksum | ⚠️ filename + folder-scoped only | 🛠️ move to content-hash, global (see below) |
| On-device cleanup after verified backup | ✅ | ❌ | 🛠️ after auto-backup |
| Server-side external libraries (watch a folder) | ✅ | ❌ | 🧊 |
| CLI bulk upload | ✅ | ❌ | 🧊 |

### Safety & data lifecycle

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Trash / recycle bin | ✅ w/ retention | ❌ **hard deletes** | 🔜 soft-delete + **configurable TTL** |

### Search & intelligence

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Full-text + rich filter DSL | basic | ✅ ahead (`type:`/`date:`/`entity:`/`has:`) | ✅ |
| OCR text search | ✅ recent | ✅ ahead (PaddleOCR/Tesseract) | ✅ |
| LLM summaries / entities / auto-organize | ❌ | ✅ unique | ✅ |
| Semantic / natural-language search | ✅ CLIP + vectors | ❌ | 🛠️ embeddings + pgvector (hybrid with tsvector) |
| Near-duplicate detection | ✅ embedding-based | ❌ exact-hash only | 🛠️ after pgvector |
| Face detection & people | ✅ InsightFace | ❌ | ❌ low ROI for now |

### Sharing & access control

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Public share links (password/expiry) | ✅ | ❌ | 🛠️ **first sharing feature** |
| Shared folders (editor/viewer roles) | ✅ | ❌ | 🛠️ after public links |
| Partner sharing (whole library) | ✅ | ❌ | 🛠️ after shared folders |

### Organization & browsing

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Collections / folder hierarchy | flat albums | ✅ two-level tree | ✅ |
| Timeline (scrubbable, date-grouped) | ✅ core | ❌ | 🧊 capture data now, build later |
| Geographic map / places view | ✅ web + mobile | ⚠️ Android per-doc map card only | 🧊 |
| Favorites / Archive / Memories | ✅ | ❌ | 🧊 |

### Media handling

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Video transcoding + adaptive streaming | ✅ HW-accel | ❌ stream-copy trim only | 🛠️ "personal Netflix" — **ahead of photo editing** |
| Rich EXIF capture (camera/lens/exposure) | ✅ | ⚠️ only GPS + `taken_at` | 🧊 capture now |
| RAW / Live Photos / 360° | ✅ | ❌ | 🧊 |
| EXIF editing | ✅ | ❌ | 🧊 |

### Platform & integrations

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| REST API + OpenAPI spec | ✅ | ✅ (`/docs`) | ✅ |
| Published client SDK | ✅ TS + Dart | ❌ | 🧊 until traction |
| Per-user API keys | ✅ | ❌ (JWT only) | 🧊 with SDK |
| MCP server (expose library to LLM agents) | ❌ | ❌ | 🛠️ new — a natural fit for an LLM-native app |

### Auth & security

| Capability | Immich | Reverie | Plan |
| ---------- | ------ | ------- | ---- |
| Password + OAuth | OAuth2/OIDC | ⚠️ Google OAuth only | 🛠️ generalize OIDC |
| Email verification (signup, password change/reset) | ✅ | ❌ | 🛠️ |
| 2FA / TOTP | ⚠️ recent | ❌ | 🧊 |
| Authenticated realtime socket | ✅ | ❌ **unauthenticated** | 🔜 security fix |

---

## Roadmap by priority

### 🔜 Now / Next — core everything-app foundations

1. **Background auto-backup (Android).** The single biggest gap vs Immich and the reason people run
   it. Foundation already exists (content-addressable storage, `file_hash`, `check-duplicates`,
   foreground `UploadWorker`). Needs: `PeriodicWorkRequest` + `MediaStore` observer, a
   "back up these albums / Wi-Fi-only" settings surface, and a local backed-up-asset ledger.
2. **Trash + soft-delete with configurable TTL.** Replace hard deletes with a `deleted_at` column,
   filter it out of listings/search, and add a retention worker with a user/admin-configurable TTL.
   Do this before there's more data to lose.
3. **Authenticate the realtime socket.** Not parity — a real hole the code already flags. Verify the
   JWT in the socket handshake and scope rooms to the authenticated `user_id` instead of trusting
   client-supplied `session_id`/`document_id`.
4. **Fix duplicate detection.** Today it matches `original_filename` within a single folder. Switch
   to **`file_hash`, globally** (drop the `folder_id` filter; `idx_documents_hash` already exists),
   matching what content-addressable storage already does physically. Keep filename as a secondary
   "same name, different content" warning.

### 🛠️ Then — sharing, search intelligence, media

- **Public share links** (share token + optional password/expiry; leans on the existing signed-URL
  file-serving scheme) → **shared folders** (editor/viewer roles, needs a grant/ACL table threaded
  through the `user_id`-scoped queries) → **partner sharing**.
- **Semantic search:** add pgvector + embeddings. Hybrid with tsvector (keep lexical for exact
  matches). Reverie-specific angle: embed **LLM summaries + OCR text** (semantic doc search Immich
  can't do), optionally plus CLIP image embeddings. Near-dup detection follows for near-free.
- **Video transcoding + adaptive streaming** — the "personal Netflix" use case, prioritized ahead of
  photo editing.
- **MCP server** — expose search / fetch / organize over MCP so Claude and other agents can work
  against a Reverie library directly.
- **Better auth** — generalize OAuth→OIDC (Google login), add email verification for signup and
  password change/reset.

### 🧊 Deferred — build later, but capture the data _now_

These are intentionally postponed, but the metadata they need should be captured at ingest today so
they don't require a full reprocess later.

- **Timeline view** (needs reliable capture timestamps — already have `taken_at`/`extracted_date`).
- **Geographic map/places browsing** (GPS already captured; reverse-geo city/country already stored).
- **Rich media features** — RAW / Live Photos / 360°, EXIF editing, HEIC original conversion.
- **API keys + published SDK** — gated on the project gaining traction.
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
