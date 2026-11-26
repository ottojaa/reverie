package com.reverie.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The root of the folders has one name, "My files": the app never describes what is in it by what it lacks. */
class WordingTest {
    @Test fun `nothing in the app uses the old name for the files outside the folders`() {
        // In two pieces, so that this test does not find itself.
        val phrase = "not in " + "a folder"
        val sources = File("src").walk().filter { it.isFile && it.extension in setOf("kt", "xml") }.toList()

        val found = sources.flatMap { file ->
            file.readLines().filter { it.contains(phrase, ignoreCase = true) }
                .map { "${file.path}: ${it.trim()}" }
        }

        assertTrue(sources.size > 100)
        assertEquals(emptyList<String>(), found)
    }
}
