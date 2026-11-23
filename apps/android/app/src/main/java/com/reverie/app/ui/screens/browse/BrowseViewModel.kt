package com.reverie.app.ui.screens.browse

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.ImageLoader
import coil.request.ImageRequest
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.isStillProcessing
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.processing.ProcessingTracker
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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
    /** Set when the server refused the list with FOLDER_LOCKED: the lock that must be opened first. */
    val lockedFolderId: String? = null,
) {
    val inSelectionMode: Boolean get() = selectedIds.isNotEmpty()
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
    val lockedFolderId: String? = null,
)

@HiltViewModel
class BrowseViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val documentRepository: DocumentRepository,
    private val folderRepository: FolderRepository,
    private val vaultRepository: VaultRepository,
    private val processingTracker: ProcessingTracker,
    private val connectivity: ConnectivityMonitor,
    private val serverUrlProvider: ServerUrlProvider,
    private val sequenceHolder: DocumentSequenceHolder,
    private val imageLoader: ImageLoader,
    @ApplicationContext private val appContext: Context,
    settingsRepository: SettingsRepository,
) : ViewModel() {

    val folderId: String? = savedStateHandle["folderId"]

    /** How the Files grid arranges photos (user setting). */
    val gridLayoutMode: StateFlow<GridLayoutMode> = settingsRepository.settings
        .map { it.gridLayoutMode }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), GridLayoutMode.MOSAIC)

    /** How often the mosaic grid promotes a photo to a larger tile (user setting). */
    val mosaicFeatureEvery: StateFlow<Int> = settingsRepository.settings
        .map { it.mosaicFeatureEvery }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 3)

    /** The document the viewer is showing, so the grid can scroll it into view on return. */
    val focusedDocumentId: StateFlow<String?> get() = sequenceHolder.focused

    /** Consume the focus signal once the grid has scrolled to it, so later list updates don't re-scroll. */
    fun clearFocusedDocument() = sequenceHolder.setFocused(null)

    /**
     * Hand this grid's ordered documents to the viewer so it can swipe through them. Call right
     * before navigating into a document. [ids] stays live so the pager grows as we [loadMore].
     */
    fun prepareSequence() = sequenceHolder.set(
        DocumentSequence(
            initialIds = uiState.value.documents.map(DocumentDto::id),
            ids = uiState.map { s -> s.documents.map(DocumentDto::id) }.distinctUntilChanged(),
            loadMore = ::loadMore,
        ),
    )

    /**
     * Warm the tapped document ahead of the dive so the viewer opens on the sharp image instead of the
     * stretched grid thumbnail: resolve (and cache app-wide) the signed URL now, and for images kick
     * off the full-res download into Coil's cache — both overlap the ~300ms open transition rather
     * than starting after it.
     */
    fun prefetch(document: DocumentDto) {
        // Private originals must not land in Coil's disk cache, and the viewer fetches them itself.
        if (document.is_private) return
        viewModelScope.launch {
            val raw = documentRepository.fileUrl(document.id) ?: return@launch
            if (document.mime_type.startsWith("image/")) {
                imageLoader.enqueue(ImageRequest.Builder(appContext).data(absolute(raw)).build())
            }
        }
    }

    /** Password prompt for a locked folder; a successful unlock re-fetches the list and the tree. */
    val unlocker = FolderUnlocker(vaultRepository, viewModelScope) {
        refresh()
        runCatching { folderRepository.refresh() }
    }

    private val control = MutableStateFlow(BrowseControl())

    val uiState: StateFlow<BrowseUiState> = combine(
        documentRepository.observeDocuments(folderId),
        if (folderId != null) folderRepository.observeFolder(folderId) else flowOf(null),
        connectivity.isOnline,
        control,
        processingTracker.count,
    ) { docs, folder, online, ctrl, processing ->
        BrowseUiState(
            documents = docs,
            folder = folder,
            isLoading = ctrl.isLoading && docs.isEmpty(),
            isRefreshing = ctrl.isRefreshing,
            isOffline = !online,
            error = ctrl.error,
            hasMore = docs.size < ctrl.total,
            processingCount = processing,
            selectedIds = ctrl.selectedIds,
            lockedFolderId = ctrl.lockedFolderId,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowseUiState(isLoading = true))

    init {
        refresh(initial = true)
        if (folderId != null) {
            viewModelScope.launch { runCatching { folderRepository.refresh() } }
        }
        keepUnfinishedDocumentsLive()
    }

    /**
     * The tracker listens to the library's processing documents on its own; this adds what this
     * grid shows that it might not cover (private-folder documents, a long backlog), so
     * thumbnails still appear as they finish.
     */
    private fun keepUnfinishedDocumentsLive() {
        viewModelScope.launch {
            val unfinished = documentRepository.observeDocuments(folderId)
                .map { docs -> docs.filter(DocumentDto::isStillProcessing).map(DocumentDto::id).toSet() }
                .distinctUntilChanged()
            processingTracker.keepLive(unfinished)
        }
    }

    fun refresh(initial: Boolean = false) {
        processingTracker.refresh()
        viewModelScope.launch {
            control.update { it.copy(isLoading = initial, isRefreshing = !initial, error = null, lockedFolderId = null) }
            runCatching { documentRepository.refresh(folderId, PAGE_SIZE, 0) }
                .onSuccess { page ->
                    control.update { it.copy(total = page.total, loaded = page.loaded, isLoading = false, isRefreshing = false, error = null) }
                }
                .onFailure { throwable -> onRefreshFailed(throwable) }
        }
    }

    private fun onRefreshFailed(throwable: Throwable) {
        val lockedId = (throwable as? ReverieApiException)?.lockedFolderId()
        // A closed lock is not an error: ask for the password and retry (see [unlocker]).
        if (lockedId != null) unlocker.request(lockedId, uiState.value.folder?.name)
        control.update {
            it.copy(
                isLoading = false,
                isRefreshing = false,
                lockedFolderId = lockedId,
                error = if (lockedId == null && connectivity.currentlyOnline()) messageFor(throwable) else null,
            )
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

    private fun messageFor(throwable: Throwable): String =
        (throwable as? ReverieApiException)?.userMessage() ?: "Couldn't load documents."

    private companion object {
        const val PAGE_SIZE = 30
    }
}
