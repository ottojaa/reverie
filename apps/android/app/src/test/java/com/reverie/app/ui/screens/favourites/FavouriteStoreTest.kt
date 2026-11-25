package com.reverie.app.ui.screens.favourites

import app.cash.turbine.test
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.repository.FavouritesState
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The one favourites store: optimistic edits, what undoes them, what refetches it and what empties it. */
class FavouriteStoreTest {

    private val world = FavouriteWorld()
    private val store = world.favourites
    private val invoice = FavouriteFixtures.invoice
    private val portugal = FavouriteFixtures.portugal
    private val serverError = HttpStatusCode.InternalServerError to """{"statusCode":500,"error":"INTERNAL","message":"boom"}"""

    private fun run(body: suspend () -> Unit) = runBlocking { withTimeout(5_000) { body() } }

    private suspend fun awaitState(condition: (FavouritesState) -> Boolean) = store.state.first(condition)

    @Test fun `a star shows at once and is taken back when the server refuses it`() = run {
        store.refresh()
        val gate = CompletableDeferred<Unit>()
        world.putGate = gate
        world.putFailures += serverError
        val controller = world.controller()

        controller.events.test {
            controller.toggle(invoice.key)
            assertTrue(store.state.value.isStarred(invoice.key))
            assertTrue(invoice.id in store.state.value.starredDocumentIds)

            gate.complete(Unit)
            assertEquals(FavouriteEvent.Message(FavouriteController.ADD_FAILED), awaitItem())
            assertFalse(store.state.value.isStarred(invoice.key))
        }
    }

    @Test fun `an unstarred card leaves at once and comes back when offline`() = run {
        world.items = listOf(portugal, invoice)
        store.refresh()
        val gate = CompletableDeferred<Unit>()
        world.putGate = gate
        val controller = world.controller()

        controller.events.test {
            controller.toggle(invoice.key)
            assertEquals(listOf(portugal), store.state.value.visible)

            world.putFailures += serverError
            gate.complete(Unit)
            assertEquals(FavouriteEvent.Message(FavouriteController.REMOVE_FAILED), awaitItem())
            assertEquals(listOf(portugal, invoice), store.state.value.visible)

            world.isOffline = true
            controller.toggle(invoice.key)
            assertEquals(FavouriteEvent.Message(FavouriteController.REMOVE_FAILED), awaitItem())
            assertEquals(listOf(portugal, invoice), store.state.value.visible)
        }
    }

    @Test fun `a new star gets its card from the list that follows the write`() = run {
        store.refresh()
        world.items = listOf(invoice)

        store.setStarred(invoice.key, true)

        assertEquals(listOf(invoice), awaitState { it.visible.isNotEmpty() }.visible)
        assertEquals("PUT favourites/document/d-invoice {\"is_favourite\":true}", world.requests[1])
    }

    @Test fun `a list asked for before a write does not undo it`() = run {
        world.items = listOf(invoice)
        store.refresh()
        world.items = listOf(invoice, portugal)
        val gate = CompletableDeferred<Unit>()
        world.listGate = gate
        store.requestRefresh()
        world.awaitRequests("GET favourites", count = 2)

        store.setStarred(invoice.key, false)
        gate.complete(Unit)

        // The late list still names it; the write is newer.
        assertEquals(listOf(portugal), awaitState { it.items?.size == 2 }.visible)
        // A list asked for after the write speaks for itself.
        world.items = listOf(portugal)
        store.refresh()
        assertTrue(store.state.value.confirmed.isEmpty())
    }

    @Test fun `a locked item asks for the password and then writes again`() = run {
        store.refresh()
        world.putFailures += HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"FOLDER_LOCKED","message":"Folder is locked","details":{"folder_id":"lock-1"}}"""
        val controller = world.controller()

        controller.events.test {
            controller.toggle(invoice.key, confirm = true)
            val prompt = controller.unlocker.prompt.first { it != null }!!
            assertEquals("lock-1", prompt.folderId)
            assertFalse(store.state.value.isStarred(invoice.key))

            controller.unlocker.submit("hunter2")

            assertEquals(FavouriteEvent.Message(FavouriteController.ADDED, isConfirmation = true), awaitItem())
            assertTrue(store.state.value.isStarred(invoice.key))
        }
        val writes = world.requests.filter { it.startsWith("PUT") || it.startsWith("POST") }.map { it.substringBefore(' ') }
        assertEquals(listOf("PUT", "POST", "PUT"), writes)
    }

    @Test fun `dismissing the password prompt drops the retry`() = run {
        store.refresh()
        world.putFailures += HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"FOLDER_LOCKED","message":"x","details":{"folder_id":"lock-1"}}"""
        val controller = world.controller()
        controller.toggle(invoice.key)
        controller.unlocker.prompt.first { it != null }

        controller.dismissUnlock()

        assertNull(controller.unlocker.prompt.value)
        assertEquals(1, world.requests.count { it.startsWith("PUT") })
    }

    @Test fun `an unlock refetches the list`() = run {
        store.refresh()
        world.items = listOf(FavouriteFixtures.private("d-secret", locked = false))

        world.vault.unlock("lock-1", "hunter2")

        assertFalse(awaitState { it.visible.isNotEmpty() }.visible.single().locked)
    }

    @Test fun `the store is never persisted`() = run {
        world.items = FavouriteFixtures.all
        store.refresh()
        store.setStarred(portugal.key, false)

        // Nothing it holds reaches the database.
        assertTrue(world.documentDao.rows.value.isEmpty())
        assertTrue(world.folderDao.rows.value.isEmpty())
        // So a new process starts knowing nothing.
        assertNull(FavouriteWorld().favourites.state.value.items)
    }

    @Test fun `logout empties the store, even when a list is still on its way`() = run {
        world.items = listOf(invoice)
        store.refresh()
        val gate = CompletableDeferred<Unit>()
        world.listGate = gate
        store.requestRefresh()
        world.awaitRequests("GET favourites", count = 2)

        store.clear()
        gate.complete(Unit)
        // Waits its turn behind the late list, then fails: what is left is what that list did.
        world.isOffline = true
        runCatching { store.refresh() }

        assertNull(store.state.value.items)
        assertFalse(store.state.value.isLoaded)
        assertTrue(store.state.value.starredDocumentIds.isEmpty())
    }

    @Test fun `folders and documents are told apart`() = run {
        world.items = listOf(portugal, invoice)
        store.refresh()

        assertEquals(setOf(portugal.id), store.state.value.starredFolderIds)
        assertEquals(setOf(invoice.id), store.state.value.starredDocumentIds)
        assertEquals(FavouriteType.FOLDER, store.state.value.visible.first().type)
    }
}
