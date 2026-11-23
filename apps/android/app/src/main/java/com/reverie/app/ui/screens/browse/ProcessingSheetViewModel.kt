package com.reverie.app.ui.screens.browse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.isStillProcessing
import com.reverie.app.data.processing.ProcessingTracker
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.ui.screens.viewer.DocumentSequence
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the processing sheet shows: the files still processing that have been paged in so far. */
data class ProcessingSheetState(
    /** Newest first. A row leaves as soon as its file finishes. */
    val rows: List<DocumentDto> = emptyList(),
    /** Files processing in the whole library, which can exceed [rows] until every page is loaded. */
    val total: Int = 0,
    val isLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    /** The last page request failed or brought nothing new, so asking again would only repeat it. */
    val isExhausted: Boolean = false,
) {
    val hasMore: Boolean get() = total > rows.size && !isExhausted
}

internal data class PagedIds(
    val ids: Set<String> = emptySet(),
    val isLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    val isExhausted: Boolean = false,
)

/**
 * The paged ids after a page request finished. [fetched] is null when the request failed. A page
 * that fails or only repeats ids already held marks the list exhausted, so the list doesn't ask
 * again until something changes (the count moves, or the sheet reopens) instead of polling.
 */
internal fun PagedIds.afterPage(fetched: Set<String>?): PagedIds {
    val fresh = fetched.orEmpty() - ids
    return copy(ids = ids + fresh, isLoading = false, isLoadingMore = false, isExhausted = fresh.isEmpty())
}

@HiltViewModel
class ProcessingSheetViewModel @Inject constructor(
    private val documentRepository: DocumentRepository,
    private val tracker: ProcessingTracker,
    private val sequenceHolder: DocumentSequenceHolder,
) : ViewModel() {

    private val paged = MutableStateFlow(PagedIds())

    /**
     * Rows come from the cache, restricted to the ids paged in from the server, so a file that
     * finishes (its cached row is refreshed by the tracker) leaves the list on its own, in place.
     */
    val state: StateFlow<ProcessingSheetState> = combine(
        documentRepository.observeDocuments(null),
        paged,
        tracker.count,
    ) { docs, page, total ->
        ProcessingSheetState(
            rows = docs.filter { it.id in page.ids && it.isStillProcessing },
            total = total,
            isLoading = page.isLoading,
            isLoadingMore = page.isLoadingMore,
            isExhausted = page.isExhausted,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProcessingSheetState())

    init {
        // Files finishing change what the server would return, so a page worth another try may exist.
        viewModelScope.launch { tracker.count.drop(1).collect { paged.update { it.copy(isExhausted = false) } } }
    }

    /** Start over from the newest page. Call each time the sheet opens. */
    fun load() {
        paged.value = PagedIds()
        viewModelScope.launch {
            val ids = fetchIds(offset = 0)
            paged.update { it.afterPage(ids) }
        }
    }

    /** Page in the next files. Rows already gone from the server's list are not counted as loaded. */
    fun loadMore() {
        val current = state.value
        if (current.isLoading || current.isLoadingMore || !current.hasMore) return
        paged.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            val ids = fetchIds(offset = current.rows.size)
            paged.update { it.afterPage(ids) }
        }
    }

    private suspend fun fetchIds(offset: Int): Set<String>? = try {
        documentRepository.fetchProcessing(PAGE_SIZE, offset).items.map(DocumentDto::id).toSet()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** While the sheet is open, listen for the shown files finishing. Runs until cancelled. */
    suspend fun keepRowsLive() {
        tracker.keepLive(state.map { s -> s.rows.map(DocumentDto::id).toSet() }.distinctUntilChanged())
    }

    /** Hand the shown order to the viewer so swiping goes through these files, then open one. */
    fun prepareSequence() = sequenceHolder.set(
        DocumentSequence(
            initialIds = state.value.rows.map(DocumentDto::id),
            ids = state.map { s -> s.rows.map(DocumentDto::id) }.distinctUntilChanged(),
            loadMore = ::loadMore,
        ),
    )

    private companion object {
        const val PAGE_SIZE = 30
    }
}
