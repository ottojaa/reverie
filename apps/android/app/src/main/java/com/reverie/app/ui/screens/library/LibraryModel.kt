package com.reverie.app.ui.screens.library

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.repository.PageResult
import com.reverie.app.ui.screens.browse.BrowseFeedModel
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.readQuietly
import com.reverie.app.ui.screens.viewer.DocumentSequence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** How many candidates a kind card's cover is picked from. */
const val PREVIEW_COUNT = 4

/** How many of the documents in no folder the Library lists; the rest are behind "See all". */
const val UNFILED_ROWS = 3

/** The ready-made searches the Library offers, in the order it shows them. */
private val SMART_VIEW_IDS = listOf("screenshots", "receipts", "statements", "large-files")

/** The two lists of documents on the Library. */
enum class LibrarySection { RECENT, UNFILED }

/** What the Library asks the server for. Each call throws when it cannot be read. */
interface LibraryReads {
    /** One page of every document, newest upload first, from [offset]. */
    suspend fun page(offset: Int): PageResult

    /** One page of the documents in no folder, from [offset]. */
    suspend fun unfiledPage(offset: Int): PageResult

    /** The ids of the documents to make [kind]'s cover from, best first. */
    suspend fun preview(kind: DocumentKind): List<String>

    suspend fun summary()

    /** The folder tree and the folders' covers. */
    suspend fun folders()

    suspend fun smartViews(): List<QuickFilter>

    /** Every document has been read: forget the cached ones that are not among [keep]. */
    suspend fun dropStale(keep: Set<String>)
}

/** The pictures on the three kind cards. */
data class KindCovers(
    val photo: DocumentDto? = null,
    val video: DocumentDto? = null,
    /** Up to two, shown as sheets of paper. */
    val files: List<DocumentDto> = emptyList(),
)

data class LibraryState(
    val summary: DocumentSummaryDto? = null,
    val covers: KindCovers = KindCovers(),
    /** Only the ready-made searches that find something. */
    val smartViews: List<QuickFilter> = emptyList(),
    /** The folders at the top level. */
    val folders: List<FolderWithChildren> = emptyList(),
    /** Recently added; its selection is the Library's, whichever section a document was picked in. */
    val recent: FeedState = FeedState(),
    val unfiled: FeedDocuments = FeedDocuments(),
) {
    /** Every document in the library, once the server has said. */
    val total: Int? get() = summary?.let { figures -> DocumentKind.entries.sumOf(figures::countOf) }

    val unfiledRows: List<DocumentDto> get() = unfiled.documents.take(UNFILED_ROWS)

    val selectedIds: Set<String> get() = recent.selectedIds

    /** Nothing at all to list. */
    val isEmpty: Boolean get() = folders.isEmpty() && recent.documents.documents.isEmpty()

    /** The server has said the library holds no documents, which is not the same as not knowing yet. */
    val hasNoDocuments: Boolean get() = recent.documents.fetched && recent.documents.documents.isEmpty()
}

/**
 * The Library's contents: the kind cards, the ready-made searches, the folders at the top level, what
 * was added last and what is in no folder. Plain Kotlin so it can be tested on the JVM.
 *
 * @param cache every cached public document, newest upload first.
 * @param unfiledCache the cached documents in no folder.
 */
class LibraryModel(
    private val scope: CoroutineScope,
    cache: Flow<List<DocumentDto>>,
    unfiledCache: Flow<List<DocumentDto>>,
    tree: Flow<List<FolderWithChildren>>,
    summary: Flow<DocumentSummaryDto?>,
    private val reads: LibraryReads,
    onFirstPageFailed: (Throwable) -> Unit = {},
    computation: CoroutineDispatcher = Dispatchers.Default,
    sharing: SharingStarted = SharingStarted.WhileSubscribed(5_000),
) {
    private val recent = BrowseFeedModel(
        scope, DocumentFilter.ALL, cache, reads::page,
        onFirstPageFailed = onFirstPageFailed, reconcile = reads::dropStale, computation = computation, sharing = sharing,
    )
    private val unfiled = BrowseFeedModel(
        scope, DocumentFilter.ALL, unfiledCache, reads::unfiledPage, computation = computation, sharing = sharing,
    )

    /** Preview ids per kind; a kind is absent until the server has answered for it. */
    private val previews = MutableStateFlow<Map<DocumentKind, List<String>>>(emptyMap())
    private val smartViews = MutableStateFlow<List<QuickFilter>>(emptyList())

    private val covers = combine(cache, previews) { documents, ids -> kindCovers(documents, ids) }.flowOn(computation)

    private val overview = combine(summary, covers, smartViews, tree) { figures, pictures, searches, folders ->
        LibraryState(summary = figures, covers = pictures, smartViews = searches, folders = folders)
    }

    val state: StateFlow<LibraryState> = combine(overview, recent.state, unfiled.state) { shown, added, loose ->
        shown.copy(recent = added, unfiled = loose.documents)
    }.stateIn(scope, sharing, LibraryState())

    val selectedIds: Set<String> get() = recent.selectedIds

    init {
        readOverview()
    }

    fun refresh(initial: Boolean = false) {
        recent.refresh(initial)
        unfiled.refresh(initial)
        readOverview()
    }

    /** Documents were deleted or added: everything shown is read again. */
    fun contentChanged() {
        recent.contentChanged()
        unfiled.contentChanged()
        readOverview()
    }

    /** The next page of Recently added. */
    fun loadMore() = recent.loadMore()

    fun enterSelection(id: String) = recent.enterSelection(listOf(id))

    fun toggleSelect(id: String) = recent.toggleSelect(listOf(id))

    fun clearSelection() = recent.clearSelection()

    /** The viewer's swipe order for a document opened from [section]. */
    fun prepareSequence(section: LibrarySection): DocumentSequence = when (section) {
        LibrarySection.RECENT -> recent.prepareSequence()
        LibrarySection.UNFILED -> unfiled.prepareSequence()
    }

    /** Everything beside the two lists. Each read fails alone, leaving what was read before. */
    private fun readOverview() {
        scope.readQuietly { reads.summary() }
        scope.readQuietly { reads.folders() }
        scope.readQuietly {
            val found = reads.smartViews().associateBy { it.id }
            smartViews.value = SMART_VIEW_IDS.mapNotNull(found::get)
        }
        DocumentKind.entries.forEach { kind ->
            scope.readQuietly {
                val ids = reads.preview(kind)
                previews.update { it + (kind to ids) }
            }
        }
    }
}

/**
 * The documents [kind]'s cover can come from: the server's picks once it has named them, and until then
 * (offline, say) the newest cached ones.
 */
private fun candidates(cache: List<DocumentDto>, kind: DocumentKind, ids: List<String>?): List<DocumentDto> {
    if (ids == null) return cache.filter { it.kind == kind }.take(PREVIEW_COUNT)
    val byId = cache.associateBy { it.id }
    return ids.mapNotNull(byId::get)
}

internal fun kindCovers(cache: List<DocumentDto>, previews: Map<DocumentKind, List<String>>): KindCovers {
    // Those with a picture come first; the order is otherwise the candidates' own.
    fun picks(kind: DocumentKind) = candidates(cache, kind, previews[kind]).sortedByDescending { it.hasRenderedThumbnail }
    return KindCovers(
        photo = picks(DocumentKind.IMAGE).firstOrNull(),
        video = picks(DocumentKind.VIDEO).firstOrNull(),
        files = picks(DocumentKind.FILE).take(2),
    )
}
