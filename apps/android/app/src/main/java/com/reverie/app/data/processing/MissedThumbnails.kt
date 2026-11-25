package com.reverie.app.data.processing

import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.di.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** SQLite takes at most 999 values in one query on older Android. */
private const val MOST_REMEMBERED = 500

/**
 * Documents the server had no thumbnail for when one was asked for. A new upload has its blurhash
 * before its thumbnail, so a screen can ask too early, also one that knows nothing about the
 * document's jobs (a folder cover, a search result).
 */
@Singleton
class MissedThumbnails @Inject constructor(
    private val documents: DocumentRepository,
    private val tracker: ProcessingTracker,
    @ApplicationScope scope: CoroutineScope,
) {
    private val missed = MutableStateFlow<Set<String>>(emptySet())

    /** The missed documents whose thumbnail job is not known to have finished. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val awaited: StateFlow<Set<String>> = missed.flatMapLatest(::observeAwaited)
        .stateIn(scope, SharingStarted.WhileSubscribed(replayExpirationMillis = 0), emptySet())

    fun add(id: String) {
        missed.update { if (id in it) it else (it.toList().takeLast(MOST_REMEMBERED - 1) + id).toSet() }
    }

    /** Has the tracker keep the awaited documents live until cancelled, then forgets every miss. */
    suspend fun follow() {
        try {
            tracker.keepLive(awaited)
        } finally {
            missed.value = emptySet()
        }
    }

    /** Those of [asked] still to be waited for. The others are forgotten. */
    private fun observeAwaited(asked: Set<String>): Flow<Set<String>> {
        if (asked.isEmpty()) return flowOf(emptySet())
        // Only what was asked about can be dropped: a miss added meanwhile has no answer yet.
        return documents.observeUnfinishedThumbnails(asked)
            .onEach { unfinished -> missed.update { it - (asked - unfinished) } }
    }
}
