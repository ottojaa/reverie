package com.reverie.app.data.local

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentPhotoMetadata
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.entity.FolderEntity
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

// ---- Documents ----

/**
 * The Room row for this document, or null when it is private. This is the single gate that keeps
 * private documents (and their metadata) off disk: every write to the documents table goes through
 * it, so a private document can't be persisted by accident.
 */
fun DocumentDto.toEntityOrNull(now: Long, lastAccessedAt: Long = now): DocumentEntity? =
    if (is_private) null else toEntityUnchecked(now, lastAccessedAt)

/** The persistable subset of [this]: private documents are dropped (see [toEntityOrNull]). */
fun List<DocumentDto>.toCacheableEntities(now: Long): List<DocumentEntity> = mapNotNull { it.toEntityOrNull(now) }

private fun DocumentDto.toEntityUnchecked(now: Long, lastAccessedAt: Long): DocumentEntity = DocumentEntity(
    id = id,
    folderId = folder_id,
    originalFilename = original_filename,
    mimeType = mime_type,
    sizeBytes = size_bytes,
    width = width,
    height = height,
    durationSeconds = duration_seconds,
    thumbnailBlurhash = thumbnail_blurhash,
    documentCategory = document_category?.wire,
    extractedDate = extracted_date,
    ocrStatus = ocr_status.name,
    thumbnailStatus = thumbnail_status.name,
    llmStatus = llm_status.name,
    llmSummary = llm_summary,
    llmMetadataJson = llm_metadata?.toString(),
    llmProcessedAt = llm_processed_at,
    llmTokenCount = llm_token_count,
    photoMetadataJson = photo_metadata?.let { ApiJson.encodeToString(DocumentPhotoMetadata.serializer(), it) },
    takenAt = taken_at,
    city = city,
    createdAt = created_at,
    updatedAt = updated_at,
    cachedAt = now,
    lastAccessedAt = lastAccessedAt,
)

fun DocumentEntity.toDto(): DocumentDto = DocumentDto(
    id = id,
    folder_id = folderId,
    file_path = "",
    file_hash = "",
    original_filename = originalFilename,
    mime_type = mimeType,
    size_bytes = sizeBytes,
    width = width,
    height = height,
    duration_seconds = durationSeconds,
    thumbnail_blurhash = thumbnailBlurhash,
    thumbnail_paths = null,
    document_category = DocumentCategory.fromWire(documentCategory),
    extracted_date = extractedDate,
    ocr_status = parseStatus(ocrStatus),
    thumbnail_status = parseStatus(thumbnailStatus),
    llm_status = parseStatus(llmStatus),
    llm_summary = llmSummary,
    llm_metadata = llmMetadataJson?.let { parseJsonObject(it) },
    llm_processed_at = llmProcessedAt,
    llm_token_count = llmTokenCount,
    // Only non-private documents are ever cached.
    is_private = false,
    taken_at = takenAt,
    city = city,
    created_at = createdAt,
    updated_at = updatedAt,
    file_url = null,
    hls_url = null,
    thumbnail_urls = null,
    photo_metadata = photoMetadataJson?.let {
        runCatching { ApiJson.decodeFromString(DocumentPhotoMetadata.serializer(), it) }.getOrNull()
    },
)

private fun parseStatus(name: String): JobStatus =
    runCatching { JobStatus.valueOf(name) }.getOrDefault(JobStatus.PENDING)

private fun parseJsonObject(json: String): JsonObject? =
    runCatching { ApiJson.parseToJsonElement(json).jsonObject }.getOrNull()

// ---- Folders ----

fun FolderEntity.toDto(): FolderDto = FolderDto(
    id = id,
    parent_id = parentId,
    name = name,
    path = path,
    description = description,
    emoji = emoji,
    sort_order = sortOrder,
    is_private = isPrivate,
    lock_id = lockId,
    locked = locked,
    created_at = createdAt,
    updated_at = updatedAt,
)

/** Flatten a nested tree into rows for Room. */
fun List<FolderWithChildren>.flattenToEntities(now: Long): List<FolderEntity> = flatMap { node ->
    listOf(node.toEntity(now)) + node.children.flattenToEntities(now)
}

private fun FolderWithChildren.toEntity(now: Long) = FolderEntity(
    id = id,
    parentId = parent_id,
    name = name,
    path = path,
    description = description,
    emoji = emoji,
    sortOrder = sort_order,
    isPrivate = is_private,
    lockId = lock_id,
    locked = locked,
    imageCount = kind_counts.image,
    videoCount = kind_counts.video,
    fileCount = kind_counts.file,
    createdAt = created_at,
    updatedAt = updated_at,
    cachedAt = now,
)

/** Reassemble the tree from flat cached rows. */
fun List<FolderEntity>.toTree(): List<FolderWithChildren> {
    val byParent = groupBy { it.parentId }
    fun build(entity: FolderEntity): FolderWithChildren =
        entity.toNode(children = byParent[entity.id].orEmpty().sortedBy { it.sortOrder }.map(::build))
    return byParent[null].orEmpty().sortedBy { it.sortOrder }.map(::build)
}

private fun FolderEntity.toNode(children: List<FolderWithChildren>) = FolderWithChildren(
    id = id,
    parent_id = parentId,
    name = name,
    path = path,
    description = description,
    emoji = emoji,
    sort_order = sortOrder,
    is_private = isPrivate,
    lock_id = lockId,
    locked = locked,
    created_at = createdAt,
    updated_at = updatedAt,
    kind_counts = KindCountsDto(imageCount, videoCount, fileCount),
    children = children,
)
