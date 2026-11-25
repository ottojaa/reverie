package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderModelTest {

    private val photos = listOf(
        // p1 was taken after p3 but uploaded before it: the two orders differ.
        doc("p3", created = "2026-11-23T10:00:00Z", taken = "2026-06-01T10:00:00Z"),
        doc("p2", created = "2026-11-22T10:00:00Z", taken = "2026-06-02T10:00:00Z"),
        doc("p1", created = "2026-11-21T10:00:00Z", taken = "2026-06-03T10:00:00Z"),
    )
    private val files = listOf(
        doc("f2", "application/pdf", created = "2026-11-25T12:00:00Z"),
        doc("f1", "text/plain", created = "2026-11-20T12:00:00Z"),
    )

    private class Fixture(
        val server: FakeServer,
        val model: FolderModel,
        val summary: MutableStateFlow<DocumentSummaryDto?>,
    ) {
        val state: FolderState get() = model.state.value
        val ids: List<String> get() = state.feed.documents.documents.map(DocumentDto::id)
        val chips: List<Pair<DocumentKind?, Int?>> get() = state.chips.map { it.kind to it.count }
    }

    private fun TestScope.start(server: FakeServer, online: Boolean = true): Fixture {
        val summary = MutableStateFlow<DocumentSummaryDto?>(null)
        val model = FolderModel(
            scope = backgroundScope as CoroutineScope,
            cache = server.cache,
            summary = summary,
            fetchPage = { kind, offset -> server.page(kind?.let(DocumentFilter::of) ?: DocumentFilter.ALL, offset) },
            fetchSummary = { if (online) server.summary().also { summary.value = it } else error("offline") },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(server, model, summary)
    }

    @Test fun `the chips count what the server says the folder holds, and leave out the kinds it doesn't`() = runTest(UnconfinedTestDispatcher()) {
        // One page is two rows: the counts are the folder's, not the loaded rows'.
        val f = start(FakeServer(photos + files))

        assertEquals(listOf<Pair<DocumentKind?, Int?>>(null to 5, DocumentKind.IMAGE to 3, DocumentKind.FILE to 2), f.chips)
        assertEquals(5, f.state.total)
        assertEquals(null, f.state.matching)
    }

    @Test fun `a folder holding one kind has no chip row`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos))

        assertEquals(emptyList<Pair<DocumentKind?, Int?>>(), f.chips)
        assertEquals(3, f.state.total)
    }

    @Test fun `without a summary the chips are the cached rows' kinds, uncounted`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(emptyList())
        server.cache.value = photos + files
        server.failNext = true
        val f = start(server, online = false)

        assertEquals(listOf<Pair<DocumentKind?, Int?>>(null to null, DocumentKind.IMAGE to null, DocumentKind.FILE to null), f.chips)
        assertEquals(null, f.state.total)
    }

    @Test fun `a chip's list is read the first time it is selected, and kept`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        assertEquals(listOf(DocumentFilter.ALL to 0), f.server.requests)

        f.model.select(DocumentKind.IMAGE)
        f.model.loadMore()
        // Photos go by date taken.
        assertEquals(listOf("p1", "p2", "p3"), f.ids)
        assertEquals(3, f.state.matching)
        f.model.select(null)
        f.model.select(DocumentKind.IMAGE)

        assertEquals(listOf("p1", "p2", "p3"), f.ids)
        assertEquals(
            listOf(DocumentFilter.ALL to 0, DocumentFilter.IMAGES to 0, DocumentFilter.IMAGES to 2),
            f.server.requests,
        )
    }

    @Test fun `the viewer swipes through the shown chip's documents, in its order`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        assertEquals(listOf("f2", "p3"), f.model.prepareSequence().initialIds)

        f.model.select(DocumentKind.IMAGE)
        val sequence = f.model.prepareSequence()

        assertEquals(listOf("p1", "p2"), sequence.initialIds)
        sequence.loadMore()
        assertEquals(listOf("p1", "p2", "p3"), sequence.ids.first())
        assertEquals(DocumentFilter.IMAGES to 2, f.server.requests.last())
    }

    @Test fun `a selection belongs to the shown list and ends when the chip changes`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        f.model.enterSelection(listOf("f2"))
        f.model.toggleSelect(listOf("p3"))
        assertEquals(setOf("f2", "p3"), f.model.selectedIds)
        assertEquals(setOf("f2", "p3"), f.state.feed.selectedIds)

        f.model.select(DocumentKind.IMAGE)
        assertTrue(f.model.selectedIds.isEmpty())
        f.model.select(null)

        assertTrue(f.state.feed.selectedIds.isEmpty())
    }

    @Test fun `after a delete the counts and every list read so far follow the server`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        f.model.select(DocumentKind.IMAGE)
        f.server.delete("p1")

        f.model.contentChanged()

        assertEquals(4, f.state.total)
        assertEquals(2, f.state.matching)
        assertEquals(listOf("p2", "p3"), f.ids)
        f.model.select(null)
        assertEquals(4, f.state.feed.documents.total)
    }

    @Test fun `losing the selected kind's last document goes back to All`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        f.model.select(DocumentKind.FILE)
        f.server.delete("f2", "f1")

        f.model.contentChanged()

        assertEquals(null, f.state.selected)
        assertEquals(emptyList<Pair<DocumentKind?, Int?>>(), f.chips)
        assertEquals(listOf("p3", "p2"), f.ids)
    }

    @Test fun `a locked folder shows nothing of what was read before it locked`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))

        val locked = f.state.unlessLocked(true)

        assertTrue(locked.chips.isEmpty())
        assertTrue(locked.feed.documents.documents.isEmpty())
        assertEquals("Trips", folderPageSubtitle(locked.total, locked.matching, "Trips"))
        assertEquals(f.state, f.state.unlessLocked(false))
    }

    @Test fun `pull to refresh re-reads the figures and every list read so far`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos + files))
        f.model.select(DocumentKind.FILE)
        val asked = f.server.requests.size

        f.model.refresh()

        assertEquals(setOf(DocumentFilter.FILES to 0, DocumentFilter.ALL to 0), f.server.requests.drop(asked).toSet())
    }
}
