package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import org.junit.Assert.assertEquals
import org.junit.Test

/** What a delete asks, and how a selection is cut into the requests that move or delete it. */
class ManageRulesTest {
    private fun FolderWithChildren.holding(files: Int) = copy(kind_counts = KindCountsDto(file = files))

    private fun messageFor(folder: FolderWithChildren) = trashQuestion(Picked(folders = listOf(folder))).message

    private fun file(id: String, folderId: String?, name: String = "$id.pdf") = PickedDocument(id, folderId, name)

    private val japan = node("Japan", parent = "Trips")
    private val trips = node("Trips", children = listOf(japan))
    private val receipts = node("Receipts")
    private val tree = FolderTree(listOf(trips, receipts))

    private fun requests(steps: List<PickedStep>) = steps.map { step ->
        when (step) {
            is PickedStep.Documents -> step.documents.joinToString(",") { it.id }
            is PickedStep.Folder -> step.folder.id
        } to step.settles
    }

    @Test fun `an empty folder says so`() {
        assertEquals("The folder is empty. You can restore it from Trash.", messageFor(node("Trips")))
    }

    @Test fun `one thing goes, several go`() {
        assertEquals("1 file goes to Trash with it. You can restore it from Trash.", messageFor(node("Trips").holding(1)))
        assertEquals("12 files go to Trash with it. You can restore it from Trash.", messageFor(node("Trips").holding(12)))
    }

    @Test fun `folders at any depth are counted with the files of the whole subtree`() {
        val deep = node("Japan", parent = "Asia")
        val asia = node("Asia", parent = "Trips", children = listOf(deep))
        val trips = node("Trips", children = listOf(asia)).holding(27)

        assertEquals("2 folders and 27 files go to Trash with it. You can restore it from Trash.", messageFor(trips))
    }

    @Test fun `an open private folder's files are added and a locked one is only named`() {
        val inside = node("Taxes", parent = "Safe", lockId = "Safe").holding(2)
        val open = node("Safe", parent = "Home", isPrivate = true, children = listOf(inside)).holding(5)
        val closed = node("Diary", parent = "Home", isPrivate = true, locked = true)
        val home = node("Home", children = listOf(open, closed)).holding(3)

        assertEquals(
            "2 folders, 8 files and 1 locked folder go to Trash with it. You can restore it from Trash.",
            messageFor(home),
        )
    }

    @Test fun `a locked folder names no counts`() {
        val closed = node("Diary", isPrivate = true, locked = true)

        assertEquals("Everything locked inside it goes to Trash with it. You can restore it from Trash.", messageFor(closed))
    }

    @Test fun `a single file is named`() {
        assertEquals(
            TrashQuestion("Move “a.pdf” to Trash?", "You can restore it from Trash."),
            trashQuestion(Picked(documents = listOf(file("a", null)))),
        )
    }

    @Test fun `several items are counted, and a folder among them says it takes its contents`() {
        val files = listOf(file("a", null), file("b", null))

        assertEquals(
            TrashQuestion("Move 2 files to Trash?", "You can restore them from Trash."),
            trashQuestion(Picked(documents = files)),
        )
        assertEquals(
            TrashQuestion(
                "Move 1 folder and 2 files to Trash?",
                "Everything in the folder goes with it. You can restore them from Trash.",
            ),
            trashQuestion(Picked(documents = files, folders = listOf(trips))),
        )
        assertEquals(
            "Everything in the folders goes with them. You can restore them from Trash.",
            trashQuestion(Picked(folders = listOf(trips, receipts))).message,
        )
    }

    @Test fun `documents go first, then one request per folder`() {
        val picked = Picked(documents = listOf(file("a", null), file("b", null)), folders = listOf(trips, receipts))

        assertEquals(
            listOf("a,b" to setOf("a", "b"), "Trips" to setOf("Trips"), "Receipts" to setOf("Receipts")),
            requests(toSteps(picked, tree)),
        )
    }

    @Test fun `what lies inside a picked folder goes with it and is settled by its request`() {
        val picked = Picked(
            documents = listOf(file("deep", "Japan"), file("loose", null)),
            folders = listOf(japan, trips),
        )

        assertEquals(
            listOf("loose" to setOf("loose"), "Trips" to setOf("Trips", "Japan", "deep")),
            requests(toSteps(picked, tree)),
        )
    }

    @Test fun `a folder known only from a search hit is still found inside a picked one`() {
        // The hit does not tell the folder's parent; the tree does.
        val hit = node("Japan")
        val picked = Picked(folders = listOf(trips, hit))

        assertEquals(listOf("Trips" to setOf("Trips", "Japan")), requests(toSteps(picked, tree)))
    }

    @Test fun `what needs nothing done gets no request`() {
        val picked = Picked(documents = listOf(file("here", "Receipts")), folders = listOf(trips))

        val steps = toSteps(picked, tree, { it.folderId != "Receipts" }, { it.parent_id != null })

        assertEquals(emptyList<Any>(), requests(steps))
    }

    @Test fun `a folder that stays where it is takes nothing with it`() {
        val picked = Picked(
            documents = listOf(file("in", "Trips"), file("deep", "Japan")),
            folders = listOf(trips, japan),
        )

        // A move to the top level, where Trips already is.
        val steps = toSteps(picked, tree, { it.folderId != null }, { it.parent_id != null })

        assertEquals(listOf("in" to setOf("in"), "Japan" to setOf("Japan", "deep")), requests(steps))
    }

    @Test fun `documents sharing a name travel in one request`() {
        val others = (1..99).map { doc("d$it", name = "d$it.jpg").toPicked() }
        val twins = listOf(doc("t1", name = "twin.jpg"), doc("t2", name = "twin.jpg")).map { it.toPicked() }

        val batches = toBatches(others + twins)

        assertEquals(listOf(99, 2), batches.map { it.size })
        assertEquals(listOf("t1", "t2"), batches.last().map { it.id })
    }
}
