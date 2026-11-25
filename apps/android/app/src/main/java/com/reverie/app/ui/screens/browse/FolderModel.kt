package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.repository.PageResult
import com.reverie.app.ui.screens.viewer.DocumentSequence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn

/** One chip of the folder page: a kind the folder holds, or every kind when [kind] is null (All). */
data class FolderChip(val kind: DocumentKind?, val count: Int?)

/** What the folder page draws: the chips, the selected chip's list and the subtitle's figures. */
data class FolderState(
    /** Empty when the folder holds fewer than two kinds: there is nothing to choose between. */
    val chips: List<FolderChip> = emptyList(),
    /** The selected chip's kind; null is All. */
    val selected: DocumentKind? = null,
    val feed: FeedState = FeedState(),
    /** Documents in the folder by the server's count; null until it has answered. */
    val total: Int? = null,
) {
    /** The server's count of what a kind chip lists; null under All, or until it has answered. */
    val matching: Int?
        get() {
            if (selected == null) return null
            return chips.firstOrNull { it.kind == selected }?.count ?: feed.documents.total.takeIf { feed.documents.fetched }
        }
}

/** What the page may show: nothing about what a locked folder holds, whatever was read of it before it locked. */
fun FolderState.unlessLocked(isLocked: Boolean): FolderState = if (isLocked) FolderState() else this

/**
 * The chip row for a folder: All and one chip per kind it holds, by the server's summary. Until the server
 * has answered, the kinds are those of the cached rows and the chips carry no counts.
 */
fun folderChips(summary: DocumentSummaryDto?, cachedKinds: Set<DocumentKind>): List<FolderChip> {
    val held = DocumentKind.entries.filter { if (summary == null) it in cachedKinds else summary.countOf(it) > 0 }
    if (held.size < 2) return emptyList()
    val kinds = held.map { FolderChip(it, summary?.countOf(it)) }
    return listOf(FolderChip(null, summary?.let { kinds.sumOf { chip -> chip.count ?: 0 } })) + kinds
}

/**
 * A folder page's data: the server's summary and one feed per chip over one cache observer. A chip's feed
 * is made (and asks for its first page) the first time the chip is selected, and is then kept, so switching
 * back finds its pages. Selection, paging and the viewer's swipe order all act on the shown feed. Plain
 * Kotlin so it can be tested on the JVM.
 *
 * @param fetchPage one page of [kind] (null is every kind) from [offset] into the cache the [cache] flow reads.
 * @param summary the folder's last summary read in this process, from the repository's memory.
 * @param fetchSummary reads a fresh summary (the repository keeps it for [summary]).
 */
class FolderModel(
    private val scope: CoroutineScope,
    private val cache: Flow<List<DocumentDto>>,
    summary: Flow<DocumentSummaryDto?>,
    private val fetchPage: suspend (kind: DocumentKind?, offset: Int) -> PageResult,
    private val fetchSummary: suspend () -> DocumentSummaryDto,
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    private val computation: CoroutineDispatcher = Dispatchers.Default,
    private val sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    private val selected = MutableStateFlow<DocumentKind?>(null)
    private val feeds = mutableMapOf<DocumentKind?, BrowseFeedModel>()
    private val all = feed(null)
    private val shown: BrowseFeedModel get() = feed(selected.value)

    private val chips: Flow<Pair<List<FolderChip>, Int?>> =
        combine(summary, cache.map(::kindsOf).distinctUntilChanged()) { fresh, cached ->
            folderChips(fresh, cached) to fresh?.let { s -> DocumentKind.entries.sumOf { s.countOf(it) } }
        }.onEach { (chips, _) -> dropUnshownSelection(chips) }

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<FolderState> = selected
        .flatMapLatest { kind ->
            combine(feed(kind).state, chips) { shownFeed, (chips, total) ->
                val read = all.state.value.documents
                FolderState(chips, kind, shownFeed, total ?: read.total.takeIf { read.fetched })
            }
        }
        .stateIn(scope, sharing, FolderState())

    val selectedIds: Set<String> get() = shown.selectedIds

    init {
        refreshSummary()
    }

    /** Shows [kind]'s list. A selection does not follow: delete must never act on rows that are off screen. */
    fun select(kind: DocumentKind?) {
        if (kind == selected.value) return
        shown.clearSelection()
        selected.value = kind
    }

    /**
     * Pull-to-refresh re-reads the figures and the shown list, and has the other lists read so far start
     * over. [initial] only retries a failed first load: the figures and the shown list.
     */
    fun refresh(initial: Boolean = false) {
        refreshSummary()
        val front = shown
        front.refresh(initial)
        if (initial) return
        feeds.values.filter { it !== front }.forEach { it.contentChanged() }
    }

    /** Documents were deleted or added somewhere: the counts and every list read so far follow the server. */
    fun contentChanged() {
        refreshSummary()
        feeds.values.forEach { it.contentChanged() }
    }

    fun loadMore() = shown.loadMore()

    fun enterSelection(ids: Collection<String>) = shown.enterSelection(ids)

    fun toggleSelect(ids: Collection<String>) = shown.toggleSelect(ids)

    fun clearSelection() = shown.clearSelection()

    /** The viewer's swipe order: the shown list as it stands, following it as pages arrive. */
    fun prepareSequence(): DocumentSequence = shown.prepareSequence()

    private fun feed(kind: DocumentKind?): BrowseFeedModel = feeds.getOrPut(kind) {
        BrowseFeedModel(
            scope = scope,
            filter = kind?.let(DocumentFilter::of) ?: DocumentFilter.ALL,
            cache = cache,
            fetchPage = { offset -> fetchPage(kind, offset) },
            onFirstPageFailed = onFirstPageFailed,
            computation = computation,
            sharing = sharing,
        )
    }

    /** The last document of the selected kind is gone, and its chip with it: back to All. */
    private fun dropUnshownSelection(chips: List<FolderChip>) {
        val kind = selected.value ?: return
        if (chips.none { it.kind == kind }) select(null)
    }

    private fun refreshSummary() = scope.readQuietly { fetchSummary() }
}
