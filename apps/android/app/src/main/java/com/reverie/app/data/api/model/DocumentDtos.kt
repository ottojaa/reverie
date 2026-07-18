package com.reverie.app.data.api.model

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
    val created_at: String,
    val updated_at: String,
    // Signed, short-lived URLs — never persist these.
    val file_url: String? = null,
    val thumbnail_urls: ThumbnailUrls? = null,
    // Detail-only.
    val photo_metadata: DocumentPhotoMetadata? = null,
)

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
