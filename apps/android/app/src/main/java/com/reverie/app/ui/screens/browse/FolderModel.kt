package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.repository.PageResult
import com.reverie.app.data.settings.FolderChoices
import com.reverie.app.data.settings.FolderView
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.isInPrivateTree
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.manage.Selection
import com.reverie.app.ui.screens.viewer.DocumentSequence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import kotlin.coroutines.cancellation.CancellationException

/** What a folder page draws: the folder (or the root), where it sits, the folders in it and its documents. */
data class FolderState(
    /** The folder in the cached tree; null until the tree holds it. */
    val node: FolderWithChildren? = null,
    /** The folders from the top level down to the one shown, which comes last. */
    val path: List<FolderWithChildren> = emptyList(),
    /** Its own documents, in the order the page shows them. */
    val documents: FeedDocuments = FeedDocuments(),
    /** How the content is drawn; null until that is decided, and nothing of the content is drawn before. */
    val view: FolderView? = null,
    /** The order of [documents]. */
    val sort: DocumentSort = DocumentSort.NEWEST,
    /** What [documents] lists: [DocumentFilter.MEDIA] (by date taken) for a folder of photos and videos. */
    val filter: DocumentFilter = DocumentFilter.ALL,
    /** The server's figures for its own documents; null until it has answered. */
    val summary: DocumentSummaryDto? = null,
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
    /** Whether the page is the root, "My files", which is no folder: it has no [node]. */
    val isRoot: Boolean = false,
    /** The folders directly inside, by name. */
    val children: List<FolderWithChildren> = node?.children.orEmpty().sortedWith(foldersByName),
) {
    val isEmptyOfDocuments: Boolean get() = documents.documents.isEmpty()

    /** Search never returns private documents, so there is nothing to search for inside a private folder. */
    val searchScope: SearchScope?
        get() = if (isRoot) SearchScope.Library
        else node?.takeUnless { it.isInPrivateTree }?.let { SearchScope.Folder(it.id) }
}

/** What the page may show: nothing about what a locked folder holds, whatever was read of it before it locked. */
fun FolderState.unlessLocked(isLocked: Boolean): FolderState =
    if (isLocked) FolderState(node = node, path = path, children = emptyList()) else this

/** The page's one feed, what it lists and the view the page opened with. */
private class OpenFeed(
    val model: BrowseFeedModel,
    val sort: DocumentSort,
    val job: Job,
    val defaultView: FolderView,
)

/** An [OpenFeed] and its latest rows. */
private class Listing(val feed: OpenFeed, val state: FeedState)

/**
 * A folder page's data, for the folder [folderId] names or for the root (null): its place in the tree, the
 * server's figures, and one feed of its own documents. Whether it opens as a grid (a folder of photos and
 * videos) or a list is decided once, before the feed is made; changing the view afterwards redraws the same
 * feed. Plain Kotlin so it can be tested on the JVM.
 *
 * @param cache the folder's own documents in the cache.
 * @param summary the last summary read in this process, from the repository's memory.
 * @param choices what has been chosen for this page.
 * @param fetchPage one page of [filter] in [sort]'s order from [offset] into the cache the [cache] flow reads.
 * @param fetchSummary reads a fresh summary (the repository keeps it for [summary]).
 * @param reconcile told what the feed's whole list holds once it has been read from the server.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FolderModel(
    private val scope: CoroutineScope,
    private val folderId: String?,
    private val tree: Flow<List<FolderWithChildren>>,
    private val cache: Flow<List<DocumentDto>>,
    private val summary: Flow<DocumentSummaryDto?>,
    private val choices: Flow<FolderChoices>,
    private val fetchPage: suspend (filter: DocumentFilter, sort: DocumentSort, offset: Int) -> PageResult,
    private val fetchSummary: suspend () -> DocumentSummaryDto,
    private val reconcile: suspend (filter: DocumentFilter, readIds: Set<String>) -> Unit = { _, _ -> },
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    private val isLockRefusal: (Throwable) -> Boolean = { false },
    private val computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    val selection = Selection()
    private val feed = MutableStateFlow<OpenFeed?>(null)
    private val isRoot = folderId == null

    /** The folders from the top level down to the one shown, and the folders directly inside it. */
    private val place: Flow<Pair<List<FolderWithChildren>, List<FolderWithChildren>>> =
        tree.map { FolderTree(it) }.map { it.pathTo(folderId) to it.childrenOf(folderId).sortedWith(foldersByName) }

    // A new feed says nothing until it has looked at the cache, so a change of order does not blank the page.
    private val listing: Flow<Listing?> = feed.flatMapLatest { open ->
        open?.model?.state?.filter { it != FeedState() }?.map { Listing(open, it) } ?: flowOf(null)
    }

    val state: StateFlow<FolderState> =
        combine(place, listing, choices, summary, selection.ids) { (path, children), shown, chosen, figures, ids ->
            FolderState(
                node = path.lastOrNull(),
                path = path,
                documents = shown?.state?.documents ?: FeedDocuments(),
                view = shown?.let { chosen.view ?: it.feed.defaultView },
                sort = shown?.feed?.sort ?: chosen.sort,
                filter = shown?.feed?.model?.filter ?: DocumentFilter.ALL,
                summary = figures,
                selectedIds = ids,
                isRefreshing = shown?.state?.isRefreshing == true,
                isRoot = isRoot,
                children = children,
            )
        }.stateIn(scope, sharing, FolderState(isRoot = isRoot))

    init {
        scope.launch { openFeeds(isAllMedia = decideAllMedia()) }
    }

    /** Re-reads the figures and the first page. [initial] retries a failed first load, without the spinner. */
    fun refresh(initial: Boolean = false) {
        refreshSummary()
        feed.value?.model?.refresh(initial)
    }

    /** Documents were deleted or added somewhere: the figures and the list follow the server. */
    fun contentChanged() {
        refreshSummary()
        feed.value?.model?.contentChanged()
    }

    fun loadMore() {
        feed.value?.model?.loadMore()
    }

    /** The viewer's swipe order: the documents as the page lists them. */
    fun prepareSequence(): DocumentSequence {
        fun idsOf(state: FolderState) = state.documents.documents.map { it.id }
        return DocumentSequence(
            initialIds = idsOf(state.value),
            ids = state.map(::idsOf).distinctUntilChanged(),
            loadMore = ::loadMore,
        )
    }

    /** Whether the folder opens as a folder of photos and videos. Reads the summary once, one way or another. */
    private suspend fun decideAllMedia(): Boolean {
        if (isRoot) return false.also { refreshSummary() }
        val folder = folderId?.let { FolderTree(tree.first()).find(it) }
        val known = knownAllMedia(summary.first(), folder, cache.first())
        if (known != null) return known.also { refreshSummary() }
        return try {
            fetchSummary().isAllMedia
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (!isLockRefusal(error)) return isAllMedia(cache.first())
            // A closed lock: the caller asks to unlock, and the read made after that decides.
            onFirstPageFailed(error)
            summary.filterNotNull().first().isAllMedia
        }
    }

    /** Opens the page's feed, and opens it again whenever what it should list or its order changes. */
    private suspend fun openFeeds(isAllMedia: Boolean) {
        val filters = if (isAllMedia) mediaUntilThereIsAFile() else flowOf(DocumentFilter.ALL)
        val defaultView = if (isAllMedia) FolderView.GRID else FolderView.LIST
        val sorts = choices.map { it.sort }.distinctUntilChanged()
        combine(filters, sorts, ::Pair).collect { (filter, sort) -> open(filter, sort, defaultView) }
    }

    // A folder taken for photos and videos that turns out to hold another file lists everything from then
    // on, so that nothing is hidden; the view stays as it opened.
    private fun mediaUntilThereIsAFile(): Flow<DocumentFilter> = flow {
        emit(DocumentFilter.MEDIA)
        summary.first { (it?.file?.count ?: 0) > 0 }
        emit(DocumentFilter.ALL)
    }

    private fun open(filter: DocumentFilter, sort: DocumentSort, defaultView: FolderView) {
        feed.value?.job?.cancel()
        // Supervised, as the page's own scope is: one read failing does not stop the others.
        val job = SupervisorJob(scope.coroutineContext.job)
        val model = BrowseFeedModel(
            scope = scope + job,
            filter = filter,
            cache = cache,
            fetchPage = { offset -> fetchPage(filter, sort, offset) },
            onFirstPageFailed = onFirstPageFailed,
            reconcile = { keep -> reconcile(filter, keep) },
            computation = computation,
            sharing = SharingStarted.Eagerly,
            selection = selection,
            sort = sort,
        )
        feed.value = OpenFeed(model, sort, job, defaultView)
    }

    private fun refreshSummary() = scope.readQuietly { fetchSummary() }
}
