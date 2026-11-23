package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
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

    private fun rows(tab: BrowseTab, docs: List<DocumentDto>): List<FeedRow> =
        toRows(buildFeed(tab, docs, today, ZoneOffset.UTC), width, GridLayoutMode.UNIFORM, featureEvery = 8)

    // Newest first, as a tab lists them: a day of mixed media and files, then an older day.
    private val mixed = listOf(
        doc("p1", created = "2026-11-23T12:00:00Z"), doc("p2", created = "2026-11-23T11:00:00Z"),
        doc("v1", "video/mp4", created = "2026-11-23T10:00:00Z"),
        doc("f1", "application/pdf", created = "2026-11-23T09:00:00Z"), doc("f2", "text/plain", created = "2026-11-23T08:00:00Z"),
        doc("p3", created = "2026-11-22T12:00:00Z"),
    )

    @Test fun `every row key is unique in every tab`() {
        val many = mixed + (1..40).map { doc("x$it", created = "2026-11-2${it % 2}T%02d:00:00Z".format(10 + it % 10)) }
        BrowseTab.entries.forEach { tab ->
            val keys = rows(tab, many).map { it.key }
            assertEquals("duplicate key in $tab", keys.size, keys.toSet().size)
        }
    }

    @Test fun `a group that returns later in the list still gets its own heading key`() {
        // An undated-looking pattern: October, November, October again (a photo with no date taken between them).
        val docs = listOf(
            doc("a", taken = "2026-10-05T10:00:00.000Z"), doc("b", created = "2026-11-02T10:00:00Z"),
            doc("c", taken = "2026-10-01T10:00:00.000Z"),
        )
        val headings = rows(BrowseTab.PHOTOS, docs).filterIsInstance<FeedRow.Heading>().map { it.key }
        assertEquals(headings.size, headings.toSet().size)
    }

    @Test fun `the All tab draws consecutive files as one card, slot by slot`() {
        val files = rows(BrowseTab.ALL, mixed).filterIsInstance<FeedRow.File>()
        assertEquals(listOf(CardSlot.FIRST, CardSlot.LAST), files.map { it.slot })
        val lone = rows(BrowseTab.ALL, listOf(doc("f", "text/plain"))).filterIsInstance<FeedRow.File>()
        assertEquals(listOf(CardSlot.ONLY), lone.map { it.slot })
        val three = rows(BrowseTab.ALL, (1..3).map { doc("f$it", "text/plain", created = "2026-11-23T1$it:00:00Z") })
            .filterIsInstance<FeedRow.File>()
        assertEquals(listOf(CardSlot.FIRST, CardSlot.MIDDLE, CardSlot.LAST), three.map { it.slot })
    }

    @Test fun `the Files tab draws plain rows without a card`() {
        val files = rows(BrowseTab.FILES, mixed.filter { it.mime_type == "text/plain" || it.mime_type == "application/pdf" })
        assertTrue(files.filterIsInstance<FeedRow.File>().all { it.slot == null })
    }

    @Test fun `videos sit two to a row`() {
        val videos = (1..3).map { doc("v$it", "video/mp4", created = "2026-11-2${it}T10:00:00Z") }.reversed()
        val tiles = rows(BrowseTab.VIDEOS, videos).filterIsInstance<FeedRow.Videos>()
        assertEquals(listOf(2, 1), tiles.map { it.docs.size })
    }

    @Test fun `each tab finds a loaded document's row and reports one it has not loaded`() {
        val byTab = mapOf(
            BrowseTab.ALL to "f2",
            BrowseTab.PHOTOS to "p2",
            BrowseTab.VIDEOS to "v1",
            BrowseTab.FILES to "f1",
        )
        byTab.forEach { (tab, id) ->
            val docs = when (tab) {
                BrowseTab.ALL -> mixed
                BrowseTab.PHOTOS -> mixed.filter { it.id.startsWith("p") }
                BrowseTab.VIDEOS -> mixed.filter { it.id.startsWith("v") }
                BrowseTab.FILES -> mixed.filter { it.id.startsWith("f") }
            }
            val rows = rows(tab, docs)
            val at = rowIndexOf(rows, id)
            assertTrue("$id not found in $tab", at >= 0)
            assertTrue(id in rows[at].docIds)
            assertEquals("a document of another kind is not in $tab", -1, rowIndexOf(rows, "zzz"))
        }
        assertEquals(-1, rowIndexOf(rows(BrowseTab.PHOTOS, mixed.filter { it.id.startsWith("p") }), "v1"))
    }

    @Test fun `scrolling near the end asks for more only while there is more`() {
        assertFalse(isNearEnd(lastVisibleIndex = 2, rowCount = 10, hasMore = true))
        assertTrue(isNearEnd(lastVisibleIndex = 7, rowCount = 10, hasMore = true))
        assertFalse(isNearEnd(lastVisibleIndex = 9, rowCount = 10, hasMore = false))
    }

    @Test fun `the pinned heading is the nearest one above the first visible row`() {
        val rows = rows(BrowseTab.ALL, mixed)
        val firstDay = (rows.first() as FeedRow.Heading).header
        val secondHeading = rows.indexOfLast { it is FeedRow.Heading }
        assertEquals(firstDay, headingAt(rows, 1))
        assertEquals("Yesterday", headingAt(rows, secondHeading + 1)?.title)
        assertNull(headingAt(emptyList(), 0))
    }

    @Test fun `a media run continues across a page boundary without a seam`() {
        val photos = (1..14).map { doc("p$it", created = "2026-11-23T%02d:00:00Z".format(23 - it)) }
        val firstPage = rows(BrowseTab.ALL, photos.take(7))
        val both = rows(BrowseTab.ALL, photos)
        fun bandIds(rows: List<FeedRow>) = rows.filterIsInstance<FeedRow.Band>().map { it.docIds }
        // One day heading only, and every full band of page one is unchanged once page two arrives.
        assertEquals(1, both.count { it is FeedRow.Heading })
        val settled = bandIds(firstPage).dropLast(1)
        assertEquals(settled, bandIds(both).take(settled.size))
        assertEquals(photos.map { it.id }, bandIds(both).flatten())
    }

    @Test fun `the subtitle names the tab's total`() {
        assertEquals("168 photos", tabSubtitle(BrowseTab.PHOTOS, 168, null))
        assertEquals("1 photo", tabSubtitle(BrowseTab.PHOTOS, 1, null))
        assertEquals("12 videos", tabSubtitle(BrowseTab.VIDEOS, 12, null))
        assertEquals("250 files", tabSubtitle(BrowseTab.FILES, 250, ""))
        assertEquals("250 files", tabSubtitle(BrowseTab.ALL, 250, null))
        assertEquals("Trips · 3 files", tabSubtitle(BrowseTab.FILES, 3, "Trips"))
    }
}
