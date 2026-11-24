package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.repository.PageResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A server holding [library], two rows to a page, that writes each page it serves into [cache] like the repository does. */
private class FakeServer(library: List<DocumentDto>) {
    private var library = library
    val cache = MutableStateFlow<List<DocumentDto>>(emptyList())
    val requests = mutableListOf<Pair<DocumentKind?, Int>>()
    var failNext = false
    /** Where the feed's reconcile callback lands: the repository's `dropStaleInLibrary`, on the fake cache. */
    val reconciled = mutableListOf<Set<String>>()

    fun page(kind: DocumentKind?, offset: Int): PageResult {
        requests += kind to offset
        if (failNext) {
            failNext = false
            error("offline")
        }
        val ordered = library.filter { kind == null || it.kind == kind }.sortedByDescending { sortKeyOf(it, kind) }
        val items = ordered.drop(offset).take(PAGE)
        cache.update { (it + items).distinctBy(DocumentDto::id) }
        return PageResult(total = ordered.size, loaded = offset + items.size, last = items.lastOrNull(), ids = items.map { it.id })
    }

    fun dropStale(kind: DocumentKind?, keep: Set<String>) {
        reconciled += keep
        cache.update { rows -> rows.filter { it.id in keep || (kind != null && it.kind != kind) } }
    }

    /** Removes [ids] from the server only, as a delete on another device does: the cache doesn't hear of it. */
    fun deleteElsewhere(vararg ids: String) {
        library = library.filterNot { it.id in ids }
    }

    /** Removes [ids] from the server and from the cache, like the repository's delete does. */
    fun delete(vararg ids: String) {
        library = library.filterNot { it.id in ids }
        cache.update { rows -> rows.filterNot { it.id in ids } }
    }

    companion object { const val PAGE = 2 }
}

class BrowseFeedModelTest {

    // Five photos, three videos, three files; the day in each id is its upload day so the order is easy to read.
    private val library = listOf(
        doc("p5", created = "2026-11-25T10:00:00Z"), doc("p4", created = "2026-11-24T10:00:00Z"),
        doc("p3", created = "2026-11-23T10:00:00Z"), doc("p2", created = "2026-11-22T10:00:00Z"),
        doc("p1", created = "2026-11-21T10:00:00Z"),
        doc("v3", "video/mp4", created = "2026-11-25T11:00:00Z"), doc("v2", "video/mp4", created = "2026-11-24T11:00:00Z"),
        doc("v1", "video/mp4", created = "2026-11-23T11:00:00Z"),
        doc("f3", "application/pdf", created = "2026-11-25T12:00:00Z"), doc("f2", "text/plain", created = "2026-11-24T12:00:00Z"),
        doc("f1", "", created = "2026-11-23T12:00:00Z"),
    )

    private class Fixture(val server: FakeServer, val model: BrowseFeedModel, val failures: MutableList<Throwable>)

    private fun TestScope.start(
        kind: DocumentKind?,
        server: FakeServer = FakeServer(library),
        reportFailures: Boolean = true,
    ): Fixture {
        val failures = mutableListOf<Throwable>()
        val model = BrowseFeedModel(
            scope = backgroundScope as CoroutineScope,
            kind = kind,
            cache = server.cache,
            fetchPage = { offset -> server.page(kind, offset) },
            onFirstPageFailed = { if (reportFailures) failures += it },
            reconcile = { keep -> server.dropStale(kind, keep) },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(server, model, failures)
    }

    private fun Fixture.ids() = model.state.value.documents.documents.map { it.id }

    @Test fun `a feed fetches its first page as soon as it exists`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(null)
        assertEquals(listOf<Pair<DocumentKind?, Int>>(null to 0), f.server.requests)
        assertEquals(11, f.model.state.value.documents.total)
        assertEquals(listOf("f3", "v3"), f.ids())
    }

    @Test fun `feeds over one cache each show only their kind, down to what they have read`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        val all = start(null, server)
        val photos = start(DocumentKind.IMAGE, server)
        assertEquals(listOf("p5", "p4"), photos.ids())
        // The All page cached rows of other kinds; the Photos feed has not read as far as them.
        assertFalse("p1" in photos.ids())
        assertEquals(listOf(null to 0, DocumentKind.IMAGE to 0), server.requests)
        assertEquals(listOf("f3", "v3"), all.ids())
    }

    @Test fun `loading more reads on from where the feed stopped`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        f.model.loadMore()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids())
        assertTrue(f.model.state.value.documents.hasMore)
        f.model.loadMore()
        assertEquals(5, f.ids().size)
        assertEquals(listOf(DocumentKind.IMAGE to 0, DocumentKind.IMAGE to 2, DocumentKind.IMAGE to 4), f.server.requests)
    }

    @Test fun `loading more of a feed with nothing left asks for nothing`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.VIDEO)
        f.model.loadMore()
        val asked = f.server.requests.size
        f.model.loadMore()
        assertEquals(asked, f.server.requests.size)
        assertFalse(f.model.state.value.documents.hasMore)
    }

    @Test fun `selection is the feed's own and a fold's members toggle together`() = runTest(UnconfinedTestDispatcher()) {
        val photos = start(DocumentKind.IMAGE)
        val videos = start(DocumentKind.VIDEO, photos.server)
        photos.model.enterSelection(listOf("p5"))
        photos.model.toggleSelect(listOf("p4", "p3"))
        assertEquals(setOf("p5", "p4", "p3"), photos.model.state.value.selectedIds)
        assertTrue(videos.model.state.value.selectedIds.isEmpty())
        photos.model.toggleSelect(listOf("p4", "p3"))
        assertEquals(setOf("p5"), photos.model.selectedIds)
        photos.model.toggleSelect(listOf("p4", "p3"))
        photos.model.clearSelection()
        assertTrue(photos.model.state.value.selectedIds.isEmpty())
    }

    @Test fun `the viewer sequence holds only this feed and loads more of it`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        val videos = start(DocumentKind.VIDEO, server)
        val sequence = videos.model.prepareSequence()
        assertEquals(listOf("v3", "v2"), sequence.initialIds)
        sequence.loadMore()
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
        assertEquals(DocumentKind.VIDEO to 2, server.requests.last())
        // Another feed paging later does not change what this sequence holds.
        start(DocumentKind.FILE, server).model.loadMore()
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
    }

    @Test fun `refreshing the first page starts the offset over without hiding what the feed showed`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        f.model.loadMore()
        f.model.refresh()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids())
        f.model.loadMore()
        // The next page starts where page one ended; it only re-reads rows already shown.
        assertEquals(listOf(DocumentKind.IMAGE to 2, DocumentKind.IMAGE to 4), f.server.requests.takeLast(2))
    }

    @Test fun `after a refresh one load more reads on until a row that was not shown yet`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        f.model.loadMore()
        f.model.refresh()
        f.model.loadMore()
        // Page two brought nothing new, so the model read page three itself: the list would not have asked again.
        assertEquals(listOf("p5", "p4", "p3", "p2", "p1"), f.ids())
        assertFalse(f.model.state.value.documents.hasMore)
    }

    @Test fun `after deleting rows above what a feed read, scrolling on skips none of the server's rows`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        f.model.loadMore()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids())
        // Two photos at the top go; every row below them moves up two places on the server.
        f.server.delete("p5", "p4")
        f.model.contentChanged()
        f.model.loadMore()
        f.model.loadMore()
        assertEquals(listOf("p3", "p2", "p1"), f.ids())
        assertEquals(3, f.model.state.value.documents.total)
        assertFalse(f.model.state.value.documents.hasMore)
    }

    @Test fun `a failed first page is reported and a failed later page is not`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        server.failNext = true
        val f = start(DocumentKind.VIDEO, server)
        assertEquals(1, f.failures.size)
        assertFalse(f.model.state.value.documents.fetched)
        assertTrue(f.model.state.value.documents.failed)
        f.model.refresh(initial = true)
        assertEquals(listOf("v3", "v2"), f.ids())
        server.failNext = true
        f.model.loadMore()
        assertEquals(1, f.failures.size)
    }

    @Test fun `a preview feed that fails stays silent so an offline open reports once`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        server.failNext = true
        val preview = BrowseFeedModel(
            scope = backgroundScope as CoroutineScope, kind = DocumentKind.IMAGE, cache = server.cache,
            fetchPage = { server.page(DocumentKind.IMAGE, it) },
            computation = UnconfinedTestDispatcher(testScheduler), sharing = SharingStarted.Eagerly,
        )
        assertTrue(preview.state.value.documents.failed)
    }

    @Test fun `a photo deleted elsewhere is gone once the feed has read to the end, and the total matches`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        f.model.loadMore()
        f.model.loadMore()
        assertEquals(5, f.model.state.value.documents.documents.size)

        // p3 is deleted on another device; this phone still has it cached. Reading the feed to its end again finds it gone.
        f.server.deleteElsewhere("p3")
        f.model.refresh(initial = true)
        f.model.loadMore()
        f.model.loadMore()

        val photos = f.model.state.value.documents
        assertEquals(listOf("p5", "p4", "p2", "p1"), photos.documents.map { it.id })
        assertEquals(4, photos.total)
        assertFalse(photos.hasMore)
    }

    @Test fun `reading to the end of one kind leaves the cached rows of the other kinds alone`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        val all = start(null, server)
        val videos = start(DocumentKind.VIDEO, server)
        videos.model.loadMore()
        server.deleteElsewhere("v2")
        videos.model.refresh(initial = true)
        videos.model.loadMore()

        assertEquals(listOf("v3", "v1"), videos.ids())
        // Recently added cached f3 and v3 and has not read to its end: the video read dropped none of its other rows.
        assertEquals(setOf("f3", "v3", "v1"), server.cache.value.map { it.id }.toSet())
        assertEquals(listOf("f3", "v3"), all.ids())
    }

    @Test fun `a feed reconciles only after the last page, with every id it read`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        assertEquals(emptyList<Set<String>>(), f.server.reconciled)
        f.model.loadMore()
        assertEquals(emptyList<Set<String>>(), f.server.reconciled)
        f.model.loadMore()
        assertEquals(listOf(setOf("p5", "p4", "p3", "p2", "p1")), f.server.reconciled)
    }

    @Test fun `a read in which the server's total moved reconciles nothing`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(DocumentKind.IMAGE)
        // A photo is deleted between page one and page two: the rows shift up and one is skipped.
        f.server.deleteElsewhere("p4")
        f.model.loadMore()
        f.model.loadMore()
        assertEquals(emptyList<Set<String>>(), f.server.reconciled)
    }

    @Test fun `an empty kind reconciles to nothing, so its cached rows go`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library.filterNot { it.kind == DocumentKind.VIDEO })
        server.cache.value = library.filter { it.kind == DocumentKind.VIDEO }
        val f = start(DocumentKind.VIDEO, server)
        assertEquals(emptyList<DocumentDto>(), server.cache.value)
        assertEquals(0, f.model.state.value.documents.total)
    }

    @Test
    fun `a kind route argument picks its kind, and anything else opens Photos`() {
        assertEquals(DocumentKind.IMAGE, kindOfRoute("photos"))
        assertEquals(DocumentKind.VIDEO, kindOfRoute("VIDEOS"))
        assertEquals(DocumentKind.FILE, kindOfRoute("Files"))
        // The dashboard's own feed is not a kind screen, and a missing or unknown argument must not crash the route.
        assertEquals(DocumentKind.IMAGE, kindOfRoute("all"))
        assertEquals(DocumentKind.IMAGE, kindOfRoute("nonsense"))
        assertEquals(DocumentKind.IMAGE, kindOfRoute(null))
    }
}
