package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.settings.FolderView
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.components.createFolder
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One folder's page, or the root's ("My files", with no folder id): its documents and selection, how they
 * are shown, a folder made inside it, and the viewer hand-off.
 */
@HiltViewModel
class FolderViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val deps: BrowseDeps,
) : ViewModel(), DocumentListHandler {

    val folderId: String? = savedStateHandle["folderId"]

    private val folder = DocumentScope.of(folderId)

    private val cache = deps.documents.observeDocuments(folder)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = folderId,
        deps = deps,
        showsFolders = true,
        refresh = { model.refresh() },
        onContentChanged = { model.contentChanged() },
    )

    private val model: FolderModel = FolderModel(
        scope = viewModelScope,
        folderId = folderId,
        tree = deps.folders.observeTree(),
        cache = cache,
        summary = deps.documents.summary(folder),
        choices = deps.settings.folderChoices(folderId),
        fetchPage = { filter, sort, offset ->
            deps.documents.refresh(folder, BROWSE_PAGE_SIZE, offset, filter, sort = sort)
        },
        fetchSummary = { deps.documents.fetchSummary(folder) },
        reconcile = { filter, keep -> deps.documents.dropStale(folder, filter, keep) },
        onFirstPageFailed = session::onRefreshFailed,
        isLockRefusal = { (it as? ReverieApiException)?.lockedFolderId() != null },
    )

    private val messages = Channel<String>(Channel.BUFFERED)

    /** One-off messages for the page's snackbar. */
    val notices: Flow<String> = messages.receiveAsFlow()

    val state: StateFlow<FolderState> get() = model.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val covers: StateFlow<Map<String, FolderCoverDto>> get() = deps.folders.covers
    val unlocker get() = session.unlocker
    override val favourites get() = session.favourites
    override val selection get() = model.selection
    val manage get() = session.manage
    val gridLayoutMode get() = session.gridLayoutMode
    val mosaicFeatureEvery get() = session.mosaicFeatureEvery
    val viewerFocus: StateFlow<ViewerFocus?> get() = session.viewerFocus

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        session.beginRefresh()
        session.refreshFolders()
        model.refresh(initial)
    }

    fun loadMore() = model.loadMore()

    /** Hand the page's documents to the viewer. Call right before opening one. */
    override fun prepareSequence(opened: DocumentDto) = session.publish(model.prepareSequence())

    /** Draws this folder as [view] from now on. */
    fun showAs(view: FolderView) {
        viewModelScope.launch { deps.settings.setFolderView(folderId, view) }
    }

    /** Orders every folder page by [sort]. */
    fun sortBy(sort: DocumentSort) {
        viewModelScope.launch { deps.settings.setFolderSort(sort) }
    }

    override fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearViewerFocus() = session.clearViewerFocus()

    /** Makes a folder inside this one; its row appears with the refreshed tree. */
    fun createFolder(form: FolderFormData) {
        viewModelScope.launch {
            deps.folders.createFolder(form, parentId = folderId)?.let { messages.send(it) }
        }
    }

    fun download(ids: List<String>, onTargets: (List<DownloadTarget>) -> Unit) = session.download(ids, onTargets)
}
