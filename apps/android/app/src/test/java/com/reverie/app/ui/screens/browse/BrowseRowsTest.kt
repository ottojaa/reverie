package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
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

    private val layout = FeedLayout(GridLayoutMode.UNIFORM, featureEvery = 8, today = today, zone = ZoneOffset.UTC)

    private fun rows(source: FeedSource, docs: List<DocumentDto>): List<FeedRow> =
        feedRows(source, docs.filter { source.filter.holds(it.kind) }, emptySet(), width, layout)

    // Newest first, as a tab lists them: a day of mixed media and files, then an older day.
    private val mixed = listOf(
        doc("p1", created = "2026-11-23T12:00:00Z"), doc("p2", created = "2026-11-23T11:00:00Z"),
        doc("v1", "video/mp4", created = "2026-11-23T10:00:00Z"),
        doc("f1", "application/pdf", created = "2026-11-23T09:00:00Z"), doc("f2", "text/plain", created = "2026-11-23T08:00:00Z"),
        doc("p3", created = "2026-11-22T12:00:00Z"),
    )

    @Test fun `every row key is unique on every list screen`() {
        val many = mixed + (1..40).map { doc("x$it", created = "2026-11-2${it % 2}T%02d:00:00Z".format(10 + it % 10)) }
        FeedSource.entries.forEach { source ->
            val keys = rows(source, many).map { it.key }
            assertEquals("duplicate key in $source", keys.size, keys.toSet().size)
        }
    }

    @Test fun `files draw as plain rows`() {
        val files = rows(FeedSource.FILES, mixed)
        assertEquals(listOf("f1", "f2"), files.filterIsInstance<FeedRow.File>().map { it.doc.id })
    }

    @Test fun `the photos grid holds no videos, and the videos grid holds them`() {
        fun grid(source: FeedSource) = rows(source, mixed).filterIsInstance<FeedRow.Band>().flatMap { it.docIds }
        assertEquals(listOf("p1", "p2", "p3"), grid(FeedSource.PHOTOS))
        assertEquals(listOf("v1"), grid(FeedSource.VIDEOS))
    }

    @Test fun `the files outside any folder are one row each, with no headings`() {
        val unfiled = rows(FeedSource.UNFILED, mixed)
        assertEquals(mixed.map { listOf(it.id) }, unfiled.map { it.docIds })
        assertTrue(unfiled.all { it is FeedRow.Added })
    }

    @Test fun `recently added folds media uploaded together into one row`() {
        val together = listOf(doc("p1", created = "2026-11-23T12:00:00Z"), doc("p2", created = "2026-11-23T11:55:00Z"))
        assertEquals(listOf(listOf("p1", "p2")), rows(FeedSource.RECENT, together).map { it.docIds })
    }

    @Test fun `each list finds a loaded document's row and reports one it has not loaded`() {
        val bySource = mapOf(FeedSource.PHOTOS to "p2", FeedSource.VIDEOS to "v1", FeedSource.FILES to "f1", FeedSource.UNFILED to "f2")
        bySource.forEach { (source, id) ->
            val rows = rows(source, mixed)
            val at = rowIndexOf(rows, id)
            assertTrue("$id not found in $source", at >= 0)
            assertTrue(id in rows[at].docIds)
            assertEquals(-1, rowIndexOf(rows, "zzz"))
        }
        assertEquals(-1, rowIndexOf(rows(FeedSource.PHOTOS, mixed), "v1"))
    }

    @Test fun `scrolling near the end asks for more only while there is more`() {
        assertFalse(isNearEnd(lastVisibleIndex = 2, rowCount = 10, hasMore = true))
        assertTrue(isNearEnd(lastVisibleIndex = 7, rowCount = 10, hasMore = true))
        assertFalse(isNearEnd(lastVisibleIndex = 9, rowCount = 10, hasMore = false))
    }

    @Test fun `the floating heading is the nearest one above the first visible row`() {
        val rows = rows(FeedSource.FILES, mixed + doc("f3", "text/plain", created = "2026-11-22T12:00:00Z"))
        val firstDay = (rows.first() as FeedRow.Heading).header
        val secondHeading = rows.indexOfLast { it is FeedRow.Heading }
        assertEquals(firstDay, headingAt(rows, 1))
        assertEquals("Yesterday", headingAt(rows, secondHeading + 1)?.title)
        assertNull(headingAt(emptyList(), 0))
    }

    @Test fun `a day's photos continue across a page boundary without a seam`() {
        val photos = (1..14).map { doc("p$it", created = "2026-11-23T%02d:00:00Z".format(23 - it)) }
        fun bandIds(rows: List<FeedRow>) = rows.filterIsInstance<FeedRow.Band>().map { it.docIds }
        val firstPage = rows(FeedSource.PHOTOS, photos.take(7))
        val both = rows(FeedSource.PHOTOS, photos)
        // One day heading only, and every full band of page one is unchanged once page two arrives.
        assertEquals(1, both.count { it is FeedRow.Heading })
        val settled = bandIds(firstPage).dropLast(1)
        assertEquals(settled, bandIds(both).take(settled.size))
        assertEquals(photos.map { it.id }, bandIds(both).flatten())
    }

    @Test fun `a list's subtitle names its total, and the lists by date have none`() {
        assertEquals("38 photos", FeedSource.PHOTOS.subtitle(38))
        assertEquals("1 photo", FeedSource.PHOTOS.subtitle(1))
        assertEquals("19 videos", FeedSource.VIDEOS.subtitle(19))
        assertEquals("191 files", FeedSource.FILES.subtitle(191))
        assertEquals("1 file", FeedSource.UNFILED.subtitle(1))
        assertNull(FeedSource.RECENT.subtitle(126))
    }
}
