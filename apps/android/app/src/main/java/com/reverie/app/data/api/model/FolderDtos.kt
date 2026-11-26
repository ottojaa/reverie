package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

@Serializable
data class FolderDto(
    val id: String,
    val parent_id: String? = null,
    val name: String,
    val path: String,
    val description: String? = null,
    val emoji: String? = null,
    val sort_order: Int,
    // Deprecated by the server (it only says whether the folder is at the top level) and read nowhere here.
    val type: FolderType? = null,
    val is_private: Boolean,
    // The outermost private folder among this one and those above it: what unlocking opens to reach it.
    // Null for a public folder.
    val lock_id: String? = null,
    // True when effectively private AND closed AND the account has a password (otherwise a private
    // folder opens freely). A locked folder arrives without children.
    val locked: Boolean = false,
    val created_at: String,
    val updated_at: String,
)

/** Recursive tree node from GET /folders/tree; folders nest to any depth. */
@Serializable
data class FolderWithChildren(
    val id: String,
    val parent_id: String? = null,
    val name: String,
    val path: String,
    val description: String? = null,
    val emoji: String? = null,
    val sort_order: Int,
    val type: FolderType? = null,
    val is_private: Boolean,
    val lock_id: String? = null,
    val locked: Boolean = false,
    val created_at: String,
    val updated_at: String,
    val children: List<FolderWithChildren> = emptyList(),
    // Documents in this folder and everything beneath it, leaving out what sits behind a further lock; all zero
    // while locked.
    val kind_counts: KindCountsDto = KindCountsDto(),
    // Null for locked nodes and every private folder (open or not).
    val cover: FolderCoverDto? = null,
)

/** How many documents of each kind a folder holds. */
@Serializable
data class KindCountsDto(val image: Int = 0, val video: Int = 0, val file: Int = 0) {
    val total: Int get() = image + video + file
}

/** One document shown in a folder's cover mosaic. */
@Serializable
data class FolderCoverTileDto(
    val document_id: String,
    val mime_type: String,
    val original_filename: String,
    val thumbnail_blurhash: String? = null,
) {
    val hasRenderedThumbnail: Boolean get() = !thumbnail_blurhash.isNullOrBlank()
}

/** A folder's cover from GET /folders/tree: up to four tiles plus what the folder holds per kind. */
@Serializable
data class FolderCoverDto(
    val tiles: List<FolderCoverTileDto> = emptyList(),
    val summary: DocumentSummaryDto = DocumentSummaryDto(),
)

@Serializable
data class CreateFolderRequest(
    val name: String,
    /** Null creates the folder at the top level. */
    val parent_id: String? = null,
    val description: String? = null,
    val emoji: String? = null,
)

/** Changes a folder's own fields. Moving it is [com.reverie.app.data.api.FoldersApi.move]. */
@Serializable
data class UpdateFolderRequest(
    val name: String? = null,
    val description: String? = null,
    val emoji: String? = null,
    val is_private: Boolean? = null,
)

@Serializable
data class ReorderFolderUpdate(val id: String, val sort_order: Int)

@Serializable
data class ReorderFoldersRequest(val updates: List<ReorderFolderUpdate>)
