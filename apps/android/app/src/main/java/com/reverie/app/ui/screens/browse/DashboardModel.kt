package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.repository.PageResult
import com.reverie.app.ui.screens.viewer.DocumentSequence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/** Photos in the Photos card's strip. */
const val PHOTO_PREVIEW_COUNT = 4

/** Documents per page of Recently added (and of every other Browse list). */
const val BROWSE_PAGE_SIZE = 30

/** What the dashboard draws: the picture cards, their previews and the Recently added list. */
data class DashboardState(
    /** Null until the server has answered once in this process; the cards then show no figures. */
    val summary: DocumentSummaryDto? = null,
    val cachedKinds: Set<DocumentKind> = emptySet(),
    val photoPreview: List<DocumentDto> = emptyList(),
    val videoPreview: DocumentDto? = null,
    val recent: FeedState = FeedState(),
    /** Keys of the fold and stack rows the user opened. */
    val expanded: Set<String> = emptySet(),
) {
    /** The scope's server total (the dashboard's subtitle); null until the server has answered. */
    val total: Int? get() = summary?.let { s -> DocumentKind.entries.sumOf { s.countOf(it) } } ?: recent.documents.total.takeIf { recent.documents.fetched }

    /** The picture cards as rows. */
    val cards: List<List<KindCard>> get() = dashboardCards(summary, cachedKinds)

    /** Recently added as the entries the list draws: rows, with the members of opened folds and stacks. */
    val entries: List<RecentEntry> by lazy { recentEntries(recentRows(recent.documents.documents), expanded) }
}

/**
 * The dashboard's data: the server's summary, a preview feed for the Photos and Videos cards, and the
 * Recently added feed, over one cache observer. Opening it costs four requests: the summary, the two
 * previews and the first page of Recently added. Plain Kotlin so it can be tested on the JVM.
 *
 * @param fetchPage one page of [tab] from [offset] into the cache; page size is the caller's, per tab.
 * @param summary the last summary read in this process, from the repository's memory.
 * @param fetchSummary reads a fresh summary (the repository keeps it for [summary]).
 */
class DashboardModel(
    private val scope: CoroutineScope,
    cache: Flow<List<DocumentDto>>,
    summary: Flow<DocumentSummaryDto?>,
    private val fetchPage: suspend (tab: BrowseTab, offset: Int) -> PageResult,
    private val fetchSummary: suspend () -> DocumentSummaryDto,
    onFirstPageFailed: (Throwable) -> Unit = {},
    computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    // Only Recently added reports a failed first page: offline, one banner and not one per feed.
    val recent = feed(BrowseTab.ALL, cache, onFirstPageFailed, computation, sharing)
    private val photos = feed(BrowseTab.PHOTOS, cache, {}, computation, sharing)
    private val videos = feed(BrowseTab.VIDEOS, cache, {}, computation, sharing)

    private val expanded = MutableStateFlow<Set<String>>(emptySet())

    private val previews = combine(photos.state, videos.state) { p, v ->
        p.documents.documents.take(PHOTO_PREVIEW_COUNT) to v.documents.documents.firstOrNull()
    }

    val state: StateFlow<DashboardState> = combine(
        recent.state,
        previews,
        summary,
        cache.map(::kindsOf).distinctUntilChanged(),
        expanded,
    ) { recent, (photoPreview, videoPreview), summary, cachedKinds, expanded ->
        DashboardState(summary, cachedKinds, photoPreview, videoPreview, recent, expanded)
    }.stateIn(scope, sharing, DashboardState())

    init {
        refreshSummary()
    }

    private fun feed(
        tab: BrowseTab,
        cache: Flow<List<DocumentDto>>,
        onFirstPageFailed: (Throwable) -> Unit,
        computation: CoroutineDispatcher,
        sharing: SharingStarted,
    ) = BrowseFeedModel(scope, tab, cache, { offset -> fetchPage(tab, offset) }, onFirstPageFailed, computation, sharing)

    /** Pull-to-refresh: the summary, both previews and the first page of Recently added, all re-read. */
    fun refresh(initial: Boolean = false) {
        refreshSummary()
        photos.refresh(initial = true)
        videos.refresh(initial = true)
        recent.refresh(initial)
    }

    /** Documents were deleted or added somewhere: the figures, the previews and Recently added follow the server. */
    fun contentChanged() {
        refreshSummary()
        photos.contentChanged()
        videos.contentChanged()
        recent.contentChanged()
    }

    /** A failed read leaves the last figures standing (or none): the cards must never show a guess. */
    private fun refreshSummary() {
        scope.launch {
            try {
                fetchSummary()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Offline or the server is down: keep what is shown.
            }
        }
    }

    fun loadMore() = recent.loadMore()

    fun toggleExpanded(key: String) = expanded.update { if (key in it) it - key else it + key }

    fun enterSelection(ids: Collection<String>) = recent.enterSelection(ids)

    fun toggleSelect(ids: Collection<String>) = recent.toggleSelect(ids)

    fun clearSelection() = recent.clearSelection()

    val selectedIds: Set<String> get() = recent.selectedIds

    /**
     * The viewer's swipe order: Recently added as the list shows it. A collapsed fold or stack is one item
     * (its newest member); the members of an opened one are items in place. It follows the feed as pages
     * arrive, and reaching the end asks Recently added for its next page.
     */
    fun prepareSequence(): DocumentSequence {
        fun idsOf(state: DashboardState) = viewerIds(recentRows(state.recent.documents.documents), state.expanded)
        return DocumentSequence(
            initialIds = idsOf(state.value),
            ids = state.map(::idsOf).distinctUntilChanged(),
            loadMore = recent::loadMore,
        )
    }
}
