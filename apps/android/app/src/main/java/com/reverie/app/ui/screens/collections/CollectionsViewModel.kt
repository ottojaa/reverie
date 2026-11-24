package com.reverie.app.ui.screens.collections

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.model.AuthState
import com.reverie.app.ui.components.FolderUnlocker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
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
    /** Cover per folder id, from the last tree fetch. Empty until one succeeds (and offline after a restart). */
    val covers: Map<String, FolderCoverDto> = emptyMap(),
    /** The header's counts, over the whole tree: the filter does not change them. */
    /** Folders per collection id over the whole tree: the filter only trims the rows, not the "N folders" line. */
    val folderCounts: Map<String, Int> = emptyMap(),
    val collectionCount: Int = 0,
    val folderCount: Int = 0,
    val isRefreshing: Boolean = false,
    val collapsedIds: Set<String> = emptySet(),
    val filter: String = "",
    val storageUsed: Long = 0,
    val storageQuota: Long = 0,
    val isOffline: Boolean = false,
    /** A message to show in a dialog until dismissed (e.g. the no-password hint). */
    val notice: String? = null,
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
    private val notice = MutableStateFlow<String?>(null)
    private val refreshing = MutableStateFlow(false)

    // What to do once the open prompt succeeds: open the folder, or redo the refused change.
    private var afterUnlock: (() -> Unit)? = null

    private val _openFolder = MutableSharedFlow<String>(extraBufferCapacity = 1)

    /** Folder ids to navigate into: emitted after a locked folder has been unlocked. */
    val openFolder: SharedFlow<String> = _openFolder.asSharedFlow()

    /** Password prompt for a locked row; a successful unlock refetches the tree, then runs [afterUnlock]. */
    val unlocker = FolderUnlocker(vaultRepository, viewModelScope) {
        runCatching { folderRepository.refresh() }
        afterUnlock?.invoke()
        afterUnlock = null
    }

    private val chrome = combine(collapsed, filter, notice, refreshing) { c, f, n, r -> Chrome(c, f, n, r) }

    val uiState: StateFlow<CollectionsUiState> = combine(
        folderRepository.observeTree(),
        folderRepository.covers,
        authRepository.authState,
        connectivity.isOnline,
        chrome,
    ) { tree, covers, auth, online, chrome ->
        val user = (auth as? AuthState.Authenticated)?.user
        CollectionsUiState(
            tree = filterTree(tree, chrome.filter),
            covers = covers,
            folderCounts = tree.associate { it.id to it.children.size },
            collectionCount = tree.count { it.type == FolderType.COLLECTION },
            folderCount = countFolders(tree),
            isRefreshing = chrome.refreshing,
            collapsedIds = chrome.collapsed,
            filter = chrome.filter,
            storageUsed = user?.storage_used_bytes ?: 0,
            storageQuota = user?.storage_quota_bytes ?: 0,
            isOffline = !online,
            notice = chrome.notice,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionsUiState())

    private data class Chrome(val collapsed: Set<String>, val filter: String, val notice: String?, val refreshing: Boolean)

    /** Quietly refetch the tree (on opening the tab and on returning to it); a failure leaves the cached one showing. */
    fun refresh() {
        viewModelScope.launch { runCatching { folderRepository.refresh() } }
    }

    /** The pull-to-refresh gesture: the same fetch, with the spinner. */
    fun pullToRefresh() {
        if (refreshing.value) return
        viewModelScope.launch {
            refreshing.value = true
            runCatching { folderRepository.refresh() }
            refreshing.value = false
        }
    }

    /**
     * A locked row was tapped: ask for its password, then open it. A folder is navigated into; a
     * collection just expands to show the folders the unlock revealed.
     */
    fun unlock(node: FolderWithChildren) {
        afterUnlock = {
            if (node.type == FolderType.COLLECTION) collapsed.update { it - node.id }
            else _openFolder.tryEmit(node.id)
        }
        unlocker.request(node.id, node.name)
    }

    fun dismissUnlock() {
        afterUnlock = null
        unlocker.dismiss()
    }

    fun dismissNotice() {
        notice.value = null
    }

    fun toggleExpand(id: String) = collapsed.update {
        if (id in it) it - id else it + id
    }

    fun setFilter(text: String) {
        filter.value = text
    }

    private fun countFolders(tree: List<FolderWithChildren>): Int =
        tree.sumOf { node -> (if (node.type == FolderType.FOLDER) 1 else 0) + countFolders(node.children) }

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
            }.onSuccess { if (isPrivate) warnIfNoPassword() }
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

    /**
     * Make a folder or collection private or public. Making it public needs its lock open, so a
     * FOLDER_LOCKED refusal asks for the password and then repeats the change.
     */
    fun setPrivate(id: String, name: String, isPrivate: Boolean) {
        viewModelScope.launch {
            runCatching { folderRepository.update(id, UpdateFolderRequest(is_private = isPrivate)) }
                .onSuccess { if (isPrivate) warnIfNoPassword() }
                .onFailure { onPrivacyChangeFailed(it, id, name, isPrivate) }
        }
    }

    private fun onPrivacyChangeFailed(throwable: Throwable, id: String, name: String, isPrivate: Boolean) {
        val lockedId = (throwable as? ReverieApiException)?.lockedFolderId() ?: return
        afterUnlock = { setPrivate(id, name, isPrivate) }
        unlocker.request(lockedId, name)
    }

    /** Private folders only lock for accounts that have a password; tell the user when theirs doesn't. */
    private suspend fun warnIfNoPassword() {
        if (vaultRepository.hasPassword() != false) return
        notice.value = NO_PASSWORD_NOTICE
    }

    fun delete(id: String) {
        viewModelScope.launch { runCatching { folderRepository.delete(id) } }
    }

    private companion object {
        const val NO_PASSWORD_NOTICE =
            "Private folders only lock once your account has a password. Set one in Settings on the web app."
    }
}
