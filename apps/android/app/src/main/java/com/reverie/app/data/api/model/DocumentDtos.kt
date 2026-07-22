package com.reverie.app.data.api.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class ThumbnailUrls(val sm: String, val md: String, val lg: String)

@Serializable
data class ThumbnailPaths(val sm: String, val md: String, val lg: String)

@Serializable
data class EntityDto(
    val type: EntityType,
    val canonical_name: String,
    val raw_text: String,
    val confidence: String? = null,
)

/** EXIF-derived location/time; only present on the document detail endpoint. */
@Serializable
data class DocumentPhotoMetadata(
    val latitude: Double? = null,
    val longitude: Double? = null,
    val city: String? = null,
    val country: String? = null,
    val taken_at: String? = null,
)

// @Immutable so the Files grid can skip recomposing unchanged tiles. All fields are `val`s over
// immutable types (JsonObject is a read-only map), so treating instances as stable is accurate and
// lets DocumentCard skip when the same instance is re-passed. See the startup-perf notes.
@Immutable
@Serializable
data class DocumentDto(
    val id: String,
    val folder_id: String? = null,
    val file_path: String,
    val file_hash: String,
    val original_filename: String,
    val mime_type: String,
    val size_bytes: Long,
    val width: Int? = null,
    val height: Int? = null,
    // Video length in seconds; null for non-video documents.
    val duration_seconds: Double? = null,
    val thumbnail_blurhash: String? = null,
    val thumbnail_paths: ThumbnailPaths? = null,
    val document_category: DocumentCategory? = null,
    val extracted_date: String? = null,
    val ocr_status: JobStatus,
    val thumbnail_status: JobStatus,
    val llm_status: JobStatus,
    val llm_summary: String? = null,
    // Loosely typed on the wire (record<unknown>); decode leniently via LlmMetadata.
    val llm_metadata: JsonObject? = null,
    val llm_processed_at: String? = null,
    val llm_token_count: Long? = null,
    val is_private: Boolean,
    // True when this item is effectively private AND the vault is locked for this session:
    // the server withholds all content (urls/thumbnails/summary/location) and the UI shows a
    // lock affordance instead of opening. See VaultRepository.
    val locked: Boolean = false,
    val created_at: String,
    val updated_at: String,
    // Signed, short-lived URLs — never persist these.
    val file_url: String? = null,
    val thumbnail_urls: ThumbnailUrls? = null,
    // Detail-only.
    val photo_metadata: DocumentPhotoMetadata? = null,
)

/**
 * True when the server actually rendered a thumbnail image for this document.
 *
 * NOT the same as `thumbnail_status == COMPLETE`: the backend marks non-previewable files
 * (apk, zip, audio, exe, …) `complete` at upload time with no thumbnail ever produced
 * (upload.service `canThumbnail ? 'pending' : 'complete'`), so status alone makes those
 * files look like they have a preview — the viewer/grid then request a thumbnail the server
 * 404s on and draw an empty box.
 *
 * The precise signal is `thumbnail_paths != null`, but the Room cache drops that field
 * (Mappers.toDto), and both the grid and viewer read through the cache. The blurhash is the
 * cache-safe proxy: the thumbnail worker writes it together with `thumbnail_paths` only when a
 * thumbnail is genuinely rendered, and it round-trips through the cache.
 */
val DocumentDto.hasRenderedThumbnail: Boolean
    get() = !thumbnail_blurhash.isNullOrBlank()

/** width/height ratio for image/video docs, or null when dimensions are unknown. */
fun DocumentDto.mediaAspectOrNull(): Float? {
    val w = width ?: return null
    val h = height ?: return null
    if (w <= 0 || h <= 0) return null
    return w.toFloat() / h.toFloat()
}

@Serializable
data class DocumentStatusJob(
    val type: String,
    val status: JobStatus,
    val progress: Double? = null,
    val completed_at: String? = null,
)

@Serializable
data class DocumentStatusResponse(
    val document_id: String,
    val ocr_status: JobStatus,
    val thumbnail_status: JobStatus,
    val llm_status: JobStatus,
    val jobs: List<DocumentStatusJob>,
)

@Serializable
data class BatchDeleteDocuments(val ids: List<String>)

@Serializable
data class CheckDuplicatesRequest(
    val folder_id: String,
    val filenames: List<String>,
)

@Serializable
data class CheckDuplicatesResponse(val duplicates: List<String>)

@Serializable
data class MoveDocumentsRequest(
    val document_ids: List<String>,
    val folder_id: String,
    val conflict_strategy: ConflictStrategy? = null,
)

@Serializable
data class UpdateDocumentRequest(val original_filename: String)

@Serializable
data class SetDocumentPrivacyRequest(
    val document_ids: List<String>,
    val is_private: Boolean,
)

@Serializable
data class DocumentOcrResult(
    val document_id: String,
    val raw_text: String,
    val confidence_score: Double? = null,
    val text_density: Double? = null,
    val has_meaningful_text: Boolean,
    val metadata: JsonObject? = null,
    val processed_at: String,
)

@Serializable
data class TrimVideoRequest(
    val start: Double,
    val end: Double,
    val saveAsCopy: Boolean,
    val sessionId: String? = null,
)

@Serializable
data class TrimVideoResponse(val jobId: String)
