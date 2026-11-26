package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.repository.PageResult
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.isInPrivateTree
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.ZoneId

/** What a folder page draws: the folder, where it sits, and its two lists. */
data class FolderState(
    /** The folder in the cached tree; null until the tree holds it. */
    val node: FolderWithChildren? = null,
    /** The folders from the top level down to the one shown, which comes last. */
    val path: List<FolderWithChildren> = emptyList(),
    /** The folder's own photos and videos. */
    val media: FeedDocuments = FeedDocuments(),
    /** Its other documents; null until the photos and videos have been read. */
    val files: FeedDocuments? = null,
    /** The server's figures for the folder's own documents; null until it has answered. */
    val summary: DocumentSummaryDto? = null,
    val selectedIds: Set<String> = emptySet(),
    val isRefreshing: Boolean = false,
) {
    val isEmptyOfDocuments: Boolean get() = media.documents.isEmpty() && files?.documents.isNullOrEmpty()

    val hasMore: Boolean get() = media.hasMore || files?.hasMore == true

    /** Search never returns private documents, so there is nothing to search for inside a private folder. */
    val isSearchable: Boolean get() = node?.isInPrivateTree == false
}

/** What the page may show: nothing about what a locked folder holds, whatever was read of it before it locked. */
fun FolderState.unlessLocked(isLocked: Boolean): FolderState =
    if (isLocked) FolderState(node = node, path = path) else this

/**
 * A folder page's data: its place in the tree, the server's figures, and one feed per section over one cache
 * observer. The photos and videos come first on the page, so the other files are asked for only once those
 * have been read to the end (or could not be read at all). One selection spans both sections. Plain Kotlin
 * so it can be tested on the JVM.
 *
 * @param fetchPage one page of [filter] from [offset] into the cache the [cache] flow reads.
 * @param summary the folder's last summary read in this process, from the repository's memory.
 * @param fetchSummary reads a fresh summary (the repository keeps it for [summary]).
 * @param reconcile told what a section's whole list holds once it has been read from the server.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FolderModel(
    private val scope: CoroutineScope,
    folderId: String,
    tree: Flow<List<FolderWithChildren>>,
    private val cache: Flow<List<DocumentDto>>,
    summary: Flow<DocumentSummaryDto?>,
    private val fetchPage: suspend (filter: DocumentFilter, offset: Int) -> PageResult,
    private val fetchSummary: suspend () -> DocumentSummaryDto,
    private val reconcile: suspend (filter: DocumentFilter, readIds: Set<String>) -> Unit = { _, _ -> },
    private val onFirstPageFailed: (Throwable) -> Unit = {},
    private val isLockRefusal: (Throwable) -> Boolean = { false },
    private val computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    private val selected = MutableStateFlow<Set<String>>(emptySet())
    private val others = MutableStateFlow<BrowseFeedModel?>(null)

    private val media: BrowseFeedModel = feed(DocumentFilter.MEDIA) { error ->
        onFirstPageFailed(error)
        // Offline, say: what is cached of the other files is still worth showing. A closed lock hides everything.
        if (!isLockRefusal(error)) startFiles()
    }

    private val path: Flow<List<FolderWithChildren>> = tree.map { FolderTree(it).pathTo(folderId) }

    private val sections: Flow<Pair<FeedState, FeedState?>> =
        combine(media.state, others.flatMapLatest { it?.state ?: flowOf(null) }, ::Pair)

    val state: StateFlow<FolderState> = combine(path, sections, summary, selected) { folders, (photos, files), figures, ids ->
        FolderState(
            node = folders.lastOrNull(),
            path = folders,
            media = photos.documents,
            files = files?.documents,
            summary = figures,
            selectedIds = ids,
            isRefreshing = photos.isRefreshing || files?.isRefreshing == true,
        )
    }.stateIn(scope, sharing, FolderState())

    val selectedIds: Set<String> get() = selected.value

    /** The selected documents, as the page holds them now. */
    val selectedDocuments: List<DocumentDto>
        get() = with(state.value) { media.documents + files?.documents.orEmpty() }.filter { it.id in selectedIds }

    init {
        refreshSummary()
        scope.launch {
            media.state.first { it.documents.fetched && !it.documents.hasMore }
            startFiles()
        }
    }

    /** Re-reads the figures and the first page of each section. [initial] retries a failed first load, without the spinner. */
    fun refresh(initial: Boolean = false) {
        refreshSummary()
        media.refresh(initial)
        others.value?.refresh(initial)
    }

    /** Documents were deleted or added somewhere: the figures and both sections follow the server. */
    fun contentChanged() {
        refreshSummary()
        media.contentChanged()
        others.value?.contentChanged()
    }

    /** The next page of whichever section the end of the page belongs to. */
    fun loadMore() {
        if (media.state.value.documents.hasMore) return media.loadMore()
        others.value?.loadMore()
    }

    fun enterSelection(ids: Collection<String>) = selected.update { ids.toSet() }

    fun toggleSelect(ids: Collection<String>) = selected.update {
        if (it.containsAll(ids)) it - ids.toSet() else it + ids
    }

    fun clearSelection() = selected.update { emptySet() }

    /** The viewer's swipe order: the section [opened] is listed in, day by day as the page shows it. */
    fun prepareSequence(opened: DocumentDto, zone: ZoneId = ZoneId.systemDefault()): DocumentSequence {
        val isMedia = DocumentFilter.MEDIA.holds(opened.kind)
        val section = if (isMedia) media else others.value ?: media
        return section.prepareSequence { dayOrderedIds(section.filter, it, zone) }
    }

    private fun startFiles() {
        if (others.value != null) return
        others.value = feed(DocumentFilter.FILES, onFirstPageFailed)
    }

    // A section's state is read all the time the page is alive: it decides when the files are asked for.
    private fun feed(filter: DocumentFilter, onFailed: (Throwable) -> Unit) = BrowseFeedModel(
        scope = scope,
        filter = filter,
        cache = cache,
        fetchPage = { offset -> fetchPage(filter, offset) },
        onFirstPageFailed = onFailed,
        reconcile = { keep -> reconcile(filter, keep) },
        computation = computation,
        sharing = SharingStarted.Eagerly,
    )

    private fun refreshSummary() = scope.readQuietly { fetchSummary() }
}
