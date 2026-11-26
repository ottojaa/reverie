package com.reverie.app.data.api.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

/** A document in the trash. [folder_id] is the folder it was in; null for the top level. */
@Immutable
@Serializable
data class TrashDocumentDto(
    val id: String,
    val original_filename: String,
    val mime_type: String,
    val size_bytes: Long,
    val folder_id: String? = null,
    val is_private: Boolean = false,
    val thumbnail_blurhash: String? = null,
    val thumbnail_urls: ThumbnailUrls? = null,
    val deleted_at: String,
    val purge_at: String,
)

/**
 * A folder in the trash, standing for everything that went there with it: [folder_count] folders beneath
 * it and [document_count] documents. While [locked] (private, closed) it has no name and both counts are 0.
 */
@Immutable
@Serializable
data class TrashFolderDto(
    val id: String,
    val name: String,
    val emoji: String? = null,
    val is_private: Boolean = false,
    val locked: Boolean = false,
    val folder_count: Int = 0,
    val document_count: Int = 0,
    val deleted_at: String,
    val purge_at: String,
)

@Serializable
data class TrashListDto(
    val documents: List<TrashDocumentDto> = emptyList(),
    val folders: List<TrashFolderDto> = emptyList(),
    val retention_days: Int,
)

/** The items to restore or to delete for good; at least one, and at most 500 of each. */
@Serializable
data class TrashSelectionRequest(
    val document_ids: List<String> = emptyList(),
    val folder_ids: List<String> = emptyList(),
)

/** How many items a restore or a purge affected. */
@Serializable
data class TrashResultDto(val documents: Int, val folders: Int)
