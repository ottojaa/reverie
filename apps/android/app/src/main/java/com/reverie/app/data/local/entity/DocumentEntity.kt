package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Cached document row. Mirrors DocumentDto minus the signed, short-lived `file_url` /
 * `thumbnail_urls` (deliberately never persisted — they expire). Complex sub-objects are
 * stored as JSON strings. `lastAccessedAt` drives retention/eviction.
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
    val isPrivate: Boolean,
    // Vault lock state at last fetch. Refreshed from the server on unlock/lock; stale-safe
    // offline (locked content is never cached, so a stale `true` just keeps it locked).
    val locked: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val cachedAt: Long,
    val lastAccessedAt: Long,
)
