package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Cached folder row; the tree, nested to any depth, is reassembled in memory from parentId. */
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
    val isPrivate: Boolean,
    // The outermost private folder among this one and those above it; null for a public folder.
    val lockId: String?,
    // Lock state at last fetch; every tree refresh (e.g. after an unlock) overwrites it.
    val locked: Boolean,
    // Documents here and beneath, by kind (see FolderWithChildren.kind_counts).
    val imageCount: Int,
    val videoCount: Int,
    val fileCount: Int,
    val createdAt: String,
    val updatedAt: String,
    val cachedAt: Long,
)
