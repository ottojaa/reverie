package com.reverie.app.ui.screens.collections

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionAccentTest {
    @Test fun `the same id always gets the same accent`() {
        val id = "11111111-2222-3333-4444-555555555555"

        assertEquals(collectionAccent(id), collectionAccent(id))
        assertEquals(collectionAccent(id), collectionAccent(String(id.toCharArray())))
    }

    // Pinned to FNV-1a over the id's characters, modulo the palette size: if the hash or the palette
    // order changes, every collection changes colour, which this test is here to catch.
    @Test fun `accents are pinned to the hash and the palette order`() {
        assertEquals(COLLECTION_ACCENTS[PINNED_INDEX], collectionAccent(PINNED_ID))
    }

    @Test fun `every accent comes from the fixed palette`() {
        repeat(200) { assertTrue(collectionAccent("id-$it") in COLLECTION_ACCENTS) }
    }

    @Test fun `ids spread over the palette`() {
        val used = (1..200).map { collectionAccent("id-$it") }.toSet()

        assertTrue("only ${used.size} accents used", used.size >= COLLECTION_ACCENTS.size - 1)
    }

    @Test fun `the light shade is darker than the dark shade for contrast on a light surface`() {
        COLLECTION_ACCENTS.forEach { assertTrue(luma(it.light) < luma(it.dark)) }
    }

    private fun luma(c: androidx.compose.ui.graphics.Color) = 0.2126f * c.red + 0.7152f * c.green + 0.0722f * c.blue

    private companion object {
        const val PINNED_ID = "c1"
        const val PINNED_INDEX = 1
    }
}
