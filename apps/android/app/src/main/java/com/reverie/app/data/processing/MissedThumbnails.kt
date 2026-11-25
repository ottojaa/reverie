package com.reverie.app.data.processing

import com.reverie.app.data.repository.DocumentRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
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
) {
    private val missed = MutableStateFlow<Set<String>>(emptySet())

    /** The missed documents whose thumbnail job is not known to have finished. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val awaited: Flow<Set<String>> =
        missed.flatMapLatest(documents::observeUnfinishedThumbnails).distinctUntilChanged()

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
}
