package com.reverie.app.data.processing

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.api.model.JobEventType
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.repository.ProcessingDocuments
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class ProcessingTrackerTest {

    private fun doc(id: String, ocr: JobStatus = JobStatus.PENDING, llm: JobStatus = JobStatus.SKIPPED, thumbnail: JobStatus = JobStatus.COMPLETE) =
        DocumentDto(
            id = id, file_path = "/$id", file_hash = id, original_filename = "$id.pdf", mime_type = "application/pdf",
            size_bytes = 1, ocr_status = ocr, thumbnail_status = thumbnail, llm_status = llm,
            is_private = false, created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
        )

    /** The server's view: only still-processing documents, newest first. Counts what is asked of it. */
    private class FakeServer(initial: List<DocumentDto>) : ProcessingDocuments {
        var processing: List<DocumentDto> = initial
        var online = true
        val listCalls = mutableListOf<Pair<Int, Int>>()
        val fetched = mutableListOf<String>()

        override suspend fun fetchProcessing(limit: Int, offset: Int): Paginated<DocumentDto> {
            listCalls += limit to offset
            check(online) { "offline" }
            return Paginated(processing.drop(offset).take(limit), processing.size, limit, offset)
        }

        override suspend fun fetchDocument(id: String): DocumentDto {
            fetched += id
            return processing.firstOrNull { it.id == id } ?: error("finished: $id")
        }

        fun update(id: String, change: (DocumentDto) -> DocumentDto) {
            processing = processing.map { if (it.id == id) change(it) else it }
        }

        fun finish(vararg ids: String) {
            processing = processing.filter { it.id !in ids }
        }
    }

    /** Events only reach rooms that were joined, like the real socket. */
    private class FakeJobEvents : DocumentJobEvents {
        private val feed = MutableSharedFlow<JobEventDto>(extraBufferCapacity = 256)
        override val events: SharedFlow<JobEventDto> = feed
        override val connected: StateFlow<Boolean> get() = connectedState
        override val foregrounded: StateFlow<Boolean> get() = foregroundState
        val connectedState = MutableStateFlow(true)
        val foregroundState = MutableStateFlow(true)
        val joined = mutableSetOf<String>()

        override suspend fun subscribeDocument(documentId: String): AutoCloseable {
            joined += documentId
            return AutoCloseable { joined -= documentId }
        }

        fun complete(documentId: String) {
            if (documentId !in joined) return
            feed.tryEmit(
                JobEventDto(
                    type = JobEventType.COMPLETE, job_id = "j-$documentId", document_id = documentId,
                    status = JobStatus.COMPLETE, timestamp = "2024-01-01T00:00:00Z",
                ),
            )
        }
    }

    private class Harness(scope: TestScope, server: FakeServer, val events: FakeJobEvents, signedIn: MutableStateFlow<Boolean>) {
        val tracker = ProcessingTracker(
            documents = server,
            jobEvents = events,
            signedIn = signedIn,
            scope = scope.backgroundScope,
            refreshWindow = 600.milliseconds,
            safetyInterval = 60.seconds,
        )
    }

    private suspend fun TestScope.settle() {
        advanceTimeBy(2_000)
        runCurrent()
    }

    private fun TestScope.harness(server: FakeServer, signedIn: MutableStateFlow<Boolean> = MutableStateFlow(true)): Harness =
        Harness(this, server, FakeJobEvents(), signedIn)

    @Test
    fun `count falls as text recognition and AI summary finish after the thumbnail already did`() = runTest {
        val server = FakeServer(listOf(doc("a"), doc("b"), doc("c")))
        val h = harness(server)
        settle()
        assertEquals(3, h.tracker.count.value)

        // a: text recognition done, AI summary starts. Still processing, still listened to.
        server.update("a") { it.copy(ocr_status = JobStatus.COMPLETE, llm_status = JobStatus.PENDING) }
        h.events.complete("a")
        settle()
        assertEquals(3, h.tracker.count.value)

        // a: AI summary done. Everything else follows.
        server.finish("a")
        h.events.complete("a")
        settle()
        assertEquals(2, h.tracker.count.value)

        server.finish("b", "c")
        h.events.complete("b")
        h.events.complete("c")
        settle()
        assertEquals(0, h.tracker.count.value)
        assertTrue("rooms are left once nothing is processing", h.events.joined.isEmpty())
    }

    @Test
    fun `a finished document is refetched so its cached row updates`() = runTest {
        val server = FakeServer(listOf(doc("a"), doc("b")))
        val h = harness(server)
        settle()

        server.processing = listOf(doc("b"))
        h.events.complete("a")
        settle()

        assertEquals(listOf("a"), server.fetched)
    }

    @Test
    fun `reconnecting catches up on what the socket missed`() = runTest {
        val server = FakeServer(listOf(doc("a"), doc("b")))
        val h = harness(server)
        settle()
        assertEquals(2, h.tracker.count.value)

        // The socket drops, and a finishes while nobody is listening.
        h.events.connectedState.value = false
        server.finish("a")
        settle()
        assertEquals("nothing tells us yet", 2, h.tracker.count.value)

        h.events.connectedState.value = true
        settle()
        assertEquals(1, h.tracker.count.value)
        assertEquals(listOf("a"), server.fetched)
    }

    @Test
    fun `coming back to the foreground catches up`() = runTest {
        val server = FakeServer(listOf(doc("a")))
        val h = harness(server)
        settle()
        h.events.foregroundState.value = false
        server.finish("a")
        settle()
        assertEquals(1, h.tracker.count.value)

        h.events.foregroundState.value = true
        settle()
        assertEquals(0, h.tracker.count.value)
    }

    @Test
    fun `a burst of completions makes one count request`() = runTest {
        val ids = List(12) { "d$it" }
        val server = FakeServer(ids.map { doc(it) })
        val h = harness(server)
        settle()
        server.listCalls.clear()

        server.finish(*ids.toTypedArray())
        ids.forEach { h.events.complete(it) }
        settle()

        assertEquals(1, server.listCalls.size)
        assertEquals(0, h.tracker.count.value)
    }

    @Test
    fun `a steady stream of events does not starve the count`() = runTest {
        val ids = List(40) { "d$it" }
        val server = FakeServer(ids.map { doc(it) })
        val h = harness(server)
        settle()

        // One file finishes every 200ms, well inside the 600ms window.
        ids.take(10).forEach { id ->
            server.finish(id)
            h.events.complete(id)
            advanceTimeBy(200)
            runCurrent()
        }
        assertTrue("the count moved while events kept arriving", h.tracker.count.value < 40)
    }

    @Test
    fun `joining rooms triggers one catch-up and then it is quiet`() = runTest {
        val server = FakeServer(listOf(doc("a"), doc("b")))
        harness(server)
        settle()

        assertEquals("discovery, then the catch-up after joining", 2, server.listCalls.size)
    }

    @Test
    fun `a big backlog holds the newest and the oldest rooms with two list calls`() = runTest {
        val ids = List(100) { "d%03d".format(it) } // newest first
        val server = FakeServer(ids.map { doc(it) })
        val h = harness(server)
        advanceTimeBy(700)
        runCurrent()

        assertEquals(100, h.tracker.count.value)
        assertEquals(listOf(60 to 0, 30 to 70), server.listCalls)
        assertEquals(ids.take(30).toSet() + ids.takeLast(30).toSet(), h.events.joined)
    }

    @Test
    fun `a failed refresh keeps the last count`() = runTest {
        val server = FakeServer(listOf(doc("a"), doc("b")))
        val h = harness(server)
        settle()

        server.online = false
        h.tracker.refresh()
        settle()

        assertEquals(2, h.tracker.count.value)
    }

    @Test
    fun `the safety re-check finds a lost event while something is processing`() = runTest {
        val server = FakeServer(listOf(doc("a")))
        val h = harness(server)
        settle()

        server.finish("a") // no event arrives
        advanceTimeBy(61_000)
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(0, h.tracker.count.value)
    }

    @Test
    fun `signing out clears the count and the rooms`() = runTest {
        val server = FakeServer(listOf(doc("a")))
        val signedIn = MutableStateFlow(true)
        val h = harness(server, signedIn)
        settle()
        assertEquals(1, h.tracker.count.value)

        signedIn.value = false
        settle()

        assertEquals(0, h.tracker.count.value)
        assertTrue(h.events.joined.isEmpty())
    }

    @Test
    fun `watched documents outside the library list stay live and are refetched`() = runTest {
        val server = FakeServer(emptyList())
        val h = harness(server)
        settle()
        val keep = MutableStateFlow(setOf("private-1"))
        backgroundScope.launch { h.tracker.keepLive(keep) }
        settle()
        assertEquals(setOf("private-1"), h.events.joined)

        h.events.complete("private-1")
        settle()
        assertTrue("private-1" in server.fetched)
    }
}
