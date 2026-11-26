package com.reverie.app.ui.screens.manage

import com.reverie.app.data.api.model.ConflictStrategy
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import io.ktor.http.HttpStatusCode
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** What acting on a selection sends to the server, and what it asks on the way. */
class ManageControllerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val world = FavouriteWorld()
    private val manage = ManageController(world.folders, world.documents, world.vault, world.controller(), scope)
    private val trips = node("Trips", children = listOf(node("Japan", parent = "Trips")))
    private val vaulted = node("Vaulted", isPrivate = true, locked = true)
    /** The ids the controller said it was done with, in the order it said so. */
    private val gone = CopyOnWriteArrayList<Set<String>>()

    @Before fun setUp() {
        world.tree = listOf(trips, node("Receipts"), vaulted)
        runBlocking { world.folders.refresh() }
    }

    @After fun tearDown() = scope.cancel()

    private fun file(id: String, folderId: String?, name: String = "$id.pdf"): DocumentDto =
        doc(id, "application/pdf", name = name).copy(folder_id = folderId)

    private fun move(vararg documents: DocumentDto, to: String? = "Receipts") {
        manage.pickDestination(Picked(documents = documents.map { it.toPicked() })) { gone += it }
        manage.moveTo(Destination(to, to ?: "My files"))
    }

    private fun trash(picked: Picked) {
        manage.askToTrash(picked) { gone += it }
        manage.trash(manage.dialog.value as ManageDialog.ConfirmTrash)
    }

    /** Waits until the controller has said it is done with a whole selection of [count] ids. */
    private fun awaitDone(count: Int) = await { gone.lastOrNull()?.size == count }

    private fun sent(start: String) = world.requests.filter { it.startsWith(start) }

    private fun await(condition: () -> Boolean) = runBlocking {
        withTimeout(5_000) { while (!condition()) delay(5) }
    }

    private fun locked(folderId: String) = HttpStatusCode.Forbidden to
        """{"statusCode":403,"error":"FOLDER_LOCKED","message":"Folder is locked","details":{"folder_id":"$folderId"}}"""

    @Test fun `names taken at the destination are asked about before anything moves`() = runBlocking {
        world.takenNames = listOf("a.pdf")

        move(file("a", "Trips"), file("b", null))
        val clash = withTimeout(5_000) { manage.dialog.filterNotNull().first() } as ManageDialog.NameClash

        assertEquals(listOf("a.pdf"), clash.taken)
        assertEquals(emptyList<String>(), sent("PATCH documents/move"))

        manage.resolveClash(clash.move, ConflictStrategy.KEEP_BOTH)
        awaitDone(2)

        assertEquals(
            listOf("""PATCH documents/move {"document_ids":["a","b"],"folder_id":"Receipts","conflict_strategy":"keep_both"}"""),
            sent("PATCH documents/move"),
        )
        assertNull(manage.dialog.value)
    }

    @Test fun `a move to the top level sends a null destination`() {
        move(file("a", "Trips"), to = null)
        awaitDone(1)

        assertEquals(listOf("""PATCH documents/move {"document_ids":["a"],"folder_id":null}"""), sent("PATCH documents/move"))
    }

    @Test fun `a document already in the destination is neither asked about nor moved`() {
        move(file("here", "Receipts"), file("coming", "Trips"))
        awaitDone(2)

        assertTrue(sent("POST documents/check-duplicates").single().endsWith(""""filenames":["coming.pdf"]}"""))
        assertEquals(
            listOf("""PATCH documents/move {"document_ids":["coming"],"folder_id":"Receipts"}"""),
            sent("PATCH documents/move"),
        )
    }

    @Test fun `a refused move asks for that folder's password and is then made`() = runBlocking {
        world.writeAnswers += locked("Vaulted")

        move(file("a", "Trips"))
        val prompt = withTimeout(5_000) { manage.unlocker.prompt.filterNotNull().first() }

        assertEquals("Vaulted" to "Vaulted", prompt.folderId to prompt.folderName)
        assertEquals(emptyList<Set<String>>(), gone)

        manage.unlocker.submit("password")
        awaitDone(1)

        assertEquals(2, sent("PATCH documents/move").size)
    }

    @Test fun `many documents go in requests of a hundred, and only a refused one is sent again`() = runBlocking {
        world.writeAnswers += null
        world.writeAnswers += locked("Vaulted")

        move(*Array(150) { file("d$it", "Trips") })
        withTimeout(5_000) { manage.unlocker.prompt.filterNotNull().first() }
        manage.unlocker.submit("password")
        awaitDone(150)

        val first = sent("""PATCH documents/move {"document_ids":["d0",""")
        val second = sent("""PATCH documents/move {"document_ids":["d100",""")
        assertEquals(1 to 2, first.size to second.size)
    }

    @Test fun `a moved folder cannot go into itself or beneath, and going to the top sends a null parent`() = runBlocking {
        manage.pickDestination(Picked(folders = listOf(trips))) {}
        val offered = withTimeout(5_000) { manage.browser.state.filterNotNull().first() }

        assertEquals(setOf("Trips", "Japan"), offered.rules.excluded)

        manage.pickDestination(Picked(folders = trips.children)) {}
        manage.moveTo(Destination(null, "My files"))
        await { sent("PATCH folders/Japan").isNotEmpty() }

        assertEquals(listOf("""PATCH folders/Japan {"parent_id":null}"""), sent("PATCH folders/Japan"))
    }

    @Test fun `a folder chosen to stay where it is sends nothing and is done with`() {
        manage.pickDestination(Picked(folders = listOf(trips))) { gone += it }
        manage.moveTo(Destination(null, "My files"))
        awaitDone(1)

        assertEquals(listOf(setOf("Trips")), gone)
        assertEquals(emptyList<String>(), sent("PATCH"))
    }

    @Test fun `deleting a folder tells every list to read again`() = runBlocking {
        val changed = scope.async { world.documents.contentChanges.first() }

        trash(Picked(folders = listOf(trips)))
        withTimeout(5_000) { changed.await() }

        assertNull(manage.dialog.value)
        assertEquals(listOf("DELETE folders/Trips"), sent("DELETE folders/Trips"))
        assertEquals(listOf(setOf("Trips")), gone)
    }

    @Test fun `a mixed selection is moved to Trash one request after another`() {
        val picked = Picked(documents = listOf(file("a", null).toPicked()), folders = listOf(trips, node("Receipts")))

        trash(picked)
        await { gone.size == 3 }

        assertEquals(
            listOf("""DELETE documents {"ids":["a"]}""", "DELETE folders/Trips", "DELETE folders/Receipts"),
            sent("DELETE"),
        )
        assertEquals(setOf("a", "Trips", "Receipts"), gone.last())
    }

    @Test fun `a refused folder stops the rest, which stay selected, and says why`() = runBlocking {
        world.writeAnswers += HttpStatusCode.Conflict to
            """{"statusCode":409,"error":"Conflict","message":"This folder is being backed up to"}"""
        val picked = Picked(documents = listOf(file("a", null).toPicked()), folders = listOf(trips, node("Receipts")))

        trash(picked)
        val notice = withTimeout(5_000) { manage.notices.first() }

        assertEquals("This folder is being backed up to", notice)
        // The documents went before the folder was refused; nothing after it was tried.
        assertEquals(listOf(setOf("a")), gone)
        assertEquals(listOf("DELETE folders/Trips"), sent("DELETE folders/"))
    }

    @Test fun `making a folder private without a password says it will not lock yet`() = runBlocking {
        world.hasPassword = false

        manage.setPrivate("Receipts", true)

        assertEquals(
            "Private folders only lock once your account has a password.",
            withTimeout(5_000) { manage.notices.first() },
        )
    }

    @Test fun `a refused change shows what the server said`() = runBlocking {
        world.writeAnswers += HttpStatusCode.Conflict to
            """{"statusCode":409,"error":"Conflict","message":"A folder with this name already exists here: Receipts"}"""

        manage.rename("Trips", FolderFormData("Receipts", null, null, false))

        assertEquals(
            "A folder with this name already exists here: Receipts",
            withTimeout(5_000) { manage.notices.first() },
        )
    }
}
