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

    fun page(kind: DocumentKind?, offset: Int): PageResult {
        requests += kind to offset
        if (failNext) {
            failNext = false
            error("offline")
        }
        val tab = BrowseTab.entries.first { it.kind == kind }
        val ordered = library.filter { kind == null || it.kind == kind }.sortedByDescending { sortKeyOf(it, tab) }
        val items = ordered.drop(offset).take(PAGE)
        cache.update { (it + items).distinctBy(DocumentDto::id) }
        return PageResult(total = ordered.size, loaded = offset + items.size, last = items.lastOrNull())
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
        tab: BrowseTab,
        server: FakeServer = FakeServer(library),
        reportFailures: Boolean = true,
    ): Fixture {
        val failures = mutableListOf<Throwable>()
        val model = BrowseFeedModel(
            scope = backgroundScope as CoroutineScope,
            tab = tab,
            cache = server.cache,
            fetchPage = { offset -> server.page(tab.kind, offset) },
            onFirstPageFailed = { if (reportFailures) failures += it },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(server, model, failures)
    }

    private fun Fixture.ids() = model.state.value.documents.documents.map { it.id }

    @Test fun `a feed fetches its first page as soon as it exists`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.ALL)
        assertEquals(listOf<Pair<DocumentKind?, Int>>(null to 0), f.server.requests)
        assertEquals(11, f.model.state.value.documents.total)
        assertEquals(listOf("f3", "v3"), f.ids())
    }

    @Test fun `feeds over one cache each show only their kind, down to what they have read`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        val all = start(BrowseTab.ALL, server)
        val photos = start(BrowseTab.PHOTOS, server)
        assertEquals(listOf("p5", "p4"), photos.ids())
        // The All page cached rows of other kinds; the Photos feed has not read as far as them.
        assertFalse("p1" in photos.ids())
        assertEquals(listOf(null to 0, DocumentKind.IMAGE to 0), server.requests)
        assertEquals(listOf("f3", "v3"), all.ids())
    }

    @Test fun `loading more reads on from where the feed stopped`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.PHOTOS)
        f.model.loadMore()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids())
        assertTrue(f.model.state.value.documents.hasMore)
        f.model.loadMore()
        assertEquals(5, f.ids().size)
        assertEquals(listOf(DocumentKind.IMAGE to 0, DocumentKind.IMAGE to 2, DocumentKind.IMAGE to 4), f.server.requests)
    }

    @Test fun `loading more of a feed with nothing left asks for nothing`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.VIDEOS)
        f.model.loadMore()
        val asked = f.server.requests.size
        f.model.loadMore()
        assertEquals(asked, f.server.requests.size)
        assertFalse(f.model.state.value.documents.hasMore)
    }

    @Test fun `selection is the feed's own and a fold's members toggle together`() = runTest(UnconfinedTestDispatcher()) {
        val photos = start(BrowseTab.PHOTOS)
        val videos = start(BrowseTab.VIDEOS, photos.server)
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
        val videos = start(BrowseTab.VIDEOS, server)
        val sequence = videos.model.prepareSequence()
        assertEquals(listOf("v3", "v2"), sequence.initialIds)
        sequence.loadMore()
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
        assertEquals(DocumentKind.VIDEO to 2, server.requests.last())
        // Another feed paging later does not change what this sequence holds.
        start(BrowseTab.FILES, server).model.loadMore()
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
    }

    @Test fun `refreshing the first page starts the offset over without hiding what the feed showed`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.PHOTOS)
        f.model.loadMore()
        f.model.refresh()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids())
        f.model.loadMore()
        // The next page starts where page one ended; it only re-reads rows already shown.
        assertEquals(listOf(DocumentKind.IMAGE to 2, DocumentKind.IMAGE to 4), f.server.requests.takeLast(2))
    }

    @Test fun `after a refresh one load more reads on until a row that was not shown yet`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.PHOTOS)
        f.model.loadMore()
        f.model.refresh()
        f.model.loadMore()
        // Page two brought nothing new, so the model read page three itself: the list would not have asked again.
        assertEquals(listOf("p5", "p4", "p3", "p2", "p1"), f.ids())
        assertFalse(f.model.state.value.documents.hasMore)
    }

    @Test fun `after deleting rows above what a feed read, scrolling on skips none of the server's rows`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(BrowseTab.PHOTOS)
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
        val f = start(BrowseTab.VIDEOS, server)
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
            scope = backgroundScope as CoroutineScope, tab = BrowseTab.PHOTOS, cache = server.cache,
            fetchPage = { server.page(DocumentKind.IMAGE, it) },
            computation = UnconfinedTestDispatcher(testScheduler), sharing = SharingStarted.Eagerly,
        )
        assertTrue(preview.state.value.documents.failed)
    }

    @Test
    fun `a kind route argument picks its tab, and anything else opens Photos`() {
        assertEquals(BrowseTab.PHOTOS, kindTabOf("photos"))
        assertEquals(BrowseTab.VIDEOS, kindTabOf("VIDEOS"))
        assertEquals(BrowseTab.FILES, kindTabOf("Files"))
        // The dashboard's own feed is not a kind screen, and a missing or unknown argument must not crash the route.
        assertEquals(BrowseTab.PHOTOS, kindTabOf("all"))
        assertEquals(BrowseTab.PHOTOS, kindTabOf("nonsense"))
        assertEquals(BrowseTab.PHOTOS, kindTabOf(null))
    }
}
