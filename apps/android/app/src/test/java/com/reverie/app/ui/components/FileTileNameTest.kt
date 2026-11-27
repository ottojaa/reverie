package com.reverie.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class FileTileNameTest {
    /** A tile two lines high that breaks a text wherever a line is [columns] characters long. */
    private fun fitted(name: String, columns: Int): String = fitFileName(name) { text, extension ->
        val lines = text.split('\n').flatMap { it.chunked(columns) }
        lines.size <= 2 && lines.last().endsWith(extension)
    }

    @Test fun `a name that fits with its extension whole is left alone`() {
        assertEquals("app-release.apk", fitted("app-release.apk", columns = 20))
        assertEquals("holiday-originals.zip", fitted("holiday-originals.zip", columns = 17))
    }

    @Test fun `an extension that would be split takes the second line to itself`() {
        assertEquals("holiday-originals\n.zip", fitted("holiday-originals.zip", columns = 20))
    }

    @Test fun `a name too long gives up the end of what comes before the extension`() {
        assertEquals("holiday-origi….zip", fitted("holiday-originals-from-lisbon.zip", columns = 9))
        assertEquals("scan of….jpeg", fitted("scan of the flat lease.jpeg", columns = 7))
    }

    @Test fun `only the last extension is kept, however long it is among the usual ones`() {
        assertEquals("backup-of-ever….gz", fitted("backup-of-everything.tar.gz", columns = 9))
        assertEquals("quarterly….numbers", fitted("quarterly-household-budget.numbers", columns = 9))
    }

    @Test fun `a name without an extension is left to be cut at its end`() {
        listOf("a-very-long-name-with-nothing-after-it", ".gitignore-for-everything-here", "Notes v1.2 of the final draft")
            .forEach { assertEquals(it, fitted(it, columns = 8)) }
    }

    @Test fun `a character made of two halves is not cut in two`() {
        assertEquals("ab…\n.txt", fitted("ab😀cdefghij.txt", columns = 4))
    }
}
