package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.shareIn
import javax.inject.Inject

/** One kind's own screen (Photos, Videos or Files): its own paging, selection and viewer sequence. */
@HiltViewModel
class KindViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val deps: BrowseDeps,
) : ViewModel(), DocumentListHandler {

    /** Photos, Videos or Files; an unknown route argument opens Photos. */
    val kind: DocumentKind = kindOfRoute(savedStateHandle["kind"])

    private val cache = deps.documents.observeDocuments(null)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = null,
        deps = deps,
        selection = { feed.selectedIds },
        clearSelection = { feed.clearSelection() },
        refresh = { feed.refresh() },
        onContentChanged = { feed.contentChanged() },
    )

    private val feed: BrowseFeedModel = BrowseFeedModel(
        scope = viewModelScope,
        kind = kind,
        cache = cache,
        fetchPage = { offset -> deps.documents.refresh(null, BROWSE_PAGE_SIZE, offset, kind) },
        onFirstPageFailed = session::onRefreshFailed,
        reconcile = { keep -> deps.documents.dropStaleInLibrary(kind, keep) },
        sharing = SharingStarted.Eagerly,
    )

    val state: StateFlow<FeedState> get() = feed.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val unlocker get() = session.unlocker
    override val favourites get() = session.favourites
    val gridLayoutMode get() = session.gridLayoutMode
    val mosaicFeatureEvery get() = session.mosaicFeatureEvery
    val viewerFocus: StateFlow<ViewerFocus?> get() = session.viewerFocus

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        session.beginRefresh()
        feed.refresh(initial)
    }

    fun loadMore() = feed.loadMore()

    override fun enterSelection(id: String) = feed.enterSelection(listOf(id))

    override fun toggleSelect(id: String) = feed.toggleSelect(listOf(id))

    fun clearSelection() = feed.clearSelection()

    /** Hand this kind's loaded documents, and only those, to the viewer. Call right before navigating into a document. */
    override fun prepareSequence() = session.publish(feed.prepareSequence())

    override fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearViewerFocus() = session.clearViewerFocus()

    fun deleteSelected() = session.deleteSelected()

    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) = session.downloadSelected(onTargets)
}

/** The route argument that opens [kind]'s screen: "photos", "videos" or "files". */
fun routeOf(kind: DocumentKind): String = when (kind) {
    DocumentKind.IMAGE -> "photos"
    DocumentKind.VIDEO -> "videos"
    DocumentKind.FILE -> "files"
}

/** The kind a kind screen's route argument opens; Photos for anything else. */
fun kindOfRoute(argument: String?): DocumentKind =
    DocumentKind.entries.firstOrNull { routeOf(it).equals(argument, ignoreCase = true) } ?: DocumentKind.IMAGE
