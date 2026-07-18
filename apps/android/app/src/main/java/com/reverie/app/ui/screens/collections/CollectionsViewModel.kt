package com.reverie.app.ui.screens.collections

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.model.AuthState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CollectionsUiState(
    val tree: List<FolderWithChildren> = emptyList(),
    val collapsedIds: Set<String> = emptySet(),
    val storageUsed: Long = 0,
    val storageQuota: Long = 0,
    val vault: VaultStatus? = null,
    val isOffline: Boolean = false,
) {
    fun isExpanded(id: String): Boolean = id !in collapsedIds
}

@HiltViewModel
class CollectionsViewModel @Inject constructor(
    private val folderRepository: FolderRepository,
    private val vaultRepository: VaultRepository,
    authRepository: AuthRepository,
    connectivity: ConnectivityMonitor,
) : ViewModel() {

    private val collapsed = MutableStateFlow<Set<String>>(emptySet())

    val uiState: StateFlow<CollectionsUiState> = combine(
        folderRepository.observeTree(),
        authRepository.authState,
        vaultRepository.status,
        connectivity.isOnline,
        collapsed,
    ) { tree, auth, vault, online, collapsedIds ->
        val user = (auth as? AuthState.Authenticated)?.user
        CollectionsUiState(
            tree = tree,
            collapsedIds = collapsedIds,
            storageUsed = user?.storage_used_bytes ?: 0,
            storageQuota = user?.storage_quota_bytes ?: 0,
            vault = vault,
            isOffline = !online,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionsUiState())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { runCatching { folderRepository.refresh() } }
        viewModelScope.launch { vaultRepository.refresh() }
    }

    fun toggleExpand(id: String) = collapsed.update {
        if (id in it) it - id else it + id
    }

    fun createCollection(name: String, emoji: String?, description: String?, isPrivate: Boolean) =
        create(name, emoji, description, isPrivate, parentId = null, type = FolderType.COLLECTION)

    fun createFolder(parentId: String, name: String, emoji: String?, description: String?, isPrivate: Boolean) =
        create(name, emoji, description, isPrivate, parentId = parentId, type = FolderType.FOLDER)

    private fun create(name: String, emoji: String?, description: String?, isPrivate: Boolean, parentId: String?, type: FolderType) {
        viewModelScope.launch {
            runCatching {
                val created = folderRepository.create(
                    CreateFolderRequest(
                        name = name,
                        parent_id = parentId,
                        description = description?.ifBlank { null },
                        emoji = emoji?.ifBlank { null },
                        type = type,
                    ),
                )
                if (isPrivate) folderRepository.update(created.id, UpdateFolderRequest(is_private = true))
            }
        }
    }

    fun edit(id: String, name: String, emoji: String?, description: String?) {
        viewModelScope.launch {
            runCatching {
                folderRepository.update(
                    id,
                    UpdateFolderRequest(name = name, emoji = emoji ?: "", description = description ?: ""),
                )
            }
        }
    }

    fun setPrivate(id: String, isPrivate: Boolean) {
        viewModelScope.launch { runCatching { folderRepository.update(id, UpdateFolderRequest(is_private = isPrivate)) } }
    }

    fun delete(id: String) {
        viewModelScope.launch { runCatching { folderRepository.delete(id) } }
    }

    fun unlockVault(password: String, onResult: (Boolean) -> Unit) {
        viewModelScope.launch { onResult(vaultRepository.unlock(password).isSuccess) }
    }

    fun lockVault() {
        viewModelScope.launch { vaultRepository.lock() }
    }

    fun setHidePrivate(hide: Boolean) {
        viewModelScope.launch { vaultRepository.setHidePrivate(hide) }
    }
}
