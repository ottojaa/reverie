package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import org.junit.Assert.assertEquals
import org.junit.Test

/** What a delete says goes with the folder, and how a large move is cut into requests. */
class ManageRulesTest {
    private fun FolderWithChildren.holding(files: Int) = copy(kind_counts = KindCountsDto(file = files))

    @Test fun `an empty folder says so`() {
        assertEquals("The folder is empty.", trashMessage(node("Trips")))
    }

    @Test fun `one thing goes, several go`() {
        assertEquals("1 file goes to the trash with it.", trashMessage(node("Trips").holding(1)))
        assertEquals("12 files go to the trash with it.", trashMessage(node("Trips").holding(12)))
    }

    @Test fun `folders at any depth are counted with the files of the whole subtree`() {
        val deep = node("Japan", parent = "Asia")
        val asia = node("Asia", parent = "Trips", children = listOf(deep))
        val trips = node("Trips", children = listOf(asia)).holding(27)

        assertEquals("2 folders and 27 files go to the trash with it.", trashMessage(trips))
    }

    @Test fun `an open private folder's files are added and a locked one is only named`() {
        val inside = node("Taxes", parent = "Safe", lockId = "Safe").holding(2)
        val open = node("Safe", parent = "Home", isPrivate = true, children = listOf(inside)).holding(5)
        val closed = node("Diary", parent = "Home", isPrivate = true, locked = true)
        val home = node("Home", children = listOf(open, closed)).holding(3)

        assertEquals("2 folders, 8 files and 1 locked folder go to the trash with it.", trashMessage(home))
    }

    @Test fun `a locked folder names no counts`() {
        val closed = node("Diary", isPrivate = true, locked = true)

        assertEquals("Everything locked inside it goes to the trash with it.", trashMessage(closed))
    }

    @Test fun `documents sharing a name travel in one request`() {
        val others = (1..99).map { doc("d$it", name = "d$it.jpg") }
        val twins = listOf(doc("t1", name = "twin.jpg"), doc("t2", name = "twin.jpg"))

        val batches = toMoveBatches(others + twins)

        assertEquals(listOf(99, 2), batches.map { it.size })
        assertEquals(listOf("t1", "t2"), batches.last().map { it.id })
    }
}
