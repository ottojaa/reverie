package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.GridLayoutMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class BrowseRowsTest {

    private val today = LocalDate.of(2026, 11, 23)
    private val width = 390f

    private fun rows(kind: DocumentKind, docs: List<DocumentDto>): List<FeedRow> =
        toRows(buildFeed(kind, docs, today, ZoneOffset.UTC), width, GridLayoutMode.UNIFORM, featureEvery = 8)

    // Newest first, as a tab lists them: a day of mixed media and files, then an older day.
    private val mixed = listOf(
        doc("p1", created = "2026-11-23T12:00:00Z"), doc("p2", created = "2026-11-23T11:00:00Z"),
        doc("v1", "video/mp4", created = "2026-11-23T10:00:00Z"),
        doc("f1", "application/pdf", created = "2026-11-23T09:00:00Z"), doc("f2", "text/plain", created = "2026-11-23T08:00:00Z"),
        doc("p3", created = "2026-11-22T12:00:00Z"),
    )

    @Test fun `every row key is unique on every kind screen`() {
        val many = mixed + (1..40).map { doc("x$it", created = "2026-11-2${it % 2}T%02d:00:00Z".format(10 + it % 10)) }
        DocumentKind.entries.forEach { kind ->
            val keys = rows(kind, many.filter { it.kind == kind }).map { it.key }
            assertEquals("duplicate key in $kind", keys.size, keys.toSet().size)
        }
    }

    @Test fun `a group that returns later in the list still gets its own heading key`() {
        // An undated-looking pattern: October, November, October again (a photo with no date taken between them).
        val docs = listOf(
            doc("a", taken = "2026-10-05T10:00:00.000Z"), doc("b", created = "2026-11-02T10:00:00Z"),
            doc("c", taken = "2026-10-01T10:00:00.000Z"),
        )
        val headings = rows(DocumentKind.IMAGE, docs).filterIsInstance<FeedRow.Heading>().map { it.key }
        assertEquals(headings.size, headings.toSet().size)
    }

    @Test fun `files draw as plain rows`() {
        val files = rows(DocumentKind.FILE, mixed.filter { it.kind == DocumentKind.FILE })
        assertEquals(listOf("f1", "f2"), files.filterIsInstance<FeedRow.File>().map { it.doc.id })
    }

    @Test fun `videos sit two to a row`() {
        val videos = (1..3).map { doc("v$it", "video/mp4", created = "2026-11-2${it}T10:00:00Z") }.reversed()
        val tiles = rows(DocumentKind.VIDEO, videos).filterIsInstance<FeedRow.Videos>()
        assertEquals(listOf(2, 1), tiles.map { it.docs.size })
    }

    @Test fun `each kind screen finds a loaded document's row and reports one it has not loaded`() {
        val byKind = mapOf(DocumentKind.IMAGE to "p2", DocumentKind.VIDEO to "v1", DocumentKind.FILE to "f1")
        byKind.forEach { (kind, id) ->
            val rows = rows(kind, mixed.filter { it.kind == kind })
            val at = rowIndexOf(rows, id)
            assertTrue("$id not found in $kind", at >= 0)
            assertTrue(id in rows[at].docIds)
            assertEquals(-1, rowIndexOf(rows, "zzz"))
        }
        assertEquals(-1, rowIndexOf(rows(DocumentKind.IMAGE, mixed.filter { it.id.startsWith("p") }), "v1"))
    }

    @Test fun `scrolling near the end asks for more only while there is more`() {
        assertFalse(isNearEnd(lastVisibleIndex = 2, rowCount = 10, hasMore = true))
        assertTrue(isNearEnd(lastVisibleIndex = 7, rowCount = 10, hasMore = true))
        assertFalse(isNearEnd(lastVisibleIndex = 9, rowCount = 10, hasMore = false))
    }

    @Test fun `the floating heading is the nearest one above the first visible row`() {
        val rows = rows(DocumentKind.FILE, mixed.filter { it.kind == DocumentKind.FILE } + doc("f3", "text/plain", created = "2026-11-22T12:00:00Z"))
        val firstDay = (rows.first() as FeedRow.Heading).header
        val secondHeading = rows.indexOfLast { it is FeedRow.Heading }
        assertEquals(firstDay, headingAt(rows, 1))
        assertEquals("Yesterday", headingAt(rows, secondHeading + 1)?.title)
        assertNull(headingAt(emptyList(), 0))
    }

    @Test fun `a media run continues across a page boundary without a seam`() {
        val photos = (1..14).map { doc("p$it", created = "2026-11-23T%02d:00:00Z".format(23 - it)) }
        val firstPage = rows(DocumentKind.IMAGE, photos.take(7))
        val both = rows(DocumentKind.IMAGE, photos)
        fun bandIds(rows: List<FeedRow>) = rows.filterIsInstance<FeedRow.Band>().map { it.docIds }
        // One month heading only, and every full band of page one is unchanged once page two arrives.
        assertEquals(1, both.count { it is FeedRow.Heading })
        val settled = bandIds(firstPage).dropLast(1)
        assertEquals(settled, bandIds(both).take(settled.size))
        assertEquals(photos.map { it.id }, bandIds(both).flatten())
    }

    @Test fun `the dashboard's subtitle counts the scope's files`() {
        assertEquals("248 files", dashboardSubtitle(248))
        assertEquals("1 file", folderSubtitle(1, null, ""))
        assertEquals("Trips · 3 files", folderSubtitle(3, null, "Trips"))
        assertEquals("4 of 31 files", folderSubtitle(31, 4, null))
        assertEquals("Trips · 1 of 1 file", folderSubtitle(1, 1, "Trips"))
        assertEquals("Trips", folderSubtitle(null, null, "Trips"))
    }

    @Test fun `a kind screen's subtitle names its total and the scope`() {
        assertEquals("38 photos · My Files", kindSubtitle(DocumentKind.IMAGE, 38))
        assertEquals("1 photo · My Files", kindSubtitle(DocumentKind.IMAGE, 1))
        assertEquals("19 videos · My Files", kindSubtitle(DocumentKind.VIDEO, 19))
        assertEquals("191 files · My Files", kindSubtitle(DocumentKind.FILE, 191))
    }
}
