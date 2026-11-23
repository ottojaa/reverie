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
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BrowseUiState(
    /** The open tab's documents, in that tab's order. */
    val documents: List<DocumentDto> = emptyList(),
    val tab: BrowseTab = BrowseTab.ALL,
    /** Every tab's documents, so the pager can show a neighbour while it is swiped in. */
    val tabs: Map<BrowseTab, TabDocuments> = emptyMap(),
    /** The open tab's server total, for the subtitle ("168 photos"). */
    val total: Int = 0,
    val folder: FolderDto? = null,
    /** False until the last-used tab has been read, so the pager opens on the right page. */
    val ready: Boolean = false,
    val isRefreshing: Boolean = false,
    val isOffline: Boolean = false,
    val error: String? = null,
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
    val error: String? = null,
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
    private val settingsRepository: SettingsRepository,
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
    fun prepareSequence() = sequenceHolder.set(tabsModel.prepareSequence())

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

    // One Room observer for the whole screen: the four tabs and the unfinished-document watcher share it.
    private val cache = documentRepository.observeDocuments(folderId)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val tabsModel = BrowseTabsModel(
        scope = viewModelScope,
        cache = cache,
        fetchPage = { kind, offset -> documentRepository.refresh(folderId, PAGE_SIZE, offset, kind) },
        loadSavedTab = { BrowseTab.fromSaved(settingsRepository.settings.first().lastBrowseTab) },
        saveTab = { settingsRepository.setLastBrowseTab(it.name) },
        onFirstPageFailed = ::onRefreshFailed,
        sharing = SharingStarted.Eagerly,
    )

    val uiState: StateFlow<BrowseUiState> = combine(
        tabsModel.state,
        if (folderId != null) folderRepository.observeFolder(folderId) else flowOf(null),
        connectivity.isOnline,
        control,
        processingTracker.count,
    ) { tabs, folder, online, ctrl, processing ->
        val current = tabs.current
        BrowseUiState(
            documents = current.documents,
            tab = tabs.tab,
            tabs = tabs.tabs,
            total = current.total,
            folder = folder,
            ready = tabs.ready,
            isRefreshing = tabs.isRefreshing,
            isOffline = !online,
            error = ctrl.error,
            processingCount = processing,
            selectedIds = tabs.selectedIds,
            lockedFolderId = ctrl.lockedFolderId,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BrowseUiState())

    init {
        processingTracker.refresh()
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
            val unfinished = cache
                .map { docs -> docs.filter(DocumentDto::isStillProcessing).map(DocumentDto::id).toSet() }
                .distinctUntilChanged()
            processingTracker.keepLive(unfinished)
        }
    }

    /** Opens [tab]. Its first page is fetched the first time it is shown; a later visit reuses what it loaded. */
    fun selectTab(tab: BrowseTab) {
        control.update { it.copy(error = null) }
        tabsModel.selectTab(tab)
    }

    fun refresh(initial: Boolean = false) {
        processingTracker.refresh()
        control.update { it.copy(error = null, lockedFolderId = null) }
        tabsModel.refresh(initial)
    }

    private fun onRefreshFailed(throwable: Throwable) {
        val lockedId = (throwable as? ReverieApiException)?.lockedFolderId()
        // A closed lock is not an error: ask for the password and retry (see [unlocker]).
        if (lockedId != null) unlocker.request(lockedId, uiState.value.folder?.name)
        control.update {
            it.copy(
                lockedFolderId = lockedId,
                error = if (lockedId == null && connectivity.currentlyOnline()) messageFor(throwable) else null,
            )
        }
    }

    /** Fetches the next page of the open tab (or of [tab], for a neighbour the pager keeps). */
    fun loadMore(tab: BrowseTab = uiState.value.tab) = tabsModel.loadMore(tab)

    fun enterSelection(id: String) = tabsModel.enterSelection(id)

    fun toggleSelect(id: String) = tabsModel.toggleSelect(id)

    fun clearSelection() = tabsModel.clearSelection()

    fun deleteSelected() {
        val ids = tabsModel.selectedIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            runCatching { documentRepository.delete(ids) }
            clearSelection()
            // The subtitle counts what the server holds for the tab, so read its first page again.
            refresh(initial = true)
        }
    }

    /**
     * Resolve fresh signed URLs for the selected documents (the cached copies strip file_url) and
     * hand them to [onTargets] to enqueue — the caller owns the platform DownloadManager.
     */
    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) {
        val ids = tabsModel.selectedIds.toList()
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
