package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FeedDocumentsTest {

    private val library = listOf(
        doc("photo-old-upload", created = "2026-11-20T10:00:00Z", taken = "2026-06-01T09:00:00.000Z"),
        doc("photo-new-upload", created = "2026-11-22T10:00:00Z", taken = "2026-10-01T09:00:00.000Z"),
        doc("photo-untaken", mime = "image/png", created = "2026-11-21T10:00:00Z"),
        doc("video", mime = "video/mp4", created = "2026-11-19T10:00:00Z"),
        doc("pdf", mime = "application/pdf", created = "2026-11-23T10:00:00Z"),
        doc("no-type", mime = "", created = "2026-11-18T10:00:00Z"),
    )

    private fun derive(filter: DocumentFilter, cursor: FeedCursor = FeedCursor(), rows: List<DocumentDto> = library) =
        deriveFeed(rows, filter, cursor)

    private fun ids(filter: DocumentFilter, cursor: FeedCursor = FeedCursor()) = derive(filter, cursor).documents.map { it.id }

    @Test fun `each feed holds only its kind`() {
        assertEquals(listOf("pdf", "photo-new-upload", "photo-untaken", "photo-old-upload", "video", "no-type"), ids(DocumentFilter.ALL))
        assertEquals(listOf("video"), ids(DocumentFilter.VIDEOS))
        assertEquals(listOf("pdf", "no-type"), ids(DocumentFilter.FILES))
    }

    @Test fun `photos run by date taken and fall back to the upload time`() {
        // photo-untaken has no date taken, so its upload time (Nov 21) puts it above both taken-in-the-past photos.
        assertEquals(listOf("photo-untaken", "photo-new-upload", "photo-old-upload"), ids(DocumentFilter.IMAGES))
    }

    @Test fun `photos and videos run in one timeline by date taken`() {
        assertEquals(listOf("photo-untaken", "video", "photo-new-upload", "photo-old-upload"), ids(DocumentFilter.MEDIA))
    }

    @Test fun `ties break on the id, newest first`() {
        val tied = listOf(doc("a", created = "2026-11-20T10:00:00Z"), doc("b", created = "2026-11-20T10:00:00Z"))
        assertEquals(listOf("b", "a"), derive(DocumentFilter.ALL, rows = tied).documents.map { it.id })
    }

    @Test fun `a feed that has not fetched shows every cached row of its kind`() {
        val files = derive(DocumentFilter.FILES)
        assertEquals(2, files.total)
        assertEquals(false, files.hasMore)
    }

    @Test fun `a fetched feed stops at its frontier so cached stragglers do not leave a gap`() {
        // The photo feed has read down to photo-new-upload; photo-old-upload is cached (it came in through
        // Recently added) but lies below the frontier, so showing it would hide the unread photos between.
        val frontier = sortKeyOf(library[1], DocumentFilter.IMAGES)
        val cursor = FeedCursor(offset = 2, total = 3, fetched = true, frontier = frontier)
        val photos = derive(DocumentFilter.IMAGES, cursor)
        assertEquals(listOf("photo-untaken", "photo-new-upload"), photos.documents.map { it.id })
        assertEquals(3, photos.total)
        assertTrue(photos.hasMore)
    }

    @Test fun `a feed that has read everything shows rows that reached the cache since, an empty one included`() {
        // Videos was empty when it was read; a video uploaded afterwards lands in the cache and must appear.
        val empty = FeedCursor(offset = 0, total = 0, fetched = true, frontier = null)
        val videos = derive(DocumentFilter.VIDEOS, empty)
        assertEquals(listOf("video"), videos.documents.map { it.id })
        assertEquals(0, videos.total)
        assertEquals(false, videos.hasMore)
        assertTrue(videos.fetched)
    }

    @Test fun `a feed that has read everything reports the server's total, not the number of cached rows`() {
        // The phone cached 39 photos and one was deleted elsewhere: the card says 38, so the subtitle must too.
        val cached = (1..39).map { doc("p$it", created = "2026-11-%02dT10:00:00Z".format(it.coerceAtMost(28)), taken = "2026-10-%02dT09:00:00.000Z".format(it.coerceAtMost(28))) }
        val cursor = FeedCursor(offset = 38, total = 38, fetched = true, frontier = sortKeyOf(cached.first(), DocumentFilter.IMAGES))
        val photos = derive(DocumentFilter.IMAGES, cursor, rows = cached)
        assertEquals(39, photos.documents.size)
        assertEquals(38, photos.total)
    }

    @Test fun `a first page that failed is carried to the feed so it can show its empty state`() {
        val failed = FeedCursor(failed = true)
        val videos = derive(DocumentFilter.VIDEOS, failed, rows = emptyList())
        assertTrue(videos.failed)
        assertEquals(false, videos.fetched)
    }

    @Test fun `unparseable dates sink to the bottom`() {
        val rows = listOf(doc("bad", created = "not a date"), doc("ok", created = "2026-11-20T10:00:00Z"))
        assertEquals(listOf("ok", "bad"), derive(DocumentFilter.ALL, rows = rows).documents.map { it.id })
    }
}
