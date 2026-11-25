package com.reverie.app.ui.screens.browse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.shareIn
import javax.inject.Inject

/** The dashboard (My Files): picture cards over Recently added. */
@HiltViewModel
class BrowseViewModel @Inject constructor(
    private val deps: BrowseDeps,
) : ViewModel() {

    // One Room observer for the whole screen: the three feeds and the unfinished-document watcher share it.
    private val cache = deps.documents.observeDocuments(null)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = null,
        deps = deps,
        selection = { model.selectedIds },
        clearSelection = { model.clearSelection() },
        refresh = { model.refresh() },
        onContentChanged = { model.contentChanged() },
    )

    private val model: DashboardModel = DashboardModel(
        scope = viewModelScope,
        cache = cache,
        summary = deps.documents.summary(null),
        fetchPage = { kind, offset -> deps.documents.refresh(null, if (kind == null) BROWSE_PAGE_SIZE else previewLimit(kind), offset, kind) },
        fetchSummary = { deps.documents.fetchSummary(null) },
        dropStale = deps.documents::dropStaleInLibrary,
        onFirstPageFailed = session::onRefreshFailed,
        sharing = SharingStarted.Eagerly,
    )

    val state: StateFlow<DashboardState> get() = model.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val unlocker get() = session.unlocker
    val favourites get() = session.favourites
    val focusedDocumentId: StateFlow<String?> get() = session.focusedDocumentId

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        // Pulling re-reads the favourites strip too.
        favourites.load()
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

    private fun previewLimit(kind: DocumentKind): Int = if (kind == DocumentKind.IMAGE) PHOTO_PREVIEW_COUNT else 1
}
