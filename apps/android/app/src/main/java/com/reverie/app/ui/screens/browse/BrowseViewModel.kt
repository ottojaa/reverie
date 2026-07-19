package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.JobEventType
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BrowseUiState(
    val documents: List<DocumentDto> = emptyList(),
    val folder: FolderDto? = null,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isOffline: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false,
    val processingCount: Int = 0,
    val selectedIds: Set<String> = emptySet(),
) {
    val inSelectionMode: Boolean get() = selectedIds.isNotEmpty()
    val allSelectedPrivate: Boolean
        get() = selectedIds.isNotEmpty() && documents.filter { it.id in selectedIds }.all { it.is_private }
}

/** A resolved, ready-to-enqueue download: a signed file URL + the name to save it under. */
data class DownloadTarget(val url: String, val filename: String)

private data class BrowseControl(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isLoadingMore: Boolean = false,
    val total: Int = 0,
    val loaded: Int = 0,
    val error: String? = null,
    val selectedIds: Set<String> = emptySet(),
)

@HiltViewModel
class BrowseViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val documentRepository: DocumentRepository,
    private val folderRepository: FolderRepository,
    private val settingsRepository: SettingsRepository,
    private val realtimeManager: RealtimeManager,
    private val connectivity: ConnectivityMonitor,
    private val serverUrlProvider: ServerUrlProvider,
) : ViewModel() {

    val folderId: String? = savedStateHandle["folderId"]

    private val control = MutableStateFlow(BrowseControl())

    /** User-chosen Files grid column count (1–4). */
    val gridColumns: StateFlow<Int> = settingsRepository.settings
        .map { it.gridColumns }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 3)

    // Open realtime subscriptions for documents whose thumbnail is still generating (keyed by id).
    private val thumbnailSubscriptions = mutableMapOf<String, AutoCloseable>()

    val uiState: StateFlow<BrowseUiState> = combine(
        documentRepository.observeDocuments(folderId),
        if (folderId != null) folderRepository.observeFolder(folderId) else flowOf(null),
        connectivity.isOnline,
        control,
    ) { docs, folder, online, ctrl ->
        BrowseUiState(
            documents = docs,
            folder = folder,
            isLoading = ctrl.isLoading && docs.isEmpty(),
            isRefreshing = ctrl.isRefreshing,
            isOffline = !online,
            error = ctrl.error,
            hasMore = docs.size < ctrl.total,
            processingCount = docs.count { !isFullyProcessed(it) },
            selectedIds = ctrl.selectedIds,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowseUiState(isLoading = true))

    init {
        refresh(initial = true)
        if (folderId != null) {
            viewModelScope.launch { runCatching { folderRepository.refresh() } }
        }
        observePendingThumbnails()
        collectThumbnailJobEvents()
    }

    fun setGridColumns(columns: Int) {
        viewModelScope.launch { settingsRepository.setGridColumns(columns) }
    }

    /**
     * Keep a realtime subscription open for every document whose thumbnail is still being generated.
     * Video thumbnails (ffmpeg frame extraction) finish well after the upload HTTP call returns, so
     * without this the grid would keep showing the placeholder until a manual refresh.
     */
    private fun observePendingThumbnails() {
        viewModelScope.launch {
            documentRepository.observeDocuments(folderId)
                .map { docs -> docs.filter { !it.thumbnail_status.isTerminal }.map { it.id }.toSet() }
                .distinctUntilChanged()
                .collect { pending ->
                    (pending - thumbnailSubscriptions.keys).forEach { id ->
                        thumbnailSubscriptions[id] = realtimeManager.subscribeDocument(id)
                    }
                    (thumbnailSubscriptions.keys - pending).forEach { id ->
                        thumbnailSubscriptions.remove(id)?.close()
                    }
                }
        }
    }

    /** Refetch a document (updating its cached status) when its thumbnail/processing job settles. */
    private fun collectThumbnailJobEvents() {
        viewModelScope.launch {
            realtimeManager.events.collect { event ->
                val id = event.document_id ?: return@collect
                if (id !in thumbnailSubscriptions) return@collect
                if (event.type == JobEventType.COMPLETE || event.type == JobEventType.FAILED) {
                    runCatching { documentRepository.fetchDocument(id) }
                }
            }
        }
    }

    override fun onCleared() {
        thumbnailSubscriptions.values.forEach { it.close() }
        thumbnailSubscriptions.clear()
    }

    fun refresh(initial: Boolean = false) {
        viewModelScope.launch {
            control.update { it.copy(isLoading = initial, isRefreshing = !initial, error = null) }
            runCatching { documentRepository.refresh(folderId, PAGE_SIZE, 0) }
                .onSuccess { page ->
                    control.update { it.copy(total = page.total, loaded = page.loaded, isLoading = false, isRefreshing = false, error = null) }
                }
                .onFailure { throwable ->
                    control.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            error = if (connectivity.currentlyOnline()) messageFor(throwable) else null,
                        )
                    }
                }
        }
    }

    fun loadMore() {
        val current = control.value
        if (current.isLoadingMore || current.loaded >= current.total) return
        viewModelScope.launch {
            control.update { it.copy(isLoadingMore = true) }
            runCatching { documentRepository.refresh(folderId, PAGE_SIZE, current.loaded) }
                .onSuccess { page -> control.update { it.copy(loaded = page.loaded, total = page.total, isLoadingMore = false) } }
                .onFailure { control.update { it.copy(isLoadingMore = false) } }
        }
    }

    fun enterSelection(id: String) = control.update { it.copy(selectedIds = setOf(id)) }

    fun toggleSelect(id: String) = control.update {
        val next = it.selectedIds.toMutableSet()
        if (!next.add(id)) next.remove(id)
        it.copy(selectedIds = next)
    }

    fun clearSelection() = control.update { it.copy(selectedIds = emptySet()) }

    fun deleteSelected() {
        val ids = control.value.selectedIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            runCatching { documentRepository.delete(ids) }
            clearSelection()
        }
    }

    fun togglePrivateSelected() {
        val ids = control.value.selectedIds.toList()
        if (ids.isEmpty()) return
        val target = !uiState.value.allSelectedPrivate
        viewModelScope.launch {
            runCatching { documentRepository.setPrivacy(ids, target) }
            clearSelection()
        }
    }

    /**
     * Resolve fresh signed URLs for the selected documents (the cached copies strip file_url) and
     * hand them to [onTargets] to enqueue — the caller owns the platform DownloadManager.
     */
    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) {
        val ids = control.value.selectedIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            val targets = ids.mapNotNull { id ->
                runCatching {
                    val doc = documentRepository.fetchDocument(id)
                    doc.file_url?.let { DownloadTarget(absolute(it), doc.original_filename) }
                }.getOrNull()
            }
            clearSelection()
            onTargets(targets)
        }
    }

    private fun absolute(url: String): String =
        if (url.startsWith("http")) url else serverUrlProvider.current().removeSuffix("/") + url

    private fun isFullyProcessed(doc: DocumentDto): Boolean =
        doc.ocr_status.isTerminal && doc.thumbnail_status.isTerminal && doc.llm_status.isTerminal

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Couldn't load documents."

    private companion object {
        const val PAGE_SIZE = 30
    }
}
