package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Bookkeeping for an original file streamed to disk for offline viewing (LRU by lastAccessedAt). */
@Entity(tableName = "cached_files")
data class CachedFileEntity(
    @PrimaryKey val documentId: String,
    val relativePath: String,
    val sizeBytes: Long,
    val mimeType: String,
    val lastAccessedAt: Long,
)
