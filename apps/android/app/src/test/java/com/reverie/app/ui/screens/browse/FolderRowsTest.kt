package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentCategory
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.MediaDatesDto
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.screens.destination.node
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/** What a folder page's rows hold and say. */
class FolderRowsTest {

    private val today = LocalDate.of(2026, 11, 26)
    private val layout = FeedLayout(GridLayoutMode.UNIFORM, 3, today, ZoneOffset.UTC)

    /** Of three days and three kinds, in no order of date: the page keeps the order its feed gives. */
    private val documents = listOf(
        doc("report", "application/pdf", created = "2025-12-17T10:00:00Z"),
        doc("clip", "video/mp4", created = "2026-11-26T09:00:00Z"),
        doc("beach", created = "2026-07-14T10:00:00Z"),
        doc("app", "application/vnd.android.package-archive", created = "2026-11-25T10:00:00Z"),
    )

    private fun page(view: FolderView?) =
        FolderState(documents = FeedDocuments(documents, total = documents.size, fetched = true), view = view)

    @Test fun `a list is one row for each document in the feed's order, with no headings`() {
        val rows = folderRows(page(FolderView.LIST), 360f, layout)

        assertEquals(documents.map { it.id }, rows.map { (it as FeedRow.File).doc.id })
    }

    @Test fun `a grid is one continuous mosaic holding photos, videos and other files in the feed's order`() {
        val rows = folderRows(page(FolderView.GRID), 360f, layout)

        assertTrue(rows.isNotEmpty())
        assertTrue(rows.all { it is FeedRow.Band })
        assertEquals(documents.map { it.id }, rows.flatMap { row -> (row as FeedRow.Band).section.tiles.map { it.doc.id } })
    }

    @Test fun `a page whose view is not decided yet has no rows`() {
        assertTrue(folderRows(page(view = null), 360f, layout).isEmpty())
    }

    private fun meta(document: DocumentDto, filter: DocumentFilter = DocumentFilter.ALL) =
        folderRowMeta(document, filter, today, ZoneOffset.UTC)

    @Test fun `a file's second line says its type, size and date`() {
        val report = doc("r", "application/pdf", created = "2025-12-17T10:00:00Z", name = "report.pdf", bytes = 86_016)

        assertEquals("PDF · 84 KB · 17 Dec 2025", meta(report))
    }

    @Test fun `a video's says its length and date`() {
        val clip = doc("c", "video/mp4", created = "2026-07-18T10:00:00Z").copy(duration_seconds = 42.0)

        assertEquals("Video · 0:42 · 18 Jul", meta(clip))
        assertEquals("Video · 18 Jul", meta(clip.copy(duration_seconds = null)))
    }

    @Test fun `a photo's says where it was taken and when`() {
        val photo = doc("p", created = "2026-07-14T10:00:00Z").copy(city = "Suomenlinna")

        assertEquals("Photo · Suomenlinna · 14 Jul", meta(photo))
        assertEquals("Photo · 14 Jul", meta(photo.copy(city = null)))
        assertEquals(
            "Screenshot · 14 Jul",
            meta(photo.copy(city = null, document_category = DocumentCategory.SCREENSHOT)),
        )
    }

    @Test fun `recent dates are worded as elsewhere in the app`() {
        assertEquals("Photo · 14:03", meta(doc("t", created = "2026-11-26T14:03:00Z")))
        assertEquals("Photo · Yesterday", meta(doc("y", created = "2026-11-25T10:00:00Z")))
        assertEquals("Photo · Mon", meta(doc("w", created = "2026-11-23T10:00:00Z")))
        assertEquals("Photo", meta(doc("u", created = "soon")))
    }

    @Test fun `a page of photos and videos dates them by when they were taken, any other by when they were added`() {
        val photo = doc("p", created = "2026-11-25T10:00:00Z", taken = "2026-06-03T10:00:00Z")

        assertEquals("Photo · 3 Jun", meta(photo, DocumentFilter.MEDIA))
        assertEquals("Photo · Yesterday", meta(photo, DocumentFilter.ALL))
    }

    private val leaf = node("lisbon", parent = "trips").copy(kind_counts = KindCountsDto(image = 3, file = 3))
    private val parent = node("trips", children = listOf(leaf)).copy(kind_counts = leaf.kind_counts)

    @Test fun `a folder's header says what its row says, and spans its photos' days when it has no folders`() {
        val dates = MediaDatesDto(first = "2026-08-21T09:00:00Z", last = "2026-08-25T18:00:00Z")
        val summary = DocumentSummaryDto(media_dates = dates)

        assertEquals(folderMeta(parent), folderPageMeta(FolderState(node = parent, summary = summary)))
        assertEquals(folderMeta(leaf) + " · 21–25 Aug 2026", folderPageMeta(FolderState(node = leaf, summary = summary)))
        assertEquals(folderMeta(leaf), folderPageMeta(FolderState(node = leaf)))
        assertNull(folderPageMeta(FolderState()))
    }

    @Test fun `the root's header counts its own folders and files`() {
        val summary = DocumentSummaryDto(image = KindTotalsDto(count = 2), file = FileTotalsDto(count = 3))
        val tree = listOf(parent)

        assertEquals("1 folder · 5 files", folderPageMeta(FolderState(isRoot = true, children = tree, summary = summary)))
        assertEquals("2 photos", folderPageMeta(FolderState(isRoot = true, summary = summary.copy(file = FileTotalsDto()))))
        assertNull(folderPageMeta(FolderState(isRoot = true, children = tree)))
    }
}
