package com.reverie.app.data.local

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentPhotoMetadata
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.entity.FolderEntity
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

// ---- Documents ----

fun DocumentDto.toEntity(now: Long, lastAccessedAt: Long = now): DocumentEntity = DocumentEntity(
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
    isPrivate = is_private,
    locked = locked,
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
    is_private = isPrivate,
    locked = locked,
    created_at = createdAt,
    updated_at = updatedAt,
    file_url = null,
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
    type = runCatching { FolderType.valueOf(type) }.getOrDefault(FolderType.FOLDER),
    is_private = isPrivate,
    locked = locked,
    created_at = createdAt,
    updated_at = updatedAt,
)

/** Flatten a nested tree into rows for Room (each node keeps its own document_count). */
fun List<FolderWithChildren>.flattenToEntities(now: Long): List<FolderEntity> {
    val out = mutableListOf<FolderEntity>()
    fun visit(node: FolderWithChildren) {
        out += FolderEntity(
            id = node.id,
            parentId = node.parent_id,
            name = node.name,
            path = node.path,
            description = node.description,
            emoji = node.emoji,
            sortOrder = node.sort_order,
            type = node.type.name,
            isPrivate = node.is_private,
            locked = node.locked,
            documentCount = node.document_count,
            createdAt = node.created_at,
            updatedAt = node.updated_at,
            cachedAt = now,
        )
        node.children.forEach(::visit)
    }
    forEach(::visit)
    return out
}

/** Reassemble the two-level tree from flat cached rows. */
fun List<FolderEntity>.toTree(): List<FolderWithChildren> {
    val byParent = groupBy { it.parentId }
    fun build(entity: FolderEntity): FolderWithChildren = FolderWithChildren(
        id = entity.id,
        parent_id = entity.parentId,
        name = entity.name,
        path = entity.path,
        description = entity.description,
        emoji = entity.emoji,
        sort_order = entity.sortOrder,
        type = runCatching { FolderType.valueOf(entity.type) }.getOrDefault(FolderType.FOLDER),
        is_private = entity.isPrivate,
        locked = entity.locked,
        created_at = entity.createdAt,
        updated_at = entity.updatedAt,
        document_count = entity.documentCount,
        children = (byParent[entity.id].orEmpty()).sortedBy { it.sortOrder }.map(::build),
    )
    return (byParent[null].orEmpty()).sortedBy { it.sortOrder }.map(::build)
}
