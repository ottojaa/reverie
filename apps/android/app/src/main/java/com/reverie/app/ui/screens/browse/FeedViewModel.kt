package com.reverie.app.ui.screens.browse

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.screens.viewer.ViewerFocus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.flow.update
import java.time.ZoneId
import javax.inject.Inject

/** One [FeedSource]'s screen: its own paging, selection, opened groups and viewer sequence. */
@HiltViewModel
class FeedViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val deps: BrowseDeps,
) : ViewModel(), DocumentListHandler {

    /** The list the route names; an unknown argument opens the photos. */
    val source: FeedSource = FeedSource.ofArgument(savedStateHandle["source"])

    private val cache = deps.documents.observeDocuments(source.scope)
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
        filter = source.filter,
        cache = cache,
        fetchPage = { offset -> deps.documents.refresh(source.scope, BROWSE_PAGE_SIZE, offset, source.filter) },
        onFirstPageFailed = session::onRefreshFailed,
        reconcile = { keep -> deps.documents.dropStale(source.scope, source.filter, keep) },
        sharing = SharingStarted.Eagerly,
    )

    private val openGroups = MutableStateFlow<Set<String>>(emptySet())

    /** The keys of the groups opened in a folded list. */
    val expanded: StateFlow<Set<String>> = openGroups.asStateFlow()

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

    /** A tap on a group opens or closes it; while selecting, it selects or deselects all of it. */
    fun tapGroup(group: RecentRow.Group) {
        if (feed.selectedIds.isNotEmpty()) return feed.toggleSelect(group.docIds())
        openGroups.update { if (group.key in it) it - group.key else it + group.key }
    }

    fun holdGroup(group: RecentRow.Group) {
        if (feed.selectedIds.isNotEmpty()) return feed.toggleSelect(group.docIds())
        feed.enterSelection(group.docIds())
    }

    fun clearSelection() = feed.clearSelection()

    /** Hand the shown list's documents, in the order shown, to the viewer. Call right before opening one. */
    override fun prepareSequence() {
        val open = openGroups.value
        session.publish(feed.prepareSequence { shownIds(source, it, open, ZoneId.systemDefault()) })
    }

    override fun prefetch(document: DocumentDto) = session.prefetch(document)

    fun clearViewerFocus() = session.clearViewerFocus()

    fun deleteSelected() = session.deleteSelected()

    fun downloadSelected(onTargets: (List<DownloadTarget>) -> Unit) = session.downloadSelected(onTargets)
}
