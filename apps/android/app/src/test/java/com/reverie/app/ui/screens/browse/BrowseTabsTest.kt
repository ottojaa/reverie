package com.reverie.app.ui.screens.browse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowseTabsTest {

    private val library = listOf(
        doc("photo-old-upload", created = "2026-11-20T10:00:00Z", taken = "2026-06-01T09:00:00.000Z"),
        doc("photo-new-upload", created = "2026-11-22T10:00:00Z", taken = "2026-10-01T09:00:00.000Z"),
        doc("photo-untaken", mime = "image/png", created = "2026-11-21T10:00:00Z"),
        doc("video", mime = "video/mp4", created = "2026-11-19T10:00:00Z"),
        doc("pdf", mime = "application/pdf", created = "2026-11-23T10:00:00Z"),
        doc("no-type", mime = "", created = "2026-11-18T10:00:00Z"),
    )

    private fun ids(tab: BrowseTab, cursors: Map<BrowseTab, TabCursor> = emptyMap()) =
        BrowseTabs.derive(library, cursors).getValue(tab).documents.map { it.id }

    @Test fun `each tab holds only its kind`() {
        assertEquals(listOf("pdf", "photo-new-upload", "photo-untaken", "photo-old-upload", "video", "no-type"), ids(BrowseTab.ALL))
        assertEquals(listOf("video"), ids(BrowseTab.VIDEOS))
        assertEquals(listOf("pdf", "no-type"), ids(BrowseTab.FILES))
    }

    @Test fun `photos run by date taken and fall back to the upload time`() {
        // photo-untaken has no date taken, so its upload time (Nov 21) puts it above both taken-in-the-past photos.
        assertEquals(listOf("photo-untaken", "photo-new-upload", "photo-old-upload"), ids(BrowseTab.PHOTOS))
    }

    @Test fun `ties break on the id, newest first`() {
        val tied = listOf(doc("a", created = "2026-11-20T10:00:00Z"), doc("b", created = "2026-11-20T10:00:00Z"))
        assertEquals(listOf("b", "a"), BrowseTabs.derive(tied, emptyMap()).getValue(BrowseTab.ALL).documents.map { it.id })
    }

    @Test fun `a tab that has not fetched shows every cached row of its kind`() {
        val files = BrowseTabs.derive(library, emptyMap()).getValue(BrowseTab.FILES)
        assertEquals(2, files.total)
        assertEquals(false, files.hasMore)
    }

    @Test fun `a fetched tab stops at its frontier so cached stragglers do not leave a gap`() {
        // The photo tab has read down to photo-new-upload; photo-old-upload is cached (it came in through
        // the All tab) but lies below the frontier, so showing it would hide the unread photos between.
        val frontier = sortKeyOf(library[1], BrowseTab.PHOTOS)
        val cursor = TabCursor(offset = 2, total = 3, fetched = true, frontier = frontier)
        val photos = BrowseTabs.derive(library, mapOf(BrowseTab.PHOTOS to cursor)).getValue(BrowseTab.PHOTOS)
        assertEquals(listOf("photo-untaken", "photo-new-upload"), photos.documents.map { it.id })
        assertEquals(3, photos.total)
        assertTrue(photos.hasMore)
    }

    @Test fun `an empty fetched tab shows nothing even when rows of its kind are cached`() {
        val cursor = TabCursor(offset = 0, total = 0, fetched = true, frontier = null)
        assertEquals(emptyList<String>(), ids(BrowseTab.VIDEOS, mapOf(BrowseTab.VIDEOS to cursor)))
    }

    @Test fun `unparseable dates sink to the bottom`() {
        val rows = listOf(doc("bad", created = "not a date"), doc("ok", created = "2026-11-20T10:00:00Z"))
        assertEquals(listOf("ok", "bad"), BrowseTabs.derive(rows, emptyMap()).getValue(BrowseTab.ALL).documents.map { it.id })
    }

    @Test fun `a saved tab name that is unknown opens All`() {
        assertEquals(BrowseTab.VIDEOS, BrowseTab.fromSaved("VIDEOS"))
        assertEquals(BrowseTab.ALL, BrowseTab.fromSaved(null))
        assertEquals(BrowseTab.ALL, BrowseTab.fromSaved("Gallery"))
    }
}
