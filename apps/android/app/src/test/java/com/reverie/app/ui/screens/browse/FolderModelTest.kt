package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.MediaDatesDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.screens.destination.node
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class FolderModelTest {

    private val photos = listOf(
        // p1 was taken after p3 but uploaded before it: the two orders differ.
        doc("p3", created = "2026-11-23T10:00:00Z", taken = "2026-06-01T10:00:00Z"),
        doc("p2", created = "2026-11-22T10:00:00Z", taken = "2026-06-02T10:00:00Z"),
        doc("p1", created = "2026-11-21T10:00:00Z", taken = "2026-06-03T10:00:00Z"),
    )
    private val files = listOf(
        doc("f3", "application/pdf", created = "2026-11-25T12:00:00Z"),
        doc("f2", "text/plain", created = "2026-11-24T12:00:00Z"),
        doc("f1", "text/plain", created = "2026-11-20T12:00:00Z"),
    )

    private val leaf = node("lisbon", parent = "trips").copy(kind_counts = KindCountsDto(image = 3, file = 3))
    private val tree = listOf(node("trips", children = listOf(leaf)).copy(kind_counts = leaf.kind_counts))

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 26), ZoneOffset.UTC)

    private class Fixture(val server: FakeServer, val model: FolderModel, val failures: MutableList<Throwable>) {
        val state: FolderState get() = model.state.value
        val photoIds: List<String> get() = state.media.documents.map(DocumentDto::id)
        val fileIds: List<String>? get() = state.files?.documents?.map(DocumentDto::id)
    }

    private fun TestScope.start(
        server: FakeServer,
        folderId: String = "lisbon",
        isLockRefusal: Boolean = false,
    ): Fixture {
        val summary = MutableStateFlow<DocumentSummaryDto?>(null)
        val failures = mutableListOf<Throwable>()
        val model = FolderModel(
            scope = backgroundScope as CoroutineScope,
            folderId = folderId,
            tree = MutableStateFlow(tree),
            cache = server.cache,
            summary = summary,
            fetchPage = server::page,
            fetchSummary = { server.summary().also { summary.value = it } },
            reconcile = { filter, keep -> server.dropStale(filter, keep) },
            onFirstPageFailed = { failures += it },
            isLockRefusal = { isLockRefusal },
            computation = UnconfinedTestDispatcher(testScheduler),
            sharing = SharingStarted.Eagerly,
        )
        return Fixture(server, model, failures)
    }

    @Test fun `the folder is found in the tree with the folders above it`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(emptyList()))

        assertEquals("lisbon", f.state.node?.name)
        assertEquals(listOf("trips", "lisbon"), f.state.path.map(FolderWithChildren::id))
    }

    @Test fun `the other files are asked for once the photos and videos have been read to the end`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start(FakeServer(photos + files))
            assertEquals(listOf(DocumentFilter.MEDIA to 0), f.server.requests)
            assertNull(f.state.files)
            assertTrue(f.state.hasMore)

            f.model.loadMore()

            assertEquals(
                listOf(DocumentFilter.MEDIA to 0, DocumentFilter.MEDIA to 2, DocumentFilter.FILES to 0),
                f.server.requests,
            )
            // Photos go by date taken, files by upload time.
            assertEquals(listOf("p1", "p2", "p3"), f.photoIds)
            assertEquals(listOf("f3", "f2"), f.fileIds)

            f.model.loadMore()

            assertEquals(DocumentFilter.FILES to 2, f.server.requests.last())
            assertEquals(listOf("f3", "f2", "f1"), f.fileIds)
            assertEquals(false, f.state.hasMore)
        }

    @Test fun `a folder without photos shows its files straight away`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(files))

        assertEquals(listOf(DocumentFilter.MEDIA to 0, DocumentFilter.FILES to 0), f.server.requests)
        assertEquals(listOf("f3", "f2"), f.fileIds)
    }

    @Test fun `when the photos cannot be read, the files are still shown from the server or the cache`() =
        runTest(UnconfinedTestDispatcher()) {
            val server = FakeServer(files)
            server.failNext = true

            val f = start(server)

            assertEquals(1, f.failures.size)
            assertEquals(listOf("f3", "f2"), f.fileIds)
        }

    @Test fun `a lock refusal asks for nothing further`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(files)
        server.failNext = true

        val f = start(server, isLockRefusal = true)

        assertEquals(listOf(DocumentFilter.MEDIA to 0), f.server.requests)
        assertNull(f.state.files)
    }

    @Test fun `a selection spans both sections`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos.take(2) + files))

        f.model.selection.toggle("f3")
        f.model.selection.toggle("p3")

        assertEquals(setOf("f3", "p3"), f.state.selectedIds)
        f.model.selection.clear()
        assertTrue(f.state.selectedIds.isEmpty())
    }

    @Test fun `the viewer swipes through the opened document's section, in the order the page shows it`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start(FakeServer(photos + files))
            f.model.loadMore()

            val fileSequence = f.model.prepareSequence(files.first(), ZoneOffset.UTC)
            assertEquals(listOf("f3", "f2"), fileSequence.initialIds)
            fileSequence.loadMore()
            assertEquals(listOf("f3", "f2", "f1"), fileSequence.ids.first())

            assertEquals(listOf("p1", "p2", "p3"), f.model.prepareSequence(photos.first(), ZoneOffset.UTC).initialIds)
        }

    @Test fun `after a delete the figures and both sections follow the server`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos.take(2) + files.take(2)))
        f.server.delete("p3", "f2")

        f.model.contentChanged()

        assertEquals(1, f.state.summary?.image?.count)
        assertEquals(1, f.state.summary?.file?.count)
        assertEquals(listOf("p2"), f.photoIds)
        assertEquals(listOf("f3"), f.fileIds)
    }

    @Test fun `pull to refresh re-reads both sections`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos.take(2) + files.take(2)))
        val asked = f.server.requests.size

        f.model.refresh()

        assertEquals(
            setOf(DocumentFilter.MEDIA to 0, DocumentFilter.FILES to 0),
            f.server.requests.drop(asked).toSet(),
        )
    }

    @Test fun `a locked folder shows nothing of what was read before it locked`() = runTest(UnconfinedTestDispatcher()) {
        val f = start(FakeServer(photos.take(2) + files.take(2)))
        f.model.selection.toggle("p3")

        val locked = f.state.unlessLocked(true)

        assertTrue(locked.isEmptyOfDocuments)
        assertNull(locked.summary)
        assertTrue(locked.selectedIds.isEmpty())
        assertTrue(folderRows(locked, 360f, layout).isEmpty())
        assertEquals("lisbon", locked.node?.name)
        assertEquals(f.state, f.state.unlessLocked(false))
    }

    @Test fun `only a folder known to be public offers search`() {
        assertTrue(FolderState(node = leaf).isSearchable)
        assertFalse(FolderState(node = leaf.copy(is_private = true)).isSearchable)
        // Inside a private folder further up.
        assertFalse(FolderState(node = leaf.copy(lock_id = "trips")).isSearchable)
        assertFalse(FolderState().isSearchable)
    }

    @Test fun `a folder with both kinds names its two sections, and one day in both gives two headings`() {
        val sameDay = "2026-11-23T10:00:00Z"
        val state = FolderState(
            media = FeedDocuments(documents = listOf(doc("p", created = sameDay)), fetched = true),
            files = FeedDocuments(documents = listOf(doc("f", "application/pdf", created = sameDay)), fetched = true),
        )

        val rows = folderRows(state, 360f, layout)

        assertEquals(listOf("Photos and videos", "Files"), rows.filterIsInstance<FeedRow.Section>().map { it.title })
        assertEquals(2, rows.filterIsInstance<FeedRow.Heading>().size)
        assertEquals(rows.size, rows.map(FeedRow::key).toSet().size)
    }

    @Test fun `a folder holding one kind has date headings and no section titles`() {
        val state = FolderState(media = FeedDocuments(documents = photos, fetched = true))

        val rows = folderRows(state, 360f, layout)

        assertTrue(rows.none { it is FeedRow.Section })
        assertEquals(
            listOf("Wed 3 Jun", "Tue 2 Jun", "Mon 1 Jun"),
            rows.filterIsInstance<FeedRow.Heading>().map { it.header.title },
        )
    }

    @Test fun `the photos are titled before the files have been read, when the server counts some`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = start(FakeServer(photos + files))

            val rows = folderRows(f.state, 360f, layout)

            assertEquals(listOf("Photos and videos"), rows.filterIsInstance<FeedRow.Section>().map { it.title })
        }

    @Test fun `a folder's header says what its row says, and spans its photos' days when it has no folders`() {
        val dates = MediaDatesDto(first = "2026-08-21T09:00:00Z", last = "2026-08-25T18:00:00Z")
        val summary = DocumentSummaryDto(media_dates = dates)
        val parent = tree.single()

        assertEquals(folderMeta(parent), folderPageMeta(FolderState(node = parent, summary = summary)))
        assertEquals(folderMeta(leaf) + " · 21–25 Aug 2026", folderPageMeta(FolderState(node = leaf, summary = summary)))
        assertEquals(folderMeta(leaf), folderPageMeta(FolderState(node = leaf)))
        assertNull(folderPageMeta(FolderState()))
    }
}
