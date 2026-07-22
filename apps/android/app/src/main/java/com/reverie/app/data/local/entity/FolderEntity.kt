package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Cached folder/collection row (the two-level tree is reassembled in memory from parentId). */
@Entity(
    tableName = "folders",
    indices = [Index("parentId")],
)
data class FolderEntity(
    @PrimaryKey val id: String,
    val parentId: String?,
    val name: String,
    val path: String,
    val description: String?,
    val emoji: String?,
    val sortOrder: Int,
    val type: String,
    val isPrivate: Boolean,
    // Vault lock state at last fetch (see DocumentEntity.locked). Refreshed on unlock/lock.
    val locked: Boolean,
    val documentCount: Int,
    val createdAt: String,
    val updatedAt: String,
    val cachedAt: Long,
)
