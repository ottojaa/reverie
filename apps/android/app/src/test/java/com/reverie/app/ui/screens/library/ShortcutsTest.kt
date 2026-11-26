package com.reverie.app.ui.screens.library

import org.junit.Assert.assertEquals
import org.junit.Test

/** The order of the Library's shortcut chips. */
class ShortcutsTest {
    private val usual = listOf("favourites", "screenshots", "receipts", "statements", "large-files", "trash")

    @Test fun `until they are moved the chips come in their usual order`() {
        assertEquals(usual, orderedShortcuts(emptyList()))
    }

    @Test fun `a saved order is kept`() {
        val saved = listOf("trash", "large-files", "statements", "receipts", "screenshots", "favourites")

        assertEquals(saved, orderedShortcuts(saved))
    }

    @Test fun `a chip the saved order does not know comes at the end`() {
        val saved = listOf("trash", "receipts", "favourites", "statements", "large-files")

        assertEquals(saved + "screenshots", orderedShortcuts(saved))
    }

    @Test fun `a chip the app no longer has drops out`() {
        val saved = listOf("trash", "memes") + usual.dropLast(1)

        assertEquals(listOf("trash") + usual.dropLast(1), orderedShortcuts(saved))
    }

    @Test fun `moving the chips on show leaves the hidden ones where they were`() {
        // Receipts and large files find nothing today, so only the other four could be moved.
        val shown = listOf("trash", "favourites", "screenshots", "statements")

        assertEquals(
            listOf("trash", "favourites", "receipts", "screenshots", "large-files", "statements"),
            reorderedShortcuts(usual, shown),
        )
    }
}
