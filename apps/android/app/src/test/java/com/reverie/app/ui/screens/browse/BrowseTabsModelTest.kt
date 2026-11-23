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

class BrowseTabsModelTest {

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

    /** The remembered tab as the settings store would hold it: it outlives a model, like a restart does. */
    private class SavedTab(var tab: BrowseTab? = null)

    private class Fixture(val server: FakeServer, val model: BrowseTabsModel, val saved: SavedTab, val failures: MutableList<Throwable>)

    private fun TestScope.start(server: FakeServer = FakeServer(library), saved: SavedTab = SavedTab()): Fixture {
        val failures = mutableListOf<Throwable>()
        val model = BrowseTabsModel(
            scope = backgroundScope as CoroutineScope,
            cache = server.cache,
            fetchPage = { kind, offset -> server.page(kind, offset) },
            loadSavedTab = { saved.tab ?: BrowseTab.ALL },
            saveTab = { saved.tab = it },
            onFirstPageFailed = { failures += it },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(server, model, saved, failures)
    }

    private fun Fixture.ids(tab: BrowseTab) = model.state.value.tabs.getValue(tab).documents.map { it.id }

    @Test fun `browse opens on All and costs one list request`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        assertEquals(listOf<Pair<DocumentKind?, Int>>(null to 0), f.server.requests)
        assertEquals(BrowseTab.ALL, f.model.state.value.tab)
        assertTrue(f.model.state.value.ready)
        assertEquals(11, f.model.state.value.current.total)
    }

    @Test fun `a tab fetches its first page the first time it is shown and not again`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(listOf<Pair<DocumentKind?, Int>>(null to 0, DocumentKind.IMAGE to 0), f.server.requests)
        f.model.selectTab(BrowseTab.ALL)
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(2, f.server.requests.size)
    }

    @Test fun `switching tabs keeps each tab's loaded pages`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.PHOTOS)
        f.model.loadMore()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids(BrowseTab.PHOTOS))
        f.model.selectTab(BrowseTab.VIDEOS)
        f.model.selectTab(BrowseTab.FILES)
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids(BrowseTab.PHOTOS))
        assertEquals(5, f.model.state.value.current.total)
        assertTrue(f.model.state.value.current.hasMore)
        // Going back did not ask the server for anything it already had.
        assertEquals(listOf(null to 0, DocumentKind.IMAGE to 0, DocumentKind.IMAGE to 2, DocumentKind.VIDEO to 0, DocumentKind.FILE to 0), f.server.requests)
    }

    @Test fun `a tab hides cached rows that lie beyond what it has read`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        // The All page cached p5 and v3/f3-era rows; the Photos tab has read nothing beyond p5/p4 yet.
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(listOf("p5", "p4"), f.ids(BrowseTab.PHOTOS))
        assertFalse("p1 is not cached yet", "p1" in f.ids(BrowseTab.PHOTOS))
    }

    @Test fun `selection clears when the tab changes`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.enterSelection("p5")
        f.model.toggleSelect("f3")
        assertEquals(setOf("p5", "f3"), f.model.state.value.selectedIds)
        f.model.selectTab(BrowseTab.FILES)
        assertTrue(f.model.state.value.selectedIds.isEmpty())
    }

    @Test fun `re-selecting the open tab keeps the selection`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.enterSelection("p5")
        f.model.selectTab(BrowseTab.ALL)
        assertEquals(setOf("p5"), f.model.state.value.selectedIds)
    }

    @Test fun `the viewer sequence holds only the open tab and loads more of that tab`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.VIDEOS)
        val sequence = f.model.prepareSequence()
        assertEquals(listOf("v3", "v2"), sequence.initialIds)
        sequence.loadMore()
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
        assertEquals(DocumentKind.VIDEO to 2, f.server.requests.last())
        // Another tab opening later does not change what this sequence holds.
        f.model.selectTab(BrowseTab.FILES)
        assertEquals(listOf("v3", "v2", "v1"), sequence.ids.first())
    }

    @Test fun `loading more of a tab with nothing left asks for nothing`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.VIDEOS)
        f.model.loadMore()
        val asked = f.server.requests.size
        f.model.loadMore()
        assertEquals(asked, f.server.requests.size)
        assertFalse(f.model.state.value.current.hasMore)
    }

    @Test fun `the remembered tab survives a restart`() = runTest(UnconfinedTestDispatcher()) {
        val first = start()
        first.model.selectTab(BrowseTab.FILES)
        val restarted = start(server = FakeServer(library), saved = first.saved)
        assertEquals(BrowseTab.FILES, restarted.model.state.value.tab)
        assertEquals(listOf<Pair<DocumentKind?, Int>>(DocumentKind.FILE to 0), restarted.server.requests)
        assertEquals(listOf("f3", "f2"), restarted.ids(BrowseTab.FILES))
    }

    @Test fun `refreshing the first page starts the tab's offset over without hiding what it showed`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.PHOTOS)
        f.model.loadMore()
        f.model.refresh()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids(BrowseTab.PHOTOS))
        f.model.loadMore()
        assertEquals(DocumentKind.IMAGE to 2, f.server.requests.last())
    }

    @Test fun `after deleting rows above what a tab read, scrolling on skips none of the server's rows`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.PHOTOS)
        f.model.loadMore()
        assertEquals(listOf("p5", "p4", "p3", "p2"), f.ids(BrowseTab.PHOTOS))
        // Two photos at the top go; every row below them moves up two places on the server.
        f.server.delete("p5", "p4")
        f.model.contentChanged()
        f.model.loadMore()
        f.model.loadMore()
        assertEquals(listOf("p3", "p2", "p1"), f.ids(BrowseTab.PHOTOS))
        assertEquals(3, f.model.state.value.current.total)
        assertFalse(f.model.state.value.current.hasMore)
    }

    @Test fun `a tab that was not open when rows were deleted re-reads its first page when it is shown`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        f.model.selectTab(BrowseTab.PHOTOS)
        f.model.selectTab(BrowseTab.VIDEOS)
        f.server.delete("p5")
        f.model.contentChanged()
        // Only the open tab is read now.
        assertEquals(DocumentKind.VIDEO to 0, f.server.requests.last())
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(DocumentKind.IMAGE to 0, f.server.requests.last())
        assertEquals(4, f.model.state.value.current.total)
        assertEquals(listOf("p4", "p3"), f.ids(BrowseTab.PHOTOS))
        // Once re-read it is not stale any more.
        val asked = f.server.requests.size
        f.model.selectTab(BrowseTab.VIDEOS)
        f.model.selectTab(BrowseTab.PHOTOS)
        assertEquals(asked, f.server.requests.size)
    }

    @Test fun `a failed first page is reported and a failed later page is not`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(library)
        val f = start(server)
        server.failNext = true
        f.model.selectTab(BrowseTab.VIDEOS)
        assertEquals(1, f.failures.size)
        // Nothing was fetched for Videos, so it still shows only what the All page had cached.
        assertFalse(f.model.state.value.tabs.getValue(BrowseTab.VIDEOS).fetched)
        assertTrue(f.model.state.value.tabs.getValue(BrowseTab.VIDEOS).failed)
        assertEquals(listOf("v3"), f.ids(BrowseTab.VIDEOS))
        f.model.refresh(initial = true)
        f.model.loadMore()
        server.failNext = true
        f.model.loadMore()
        assertEquals(1, f.failures.size)
    }
}
