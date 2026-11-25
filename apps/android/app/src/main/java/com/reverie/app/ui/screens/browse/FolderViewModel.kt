package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A folder's page: its documents by kind, as cards or as a list. */
@HiltViewModel
class FolderViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val deps: BrowseDeps,
) : ViewModel(), DocumentListHandler {

    val folderId: String = checkNotNull(savedStateHandle["folderId"]) { "A folder page needs a folder id" }

    // One Room observer for the whole screen: the chips' feeds and the unfinished-document watcher share it.
    private val cache = deps.documents.observeDocuments(DocumentScope.Folder(folderId))
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = folderId,
        deps = deps,
        selection = { model.selectedIds },
        clearSelection = { model.clearSelection() },
        refresh = { model.refresh() },
        onContentChanged = { model.contentChanged() },
    )

    private val model: FolderModel = FolderModel(
        scope = viewModelScope,
        cache = cache,
        summary = deps.documents.summary(DocumentScope.Folder(folderId)),
        fetchPage = { kind, offset ->
            val filter = kind?.let(DocumentFilter::of) ?: DocumentFilter.ALL
            deps.documents.refresh(DocumentScope.Folder(folderId), BROWSE_PAGE_SIZE, offset, filter)
        },
        fetchSummary = { deps.documents.fetchSummary(DocumentScope.Folder(folderId)) },
        onFirstPageFailed = session::onRefreshFailed,
    )

    val state: StateFlow<FolderState> get() = model.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val unlocker get() = session.unlocker
    override val favourites get() = session.favourites
    val viewerFocus: StateFlow<ViewerFocus?> get() = session.viewerFocus

    /** Cards or list, one choice for every folder; null until it has been read, so neither is drawn by guess. */
    val viewMode: StateFlow<FolderViewMode?> = deps.settings.settings
        .map { it.folderViewMode }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        session.beginRefresh()
        model.refresh(initial)
    }

    fun setViewMode(mode: FolderViewMode) {
        viewModelScope.launch { deps.settings.setFolderViewMode(mode) }
    }

    fun select(kind: DocumentKind?) = model.select(kind)

    fun loadMore() = model.loadMore()

    override fun enterSelection(id: String) = model.enterSelection(listOf(id))

    override fun toggleSelect(id: String) = model.toggleSelect(listOf(id))

    fun clearSelection() = model.clearSelection()

    /** Hand the shown list, and only it, to the viewer. Call right before navigating into a document. */
    override fun prepareSequence() = session.publish(model.prepareSequence())

    override fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearViewerFocus() = session.clearViewerFocus()

    fun deleteSelected() = session.deleteSelected()

    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) = session.downloadSelected(onTargets)
}
