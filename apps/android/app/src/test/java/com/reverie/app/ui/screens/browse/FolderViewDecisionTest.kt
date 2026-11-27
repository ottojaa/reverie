package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.settings.FolderChoices
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.screens.destination.node
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneOffset

/** Whether a folder opens as a grid or a list, and what its one feed lists for it. */
class FolderViewDecisionTest {

    private val photos = listOf(doc("p2", created = "2026-11-22T10:00:00Z"), doc("p1", created = "2026-11-21T10:00:00Z"))
    private val video = doc("v1", "video/mp4", created = "2026-11-23T10:00:00Z")
    private val pdf = doc("f1", "application/pdf", created = "2026-11-24T10:00:00Z")

    /** A folder with a folder in it: its tree counts cover both, so they don't say what is its own. */
    private fun parentCounting(counts: KindCountsDto) =
        listOf(node("lisbon", children = listOf(node("belem", parent = "lisbon"))).copy(kind_counts = counts))

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 26), ZoneOffset.UTC)

    @Test fun `a folder of photos and videos opens as a grid, read by date taken`() = runTest(UnconfinedTestDispatcher()) {
        val taken = photos + video.copy(taken_at = "2026-06-01T10:00:00Z")

        val f = openFolder(FakeServer(taken))

        assertEquals(FolderView.GRID, f.state.view)
        assertEquals(DocumentFilter.MEDIA, f.state.filter)
        assertEquals(listOf(DocumentFilter.MEDIA to 0), f.server.requests)
        // The video was uploaded last and taken first.
        assertEquals(listOf("p2", "p1"), f.ids)
    }

    @Test fun `one file among the photos opens the folder as a list of everything`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos + video + pdf))

        assertEquals(FolderView.LIST, f.state.view)
        assertEquals(listOf(DocumentFilter.ALL to 0), f.server.requests)
        assertEquals(listOf("f1", "v1"), f.ids)
    }

    @Test fun `an empty folder opens as a list`() = runTest(UnconfinedTestDispatcher()) {
        assertEquals(FolderView.LIST, openFolder(FakeServer(emptyList())).state.view)
    }

    @Test fun `the root is a list even when it holds only photos`() = runTest(UnconfinedTestDispatcher()) {
        assertEquals(FolderView.LIST, openFolder(FakeServer(photos), folderId = null).state.view)
    }

    @Test fun `a summary already in memory decides at once`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(photos)

        val f = openFolder(server, folders = emptyList(), figures = server.summary(), fetchSummary = { awaitCancellation() })

        assertEquals(FolderView.GRID, f.state.view)
    }

    @Test fun `a folder with no folders inside is decided from the tree, without waiting for the server`() =
        runTest(UnconfinedTestDispatcher()) {
            val grid = openFolder(FakeServer(photos), fetchSummary = { awaitCancellation() })
            val list = openFolder(FakeServer(photos + pdf), fetchSummary = { awaitCancellation() })

            assertEquals(FolderView.GRID, grid.state.view)
            assertEquals(FolderView.LIST, list.state.view)
        }

    @Test fun `cached photos do not make a mixed folder a grid, and nothing is drawn until the server says`() =
        runTest(UnconfinedTestDispatcher()) {
            val server = FakeServer(photos + pdf)
            // As the Photos tab leaves the cache: this folder's photos, its other files never read.
            server.cache.value = photos
            val answer = CompletableDeferred<DocumentSummaryDto>()

            val f = openFolder(server, folders = parentCounting(KindCountsDto(image = 2, file = 4)), fetchSummary = { answer.await() })

            assertNull(f.state.view)
            assertTrue(f.state.documents.documents.isEmpty())
            assertTrue(folderRows(f.state, 360f, layout).isEmpty())
            assertTrue(server.requests.isEmpty())

            answer.complete(server.summary())

            assertEquals(FolderView.LIST, f.state.view)
            assertEquals(listOf(DocumentFilter.ALL to 0), server.requests)
        }

    @Test fun `cached photos are enough when the tree counts no file anywhere beneath`() = runTest(UnconfinedTestDispatcher()) {
        val server = FakeServer(photos)
        server.cache.value = photos

        val f = openFolder(server, folders = parentCounting(KindCountsDto(image = 9)), fetchSummary = { awaitCancellation() })

        assertEquals(FolderView.GRID, f.state.view)
    }

    @Test fun `offline, the cached rows decide, and with none the page is a list`() = runTest(UnconfinedTestDispatcher()) {
        val cached = FakeServer(photos)
        cached.cache.value = photos
        val unknown = emptyList<FolderWithChildren>()

        val grid = openFolder(cached, folders = unknown, fetchSummary = { throw IOException("offline") })
        val list = openFolder(FakeServer(photos), folders = unknown, fetchSummary = { throw IOException("offline") })

        assertEquals(FolderView.GRID, grid.state.view)
        assertEquals(FolderView.LIST, list.state.view)
    }

    @Test fun `a locked folder asks to be unlocked and is decided by what is read afterwards`() =
        runTest(UnconfinedTestDispatcher()) {
            val server = FakeServer(photos)

            // A locked folder's tree counts are all zero.
            val f = openFolder(server, folders = treeHolding(emptyList()), isLockRefusal = true, fetchSummary = { error("locked") })

            assertEquals(1, f.failures.size)
            assertNull(f.state.view)
            assertTrue(server.requests.isEmpty())

            f.summary.value = server.summary()

            assertEquals(FolderView.GRID, f.state.view)
            assertEquals(listOf(DocumentFilter.MEDIA to 0), server.requests)
        }

    @Test fun `a page drawn as a list never turns into a grid`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos + pdf))
        val views = mutableListOf<FolderView?>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { f.model.state.collect { views += it.view } }

        // The only file goes: from now on the folder holds photos only.
        f.server.delete("f1")
        f.model.contentChanged()
        f.model.refresh()

        assertEquals(0, f.state.summary?.file?.count)
        assertEquals(listOf(FolderView.LIST), views.distinct())
    }

    @Test fun `a file that turns up in a folder of photos is listed too, in the grid the page opened as`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = openFolder(FakeServer(photos))
            val views = mutableListOf<FolderView?>()
            backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { f.model.state.collect { views += it.view } }

            f.server.add(pdf)
            f.model.contentChanged()

            assertEquals(DocumentFilter.ALL, f.state.filter)
            assertEquals(DocumentFilter.ALL to 0, f.server.requests.last())
            assertEquals(listOf("f1", "p2"), f.ids)
            assertEquals(listOf(FolderView.GRID), views.distinct())
        }

    @Test fun `a view chosen for the page overrides the folder's own, and reads nothing again`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = openFolder(FakeServer(photos + pdf))
            val shown = f.ids
            val asked = f.server.requests.size

            f.choices.value = FolderChoices(view = FolderView.GRID)

            assertEquals(FolderView.GRID, f.state.view)
            assertEquals(shown, f.ids)
            assertEquals(asked, f.server.requests.size)
        }

    @Test fun `a view chosen earlier is how the page opens, over the same feed`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos), chosen = FolderChoices(view = FolderView.LIST))

        assertEquals(FolderView.LIST, f.state.view)
        assertEquals(DocumentFilter.MEDIA, f.state.filter)
    }

    @Test fun `a cached tree that is behind the server hides no file`() =
        runTest(UnconfinedTestDispatcher()) {
            // The cached tree is behind: it counts no file, the server holds one.
            val f = openFolder(FakeServer(photos + pdf), folders = treeHolding(photos))

            assertEquals(FolderView.GRID, f.state.view)
            assertEquals(DocumentFilter.ALL, f.state.filter)
            assertEquals(listOf("f1", "p2"), f.ids)
        }
}
