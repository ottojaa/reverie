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
    val type: FolderType,
    val is_private: Boolean,
    // True when effectively private AND the vault is locked for this session. See VaultRepository.
    val locked: Boolean = false,
    val created_at: String,
    val updated_at: String,
)

/** Recursive tree node from GET /folders/tree. */
@Serializable
data class FolderWithChildren(
    val id: String,
    val parent_id: String? = null,
    val name: String,
    val path: String,
    val description: String? = null,
    val emoji: String? = null,
    val sort_order: Int,
    val type: FolderType,
    val is_private: Boolean,
    // True when effectively private AND the vault is locked for this session. See VaultRepository.
    val locked: Boolean = false,
    val created_at: String,
    val updated_at: String,
    val children: List<FolderWithChildren> = emptyList(),
    val document_count: Int = 0,
)

@Serializable
data class CreateFolderRequest(
    val name: String,
    val parent_id: String? = null,
    val description: String? = null,
    val emoji: String? = null,
    val type: FolderType? = null,
)

@Serializable
data class UpdateFolderRequest(
    val name: String? = null,
    val description: String? = null,
    val emoji: String? = null,
    val parent_id: String? = null,
    val is_private: Boolean? = null,
)

@Serializable
data class ReorderFolderUpdate(val id: String, val sort_order: Int)

@Serializable
data class ReorderFoldersRequest(val updates: List<ReorderFolderUpdate>)
