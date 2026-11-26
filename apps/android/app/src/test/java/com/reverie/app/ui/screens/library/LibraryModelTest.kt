package com.reverie.app.ui.screens.library

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.repository.PageResult
import com.reverie.app.ui.screens.browse.FakeServer
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryModelTest {

    private val documents = listOf(
        doc("p3", created = "2026-11-25T10:00:00Z"),
        doc("shot", created = "2026-11-24T10:00:00Z"),
        doc("v1", "video/mp4", created = "2026-11-23T10:00:00Z"),
        doc("f3", "application/pdf", created = "2026-11-22T10:00:00Z"),
        doc("f2", "text/plain", created = "2026-11-21T10:00:00Z"),
        doc("p1", created = "2026-11-20T10:00:00Z"),
    ).map { it.copy(thumbnail_blurhash = "LKO2?U%2Tw=w]~RBVZRi};RPxuwH") }

    private val loose = listOf(
        doc("l4", "text/plain", created = "2026-11-19T10:00:00Z"),
        doc("l3", "text/plain", created = "2026-11-18T10:00:00Z"),
        doc("l2", "text/plain", created = "2026-11-17T10:00:00Z"),
        doc("l1", "text/plain", created = "2026-11-16T10:00:00Z"),
    )

    /** The two lists' servers and the rest of the reads, with what was asked noted in [asked]. */
    private class Library(
        val all: FakeServer,
        val unfiled: FakeServer,
        private val documents: List<DocumentDto>,
    ) : LibraryReads {
        val asked = mutableListOf<String>()
        val tree = MutableStateFlow<List<FolderWithChildren>>(emptyList())
        val figures = MutableStateFlow<DocumentSummaryDto?>(null)
        var served = listOf(node("trips"))
        var searches = emptyList<QuickFilter>()
        var picks = emptyMap<DocumentKind, List<String>>()
        var isOffline = false

        private fun ask(what: String) {
            asked += what
            if (isOffline) error("offline")
        }

        override suspend fun page(offset: Int): PageResult {
            if (isOffline) error("offline")
            return all.page(DocumentFilter.ALL, offset)
        }

        override suspend fun unfiledPage(offset: Int): PageResult {
            if (isOffline) error("offline")
            return unfiled.page(DocumentFilter.ALL, offset)
        }

        override suspend fun preview(kind: DocumentKind): List<String> {
            ask("preview $kind")
            val ids = picks[kind].orEmpty()
            all.cache.update { rows -> (rows + documents.filter { it.id in ids }).distinctBy(DocumentDto::id) }
            return ids
        }

        override suspend fun summary() {
            ask("summary")
            figures.value = all.summary()
        }

        override suspend fun folders() {
            ask("folders")
            tree.value = served
        }

        override suspend fun smartViews(): List<QuickFilter> {
            ask("smart views")
            return searches
        }

        override suspend fun dropStale(keep: Set<String>) = all.dropStale(DocumentFilter.ALL, keep)
    }

    private class Fixture(val library: Library, val model: LibraryModel, val failures: MutableList<Throwable>) {
        val state: LibraryState get() = model.state.value
        val recentIds: List<String> get() = state.recent.documents.documents.map(DocumentDto::id)
    }

    private fun TestScope.start(
        inFolders: List<DocumentDto> = documents,
        inNone: List<DocumentDto> = loose,
        arrange: Library.() -> Unit = {},
    ): Fixture {
        val library = Library(FakeServer(inFolders), FakeServer(inNone), inFolders).apply(arrange)
        val failures = mutableListOf<Throwable>()
        val model = LibraryModel(
            scope = backgroundScope as CoroutineScope,
            cache = library.all.cache,
            unfiledCache = library.unfiled.cache,
            tree = library.tree,
            summary = library.figures,
            reads = library,
            onFirstPageFailed = { failures += it },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(library, model, failures)
    }

    private fun search(id: String) = QuickFilter(id = id, label = id, query = "q:$id", count = 3)

    @Test fun `opening reads the folders, the figures and the first of what was added`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start()

            assertTrue("folders" in f.library.asked)
            assertEquals(listOf("trips"), f.state.folders.map(FolderWithChildren::id))
            assertEquals(6, f.state.total)
            assertEquals(listOf("p3", "shot"), f.recentIds)
            assertFalse(f.state.hasNoDocuments)
        }

    @Test fun `the documents in no folder come with how many there are`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()

        assertEquals(listOf("l4", "l3"), f.state.unfiledRows.map(DocumentDto::id))
        assertEquals(4, f.state.unfiled.total)
    }

    @Test fun `only three of the documents in no folder are listed`() {
        val state = LibraryState(unfiled = FeedDocuments(loose, total = 4))

        assertEquals(listOf("l4", "l3", "l2"), state.unfiledRows.map(DocumentDto::id))
    }

    @Test fun `with nothing outside folders there are no rows for it`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(inNone = emptyList())

        assertTrue(f.state.unfiledRows.isEmpty())
    }

    @Test fun `the ready-made searches come in the Library's order, without those the server leaves out`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start { searches = listOf(search("large-files"), search("this-week"), search("screenshots")) }

            assertEquals(listOf("screenshots", "large-files"), f.state.smartViews.map(QuickFilter::id))
        }

    @Test fun `a kind card shows the server's first pick, whatever was uploaded after it`() =
        runTest(UnconfinedTestDispatcher()) {
            // The screenshot is newer than p1, and the server still ranks p1 above it.
            val f = start { picks = mapOf(DocumentKind.IMAGE to listOf("p1", "shot")) }

            assertEquals("p1", f.state.covers.photo?.id)
        }

    @Test fun `a pick without a picture gives way to the next one`() {
        val blank = doc("new", created = "2026-11-26T10:00:00Z")

        val covers = kindCovers(documents + blank, mapOf(DocumentKind.IMAGE to listOf("new", "p1")))

        assertEquals("p1", covers.photo?.id)
    }

    @Test fun `without the server's picks the cards use the newest cached documents`() {
        val covers = kindCovers(documents, previews = emptyMap())

        assertEquals("p3", covers.photo?.id)
        assertEquals("v1", covers.video?.id)
        assertEquals(listOf("f3", "f2"), covers.files.map(DocumentDto::id))
    }

    @Test fun `the files card takes the four newest files, with a picture or without`() {
        val files = (1..5).map { doc("new$it", "application/pdf") }
        val pictured = files.map { if (it.id == "new5") it.copy(thumbnail_blurhash = "LKO2?U%2Tw=w") else it }
        val covers = kindCovers(pictured, mapOf(DocumentKind.FILE to pictured.map(DocumentDto::id)))

        assertEquals(listOf("new1", "new2", "new3", "new4"), covers.files.map(DocumentDto::id))
    }

    @Test fun `a kind the server has no picks for has no cover`() {
        val covers = kindCovers(documents, mapOf(DocumentKind.IMAGE to emptyList()))

        assertNull(covers.photo)
    }

    @Test fun `offline reports one failure and claims nothing about the library`() = runTest(UnconfinedTestDispatcher()) {
        val f = start { isOffline = true }

        assertEquals(1, f.failures.size)
        assertNull(f.state.total)
        assertFalse(f.state.hasNoDocuments)
        assertTrue(f.state.isEmpty)
    }

    @Test fun `what was read before stays when a later read fails`() = runTest(UnconfinedTestDispatcher()) {
        val f = start { searches = listOf(search("receipts")) }

        f.library.isOffline = true
        f.model.refresh()

        assertEquals(6, f.state.total)
        assertEquals(listOf("receipts"), f.state.smartViews.map(QuickFilter::id))
        assertEquals(listOf("trips"), f.state.folders.map(FolderWithChildren::id))
        assertEquals(listOf("p3", "shot"), f.recentIds)
    }

    @Test fun `a refresh and a content change read everything again`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()
        val everything = setOf("summary", "folders", "smart views") + DocumentKind.entries.map { "preview $it" }

        listOf<() -> Unit>({ f.model.refresh() }, f.model::contentChanged).forEach { change ->
            f.library.asked.clear()
            f.library.all.requests.clear()
            f.library.unfiled.requests.clear()

            change()

            assertEquals(everything, f.library.asked.toSet())
            assertEquals(DocumentFilter.ALL to 0, f.library.all.requests.first())
            assertEquals(DocumentFilter.ALL to 0, f.library.unfiled.requests.first())
        }
    }

    @Test fun `only Recently added pages on`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()

        f.model.loadMore()

        assertEquals(listOf("p3", "shot", "v1", "f3"), f.recentIds)
        assertEquals(1, f.library.unfiled.requests.size)
    }

    @Test fun `a document deleted elsewhere leaves Recently added once the list has been read to its end`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start()
            f.model.loadMore()
            f.library.all.deleteElsewhere("shot")

            f.model.refresh()
            repeat(3) { f.model.loadMore() }

            assertEquals(listOf("p3", "v1", "f3", "f2", "p1"), f.recentIds)
        }

    @Test fun `each section swipes through its own list`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()

        assertEquals(listOf("p3", "shot"), f.model.prepareSequence(LibrarySection.RECENT).initialIds)
        assertEquals(listOf("l4", "l3"), f.model.prepareSequence(LibrarySection.UNFILED).initialIds)
    }

    @Test fun `one selection covers both lists`() = runTest(UnconfinedTestDispatcher()) {
        val f = start()

        f.model.selection.toggle("p3")
        f.model.selection.toggle("l4")
        assertEquals(setOf("p3", "l4"), f.state.selectedIds)

        f.model.selection.clear()
        assertTrue(f.state.selectedIds.isEmpty())
    }
}
