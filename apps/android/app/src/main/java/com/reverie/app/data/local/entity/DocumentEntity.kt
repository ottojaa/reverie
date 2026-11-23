package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Cached document row. Mirrors DocumentDto minus the signed, short-lived `file_url` /
 * `thumbnail_urls` (deliberately never persisted — they expire). Complex sub-objects are
 * stored as JSON strings. `lastAccessedAt` drives retention/eviction.
 *
 * Documents in private folders are NEVER stored here (see [toEntityOrNull]); they live only in
 * the in-memory PrivateDocumentStore, so there is deliberately no privacy column.
 */
@Entity(
    tableName = "documents",
    indices = [Index("folderId"), Index("lastAccessedAt"), Index("createdAt")],
)
data class DocumentEntity(
    @PrimaryKey val id: String,
    val folderId: String?,
    val originalFilename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val width: Int?,
    val height: Int?,
    val durationSeconds: Double?,
    val thumbnailBlurhash: String?,
    val documentCategory: String?,
    val extractedDate: String?,
    val ocrStatus: String,
    val thumbnailStatus: String,
    val llmStatus: String,
    val llmSummary: String?,
    val llmMetadataJson: String?,
    val llmProcessedAt: String?,
    val llmTokenCount: Long?,
    val photoMetadataJson: String?,
    // Date taken as the server sends it (a local clock reading stored as if UTC); null when unknown.
    val takenAt: String?,
    val createdAt: String,
    val updatedAt: String,
    val cachedAt: Long,
    val lastAccessedAt: Long,
)
