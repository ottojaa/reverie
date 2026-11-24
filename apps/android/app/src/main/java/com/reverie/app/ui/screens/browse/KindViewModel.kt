package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
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
) : ViewModel() {

    val folderId: String? = savedStateHandle["folderId"]

    /** Photos, Videos or Files; an unknown route argument opens Photos. */
    val tab: BrowseTab = kindTabOf(savedStateHandle["kind"])

    private val cache = deps.documents.observeDocuments(folderId)
        .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    private val session: BrowseSession = BrowseSession(
        scope = viewModelScope,
        folderId = folderId,
        deps = deps,
        selection = { feed.selectedIds },
        clearSelection = { feed.clearSelection() },
        refresh = { feed.refresh() },
        onContentChanged = { feed.contentChanged() },
    )

    private val feed: BrowseFeedModel = BrowseFeedModel(
        scope = viewModelScope,
        tab = tab,
        cache = cache,
        fetchPage = { offset -> deps.documents.refresh(folderId, BROWSE_PAGE_SIZE, offset, tab.kind) },
        onFirstPageFailed = session::onRefreshFailed,
        sharing = SharingStarted.Eagerly,
    )

    val state: StateFlow<FeedState> get() = feed.state
    val ui: StateFlow<SessionUi> get() = session.ui
    val unlocker get() = session.unlocker
    val gridLayoutMode get() = session.gridLayoutMode
    val mosaicFeatureEvery get() = session.mosaicFeatureEvery
    val focusedDocumentId: StateFlow<String?> get() = session.focusedDocumentId

    init {
        session.keepUnfinishedLive(cache)
    }

    fun refresh(initial: Boolean = false) {
        session.beginRefresh()
        feed.refresh(initial)
    }

    fun loadMore() = feed.loadMore()

    fun enterSelection(id: String) = feed.enterSelection(listOf(id))

    fun toggleSelect(id: String) = feed.toggleSelect(listOf(id))

    fun clearSelection() = feed.clearSelection()

    /** Hand this kind's loaded documents, and only those, to the viewer. Call right before navigating into a document. */
    fun prepareSequence() = session.publish(feed.prepareSequence())

    fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearFocusedDocument() = session.clearFocusedDocument()

    fun deleteSelected() = session.deleteSelected()

    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) = session.downloadSelected(onTargets)
}

/** The kind screen's tab for a route argument ("photos", "videos" or "files"); Photos for anything else. */
fun kindTabOf(argument: String?): BrowseTab =
    BrowseTab.entries.firstOrNull { it != BrowseTab.ALL && it.name.equals(argument, ignoreCase = true) } ?: BrowseTab.PHOTOS
