package com.reverie.app.data.processing

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.api.model.JobEventType
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.repository.ProcessingDocuments
import com.reverie.app.di.ApplicationScope
import com.reverie.app.domain.model.AuthState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * Knows how many documents in the whole library are still being processed (thumbnail, text
 * recognition, AI summary) and keeps the cached rows of those documents current.
 *
 * The server only sends a document's job events to clients that joined that document's room, so
 * the tracker joins the rooms of the documents it can see processing, and leaves them as they
 * finish. Everything that could have been missed (a room joined a moment after its job finished,
 * a socket that was down, a backgrounded app) is covered the same way: ask the server again.
 *
 * Every trigger funnels into [refresh], which waits a short fixed window before it runs, so a
 * burst of events (or an event plus a reconnect) costs one list call, not one per trigger.
 */
@Singleton
class ProcessingTracker(
    private val documents: ProcessingDocuments,
    private val jobEvents: DocumentJobEvents,
    signedIn: Flow<Boolean>,
    scope: CoroutineScope,
    private val refreshWindow: Duration = REFRESH_WINDOW,
    private val safetyInterval: Duration = SAFETY_INTERVAL,
) {
    @Inject
    constructor(
        documents: ProcessingDocuments,
        jobEvents: DocumentJobEvents,
        auth: AuthSessionManager,
        @ApplicationScope scope: CoroutineScope,
    ) : this(documents, jobEvents, auth.authState.map { it is AuthState.Authenticated }, scope)

    /** Documents in the library whose thumbnail, text recognition or AI summary is unfinished. */
    private val _count = MutableStateFlow(0)
    val count: StateFlow<Int> = _count.asStateFlow()

    /** Document rooms currently joined. Only the refresh loop replaces this. */
    private val rooms = MutableStateFlow<Map<String, AutoCloseable>>(emptyMap())

    /**
     * Documents screens asked to keep live, per screen. They cover what the library-wide list
     * can't: documents in private folders, and unfinished documents further down a big backlog.
     */
    private val watched = MutableStateFlow<Map<Any, Set<String>>>(emptyMap())

    /** Watched documents that reported a finished job since the last [sync]. */
    private val settledWatched = MutableStateFlow<Set<String>>(emptySet())

    private val requests = Channel<Unit>(Channel.CONFLATED)

    init {
        scope.launch { runRefreshLoop() }
        scope.launch { signedIn.distinctUntilChanged().collect { if (it) refresh() else reset() } }
        scope.launch { jobEvents.connected.filter { it }.collect { refresh() } }
        scope.launch { jobEvents.foregrounded.filter { it }.collect { refresh() } }
        scope.launch { jobEvents.events.filter(::isSettledJobInRoom).collect(::onSettled) }
        scope.launch { runSafetyPoll() }
    }

    /** Ask for a fresh count and window of rooms. Cheap to call: calls close together run once. */
    fun refresh() {
        requests.trySend(Unit)
    }

    /**
     * Keep the documents in [ids] live until the caller is cancelled: their rooms stay joined and
     * their cached rows are refetched as their jobs finish. Pass the screen's unfinished documents.
     */
    suspend fun keepLive(ids: Flow<Set<String>>) {
        val owner = Any()
        try {
            ids.collect { set ->
                watched.update { it + (owner to set) }
                refresh()
            }
        } finally {
            watched.update { it - owner }
            refresh()
        }
    }

    private fun isSettledJobInRoom(event: JobEventDto): Boolean {
        val settled = event.type == JobEventType.COMPLETE || event.type == JobEventType.FAILED
        return settled && event.document_id in rooms.value
    }

    private fun onSettled(event: JobEventDto) {
        event.document_id?.let { id -> settledWatched.update { it + id } }
        refresh()
    }

    private suspend fun runRefreshLoop() {
        for (request in requests) {
            delay(refreshWindow)
            // Requests that arrived during the wait are served by the run below.
            requests.tryReceive()
            sync()
        }
    }

    /** While something is processing and the app is open, re-check slowly in case an event was lost. */
    private suspend fun runSafetyPoll() {
        combine(_count, jobEvents.foregrounded) { count, foreground -> count > 0 && foreground }
            .distinctUntilChanged()
            .collectLatest { active ->
                if (!active) return@collectLatest
                while (true) {
                    delay(safetyInterval)
                    refresh()
                }
            }
    }

    private suspend fun sync() {
        val window = fetchWindow() ?: return
        _count.value = window.total

        val held = rooms.value
        val live = window.items.map(DocumentDto::id).toSet()
        val extra = watched.value.values.flatten().toSet().minus(live).take(WINDOW).toSet()
        val gone = held.keys - live - extra
        gone.forEach { held.getValue(it).close() }
        var current = held - gone
        rooms.value = current

        for (id in (live + extra) - current.keys) {
            current = current + (id to jobEvents.subscribeDocument(id))
            rooms.value = current
        }

        // Documents that left the list have finished, and watched ones that reported a finished
        // job (or whose room was only just joined) may have: their cached rows say otherwise.
        val settled = settledWatched.getAndUpdate { emptySet() }
        val stale = gone + extra.filter { it in settled || it !in held.keys }
        stale.forEach { id -> refetch(id) }
        // The jobs of rooms joined just now may have finished before the server let us in.
        if (current.keys.any { it !in held }) refresh()
    }

    private suspend fun refetch(id: String) {
        try {
            documents.fetchDocument(id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The next refresh asks again; a failed refetch must not stop the others.
        }
    }

    /**
     * The newest and the oldest processing documents. Uploads are worked off roughly in order, so
     * the oldest are the ones finishing now, while the newest are the ones the grid shows first.
     * Up to [WINDOW] * 2 documents come back in one call; a larger backlog costs one more call for
     * its oldest end. Returns null when the server can't be reached, so the last count stays.
     */
    private suspend fun fetchWindow(): Window? {
        val first = fetchPage(limit = WINDOW * 2, offset = 0) ?: return null
        if (first.total <= first.items.size) return first

        val oldest = fetchPage(limit = WINDOW, offset = first.total - WINDOW) ?: return null
        val newest = first.items.take(WINDOW)
        val newestIds = newest.map(DocumentDto::id).toSet()
        return Window(first.total, newest + oldest.items.filter { it.id !in newestIds })
    }

    private suspend fun fetchPage(limit: Int, offset: Int): Window? = try {
        val page = documents.fetchProcessing(limit, offset)
        Window(page.total, page.items)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    private fun reset() {
        rooms.value.values.forEach(AutoCloseable::close)
        rooms.value = emptyMap()
        _count.value = 0
    }

    private data class Window(val total: Int, val items: List<DocumentDto>)

    companion object {
        /** Rooms held per end of the backlog (newest and oldest). */
        const val WINDOW = 30
        private val REFRESH_WINDOW = 600.milliseconds
        private val SAFETY_INTERVAL = 60.seconds
    }
}
