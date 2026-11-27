package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.settings.FolderChoices
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * A folder read page by page in an order of name or size, with rows of it already cached from further down:
 * the list grows from the top, in the server's order, with nothing missing, repeated or out of place.
 */
class FolderPagingTest {

    /** The names in the server's order, from the file the server's own test reads: groups that fold to one name. */
    private val names: List<String> by lazy {
        val text = checkNotNull(javaClass.classLoader?.getResource("name-order.json")) { "Missing fixture" }.readText()
        Json.parseToJsonElement(text).jsonObject.getValue("ascending").jsonArray
            .flatMap { group -> group.jsonArray.map { it.jsonPrimitive.content } }
    }

    /** One document per name, ids rising down the list: how the server breaks a tie between equal names. */
    private val byName: List<DocumentDto> by lazy {
        names.mapIndexed { at, name -> doc("d%02d".format(at), "application/pdf", name = name) }
    }

    /**
     * Largest first, ties by id from high to low, as the server lists them. The ids don't otherwise follow
     * the sizes, so no order of ids or dates passes for this one.
     */
    private val bySize = listOf(
        "s3" to 900L, "s8" to 500L, "s6" to 500L, "s5" to 500L, "s2" to 500L, "s9" to 100L, "s4" to 100L, "s7" to 7L, "s1" to 0L,
    ).map { (id, bytes) -> doc(id, "application/pdf", bytes = bytes) }

    private fun TestScope.readsThrough(listing: List<DocumentDto>, sort: DocumentSort) {
        val server = FakeServer(listing, isInListingOrder = true)
        // Left from an earlier visit in another order: rows far down this one, which no page has reached yet.
        server.cache.value = listOf(listing.last(), listing[listing.size / 2], listing.first())
        val f = openFolder(server, chosen = FolderChoices(sort = sort))
        var pages = 1
        while (true) {
            assertEquals(listing.take(pages * FakeServer.PAGE).map { it.id }, f.ids)
            if (!f.state.documents.hasMore) break
            f.model.loadMore()
            pages++
        }
        assertEquals(listing.map { it.id }, f.ids)
        assertEquals(listOf(sort), server.sorts.distinct())
        assertFalse(f.state.documents.hasMore)
    }

    @Test fun `a folder of several pages sorted by name`() = runTest(UnconfinedTestDispatcher()) {
        readsThrough(byName, DocumentSort.NAME)
    }

    @Test fun `a folder of several pages sorted by size`() = runTest(UnconfinedTestDispatcher()) {
        readsThrough(bySize, DocumentSort.SIZE)
    }
}
