package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.settings.FolderChoices
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.destination.node
import kotlinx.coroutines.flow.first
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
        doc("p3", created = "2026-11-23T10:00:00Z"),
        doc("p2", created = "2026-11-22T10:00:00Z"),
        doc("p1", created = "2026-11-21T10:00:00Z"),
    )
    private val files = listOf(
        doc("f3", "application/pdf", created = "2026-11-25T12:00:00Z"),
        doc("f2", "text/plain", created = "2026-11-24T12:00:00Z"),
        doc("f1", "text/plain", created = "2026-11-20T12:00:00Z"),
    )

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 26), ZoneOffset.UTC)

    @Test fun `the folder is found in the tree with the folders above it`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(emptyList()))

        assertEquals("lisbon", f.state.node?.name)
        assertEquals(listOf("trips", "lisbon"), f.state.path.map(FolderWithChildren::id))
    }

    @Test fun `the root holds the top-level folders, under no folder of its own`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos), folderId = null)

        assertTrue(f.state.isRoot)
        assertNull(f.state.node)
        assertTrue(f.state.path.isEmpty())
        assertEquals(listOf("trips"), f.state.children.map(FolderWithChildren::id))
    }

    @Test fun `the folders inside come by name, whatever order the tree holds them in`() = runTest(UnconfinedTestDispatcher()) {
        val tree = listOf(node("zoo"), node("Beach"), node("alps"))

        val f = openFolder(FakeServer(emptyList()), folderId = null, folders = tree)

        assertEquals(listOf("alps", "Beach", "zoo"), f.state.children.map(FolderWithChildren::id))
    }

    @Test fun `search from the root looks through the whole library`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos), folderId = null)

        assertEquals(SearchScope.Library, f.state.searchScope)
    }

    @Test fun `only a folder known to be public offers search`() {
        val leaf = node("lisbon", parent = "trips")

        assertEquals(SearchScope.Folder("lisbon"), FolderState(node = leaf).searchScope)
        assertNull(FolderState(node = leaf.copy(is_private = true)).searchScope)
        // Inside a private folder further up.
        assertNull(FolderState(node = leaf.copy(lock_id = "trips")).searchScope)
        assertNull(FolderState().searchScope)
    }

    @Test fun `a mixed folder is one feed of everything in it, newest first, read page by page`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = openFolder(FakeServer(photos + files))
            assertEquals(listOf("f3", "f2"), f.ids)

            f.model.loadMore()
            f.model.loadMore()

            assertEquals(listOf("f3", "f2", "p3", "p2", "p1", "f1"), f.ids)
            assertEquals(List(3) { DocumentFilter.ALL }, f.server.requests.map { it.first })
            assertEquals(listOf(0, 2, 4), f.server.requests.map { it.second })
            assertFalse(f.state.documents.hasMore)
        }

    @Test fun `choosing an order reads the list again in that order, keeping the selection`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = openFolder(FakeServer(photos + files))
            f.model.selection.toggle("f3")

            f.choices.value = FolderChoices(sort = DocumentSort.NAME)

            assertEquals(DocumentSort.NAME, f.state.sort)
            assertEquals(DocumentSort.NAME, f.server.sorts.last())
            assertEquals(DocumentFilter.ALL to 0, f.server.requests.last())
            assertEquals(listOf("f1", "f2"), f.ids)
            assertEquals(setOf("f3"), f.state.selectedIds)
            f.model.loadMore()
            assertEquals(DocumentSort.NAME, f.server.sorts.last())
            assertEquals(listOf("f1", "f2", "f3", "p1"), f.ids)
        }

    @Test fun `when the first page cannot be read, that is reported and trying again reads it`() =
        runTest(UnconfinedTestDispatcher()) {
            val server = FakeServer(files)
            server.failNext = true

            val f = openFolder(server)
            assertEquals(1, f.failures.size)
            assertTrue(f.state.documents.failed)

            f.model.refresh(initial = true)

            assertEquals(listOf("f3", "f2"), f.ids)
        }

    @Test fun `a selection holds photos and files alike`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos.take(1) + files))

        f.model.selection.toggle("f3")
        f.model.selection.toggle("p3")

        assertEquals(setOf("f3", "p3"), f.state.selectedIds)
        f.model.selection.clear()
        assertTrue(f.state.selectedIds.isEmpty())
    }

    @Test fun `the viewer swipes through the page's documents in the order shown, reading on at the end`() =
        runTest(UnconfinedTestDispatcher()) {
            val f = openFolder(FakeServer(photos + files))

            val sequence = f.model.prepareSequence()
            assertEquals(listOf("f3", "f2"), sequence.initialIds)
            sequence.loadMore()

            assertEquals(listOf("f3", "f2", "p3", "p2"), sequence.ids.first())
        }

    @Test fun `after a delete the figures and the list follow the server`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos.take(2) + files.take(2)))
        f.server.delete("p3", "f2")

        f.model.contentChanged()

        assertEquals(1, f.state.summary?.image?.count)
        assertEquals(1, f.state.summary?.file?.count)
        assertEquals(listOf("f3", "p2"), f.ids)
    }

    @Test fun `pull to refresh re-reads the figures and the first page`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos.take(2) + files.take(2)))
        val asked = f.server.requests.size
        f.server.add(files.last())

        f.model.refresh()

        assertEquals(listOf(DocumentFilter.ALL to 0), f.server.requests.drop(asked))
        assertEquals(3, f.state.summary?.file?.count)
    }

    @Test fun `a locked folder shows nothing of what was read before it locked`() = runTest(UnconfinedTestDispatcher()) {
        val f = openFolder(FakeServer(photos.take(2) + files.take(2)))
        f.model.selection.toggle("p3")
        assertEquals(FolderView.LIST, f.state.view)

        val locked = f.state.unlessLocked(true)

        assertTrue(locked.isEmptyOfDocuments)
        assertNull(locked.summary)
        assertTrue(locked.selectedIds.isEmpty())
        assertTrue(folderRows(locked, 360f, layout).isEmpty())
        assertEquals("lisbon", locked.node?.name)
        assertEquals(f.state, f.state.unlessLocked(false))
    }
}
