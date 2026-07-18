package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** An upload batch, keyed by the client-generated session_id that routes Socket.IO events. */
@Entity(tableName = "upload_tasks")
data class UploadTaskEntity(
    @PrimaryKey val sessionId: String,
    val folderId: String,
    val conflictStrategy: String?,
    val status: String,
    val createdAt: Long,
)

/** One file within an upload batch. Source of truth for per-file UI progress; survives death. */
@Entity(
    tableName = "upload_items",
    indices = [Index("sessionId")],
)
data class UploadItemEntity(
    @PrimaryKey val id: String,
    val sessionId: String,
    val stagedPath: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val status: String,
    val progress: Int,
    val errorMessage: String?,
    val documentId: String?,
)
