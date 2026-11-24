package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.shareIn
import javax.inject.Inject

/** The dashboard (My Files, or inside a folder): picture cards over Recently added. */
@HiltViewModel
class BrowseViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val deps: BrowseDeps,
) : ViewModel() {

    val folderId: String? = savedStateHandle["folderId"]

    // One Room observer for the whole screen: the three feeds and the unfinished-document watcher share it.
    private val cache = deps.documents.observeDocuments(folderId)
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

    private val model: DashboardModel = DashboardModel(
        scope = viewModelScope,
        cache = cache,
        summary = deps.documents.summary(folderId),
        fetchPage = { kind, offset -> deps.documents.refresh(folderId, if (kind == null) BROWSE_PAGE_SIZE else previewLimit(kind), offset, kind) },
        fetchSummary = { deps.documents.fetchSummary(folderId) },
        dropStale = { kind, keep -> dropStaleInLibrary(kind, keep) },
        onFirstPageFailed = session::onRefreshFailed,
        sharing = SharingStarted.Eagerly,
    )

    val state: StateFlow<DashboardState> get() = model.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val unlocker get() = session.unlocker
    val focusedDocumentId: StateFlow<String?> get() = session.focusedDocumentId

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        session.beginRefresh()
        model.refresh(initial)
    }

    fun loadMore() = model.loadMore()

    fun toggleExpanded(key: String) = model.toggleExpanded(key)

    fun enterSelection(ids: Collection<String>) = model.enterSelection(ids)

    fun toggleSelect(ids: Collection<String>) = model.toggleSelect(ids)

    fun clearSelection() = model.clearSelection()

    /** Hand Recently added's loaded documents to the viewer. Call right before navigating into a document. */
    fun prepareSequence() = session.publish(model.prepareSequence())

    fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearFocusedDocument() = session.clearFocusedDocument()

    fun deleteSelected() = session.deleteSelected()

    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) = session.downloadSelected(onTargets)

    // A folder reconciles itself (see DocumentRepository.refresh); only the whole library needs this.
    private suspend fun dropStaleInLibrary(kind: DocumentKind?, keep: Set<String>) {
        if (folderId == null) deps.documents.dropStaleInLibrary(kind, keep)
    }

    private fun previewLimit(kind: DocumentKind): Int = if (kind == DocumentKind.IMAGE) PHOTO_PREVIEW_COUNT else 1
}
