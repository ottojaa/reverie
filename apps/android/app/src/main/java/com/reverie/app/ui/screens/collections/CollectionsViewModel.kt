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
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CollectionsUiState(
    val tree: List<FolderWithChildren> = emptyList(),
    val collapsedIds: Set<String> = emptySet(),
    val filter: String = "",
    val storageUsed: Long = 0,
    val storageQuota: Long = 0,
    val vault: VaultStatus? = null,
    val isOffline: Boolean = false,
) {
    // While filtering, everything is force-expanded so matches are visible.
    fun isExpanded(id: String): Boolean = filter.isNotBlank() || id !in collapsedIds
}

@HiltViewModel
class CollectionsViewModel @Inject constructor(
    private val folderRepository: FolderRepository,
    private val vaultRepository: VaultRepository,
    authRepository: AuthRepository,
    connectivity: ConnectivityMonitor,
) : ViewModel() {

    private val collapsed = MutableStateFlow<Set<String>>(emptySet())
    private val filter = MutableStateFlow("")

    val uiState: StateFlow<CollectionsUiState> = combine(
        folderRepository.observeTree(),
        authRepository.authState,
        vaultRepository.status,
        connectivity.isOnline,
        // combine tops out at 5 flows, so fold expansion + filter into one.
        combine(collapsed, filter) { c, f -> c to f },
    ) { tree, auth, vault, online, (collapsedIds, filterText) ->
        val user = (auth as? AuthState.Authenticated)?.user
        CollectionsUiState(
            tree = filterTree(tree, filterText),
            collapsedIds = collapsedIds,
            filter = filterText,
            storageUsed = user?.storage_used_bytes ?: 0,
            storageQuota = user?.storage_quota_bytes ?: 0,
            vault = vault,
            isOffline = !online,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionsUiState())

    init {
        refresh()
        observeVaultChanges()
    }

    fun refresh() {
        viewModelScope.launch { runCatching { folderRepository.refresh() } }
        viewModelScope.launch { vaultRepository.refresh() }
    }

    /** Re-fetch the tree whenever the vault unlocks/re-locks so each folder's `locked` flag flips. */
    private fun observeVaultChanges() {
        viewModelScope.launch {
            vaultRepository.status
                .map { it?.unlocked == true }
                .distinctUntilChanged()
                .drop(1)
                .collect { runCatching { folderRepository.refresh() } }
        }
    }

    fun toggleExpand(id: String) = collapsed.update {
        if (id in it) it - id else it + id
    }

    fun setFilter(text: String) {
        filter.value = text
    }

    private fun filterTree(tree: List<FolderWithChildren>, query: String): List<FolderWithChildren> {
        if (query.isBlank()) return tree
        return tree.mapNotNull { node ->
            if (node.name.contains(query, ignoreCase = true)) return@mapNotNull node
            val children = node.children.filter { it.name.contains(query, ignoreCase = true) }
            if (children.isEmpty()) null else node.copy(children = children)
        }
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
}
