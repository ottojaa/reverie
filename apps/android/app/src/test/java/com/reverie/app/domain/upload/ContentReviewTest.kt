package com.reverie.app.domain.upload

import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.ContentLocation
import com.reverie.app.data.api.model.FolderContent
import com.reverie.app.data.api.model.PrivateContent
import com.reverie.app.data.api.model.TrashContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentReviewTest {
    private fun result(
        name: String,
        content: ContentLocation? = null,
        conflict: Boolean = false,
    ) = CheckContentResult(name = name, content = content, name_conflict = conflict)

    @Test
    fun `keeps only the files the check flagged, paired by position`() {
        val names = listOf("a.jpg", "b.jpg", "c.jpg", "d.jpg")
        val results =
            listOf(
                result("a.jpg"),
                result("b.jpg", TrashContent),
                result("c.jpg", conflict = true),
                result("d.jpg", PrivateContent, conflict = true),
            )

        assertEquals(listOf(1, 2, 3), toFindings(names, results).map { it.index })
    }

    @Test
    fun `names the folder with a breadcrumb, and the filename when it differs`() {
        val described = describeContent(FolderContent("Work/Invoices", "old.pdf"), "new.pdf")

        assertEquals("Already in Work › Invoices", described.label)
        assertEquals("As old.pdf", described.detail)
    }

    @Test
    fun `does not repeat an identical filename and handles a file outside any folder`() {
        assertNull(describeContent(FolderContent("Work", "a.pdf"), "a.pdf").detail)
        assertEquals("Already in your library, not in a folder", describeContent(FolderContent(null, "a.pdf"), "a.pdf").label)
    }

    @Test
    fun `says only private folder or Trash for those`() {
        assertEquals(ContentDescription("Already in a private folder"), describeContent(PrivateContent, "a.pdf"))
        assertEquals(ContentDescription("Already in Trash"), describeContent(TrashContent, "a.pdf"))
    }

    @Test
    fun `words a name clash the same as the web`() {
        assertEquals("A different file with this name is already in Invoices", describeNameConflict("Invoices", false))
        assertEquals("Same name also exists in Invoices", describeNameConflict("Invoices", true))
    }

    @Test
    fun `asks replace or keep both for a name-only clash, and for a content match only when uploaded anyway`() {
        val findings =
            toFindings(
                listOf("a.pdf", "b.pdf"),
                listOf(result("a.pdf", conflict = true), result("b.pdf", TrashContent, conflict = true)),
            )

        assertTrue(needsNameChoice(findings[0], uploadAnyway = false))
        assertFalse(needsNameChoice(findings[1], uploadAnyway = false))
        assertTrue(needsNameChoice(findings[1], uploadAnyway = true))
    }

    @Test
    fun `stages only the kept files`() {
        val items = listOf("a", "b", "c", "d")
        val findings =
            toFindings(
                items,
                listOf(result("a"), result("b", TrashContent), result("c", PrivateContent), result("d", conflict = true)),
            )

        assertEquals(listOf("a", "d"), keptItems(items, findings, uploadAnyway = emptySet()))
        assertEquals(listOf("a", "c", "d"), keptItems(items, findings, uploadAnyway = setOf(2)))
    }
}
