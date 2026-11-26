package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentFilter
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

class BrowseGroupingTest {

    private val today = LocalDate.of(2026, 11, 23)
    private val utc: ZoneId = ZoneOffset.UTC
    private val helsinki: ZoneId = ZoneId.of("Europe/Helsinki")

    private fun headers(feed: List<FeedItem>) = feed.filterIsInstance<FeedItem.Header>().map { it.title }

    private fun grids(feed: List<FeedItem>) = feed.filterIsInstance<FeedItem.Media>().map { item -> item.docs.map { it.id } }

    @Test fun `day labels`() {
        assertEquals("Today", dayLabel(today, today))
        assertEquals("Yesterday", dayLabel(today.minusDays(1), today))
        assertEquals("Fri 20 Nov", dayLabel(LocalDate.of(2026, 11, 20), today))
        assertEquals("Mon 16 Nov", dayLabel(LocalDate.of(2026, 11, 16), today))
        assertEquals("Wed 31 Dec 2025", dayLabel(LocalDate.of(2025, 12, 31), today))
    }

    @Test fun `the date taken is read as written and the upload time in the device zone`() {
        // 23:30 taken on Oct 31 stays October; an upload at 23:30 UTC is already November in Helsinki (UTC+2).
        val taken = doc("t", taken = "2026-10-31T23:30:00.000Z", created = "2026-11-23T10:00:00Z")
        val uploaded = doc("u", created = "2026-10-31T23:30:00Z")
        assertEquals(LocalDate.of(2026, 10, 31), dayTakenOf(taken, ZoneId.of("Pacific/Auckland")))
        assertEquals(LocalDate.of(2026, 11, 1), dayTakenOf(uploaded, helsinki))
        assertEquals(LocalDate.of(2026, 10, 31), dayTakenOf(uploaded, utc))
        assertEquals(LocalDate.of(2026, 11, 23), dayAddedOf(taken, utc))
    }

    @Test fun `photos and videos share one grid under the day they were taken`() {
        val docs = listOf(
            doc("p1", taken = "2026-11-23T10:00:00.000Z"),
            doc("v1", "video/mp4", taken = "2026-11-23T09:00:00.000Z"),
            doc("p2", taken = "2026-11-22T10:00:00.000Z"),
        )
        assertEquals(
            listOf(
                FeedItem.Header("day:2026-11-23", "Today"), FeedItem.Media(docs.take(2)),
                FeedItem.Header("day:2026-11-22", "Yesterday"), FeedItem.Media(docs.drop(2)),
            ),
            buildFeed(DocumentFilter.MEDIA, docs, today, utc),
        )
    }

    @Test fun `a folder uploaded in one batch gets its headers from the days the photos were taken`() {
        val uploaded = "2026-11-23T08:00:00Z"
        val docs = listOf(
            doc("c", taken = "2025-08-25T18:00:00.000Z", created = uploaded),
            doc("b", taken = "2025-08-23T12:00:00.000Z", created = uploaded),
            doc("a", taken = "2025-08-21T09:00:00.000Z", created = uploaded),
        )
        val feed = buildFeed(DocumentFilter.MEDIA, docs, today, utc)
        assertEquals(listOf("Mon 25 Aug 2025", "Sat 23 Aug 2025", "Thu 21 Aug 2025"), headers(feed))
        assertEquals(listOf(listOf("c"), listOf("b"), listOf("a")), grids(feed))
    }

    @Test fun `a photo taken long ago sits under that day however recently it was uploaded`() {
        // The order a cache read gives: newest upload first.
        val docs = listOf(
            doc("old", taken = "2019-06-01T12:00:00.000Z", created = "2026-11-23T09:00:00Z"),
            doc("new", taken = "2026-11-22T12:00:00.000Z", created = "2026-11-22T13:00:00Z"),
        )
        val feed = buildFeed(DocumentFilter.MEDIA, docs, today, utc)
        assertEquals(listOf("Yesterday", "Sat 1 Jun 2019"), headers(feed))
        assertEquals(listOf(listOf("new"), listOf("old")), grids(feed))
    }

    @Test fun `no day appears twice when dates taken and upload times interleave around midnight`() {
        // The server lists by instant: the photo (23:30 on the 25th, as written) before the screenshot (22:30Z),
        // which in Helsinki is already 00:30 on the 26th. Between them sits a second photo of the 25th.
        val docs = listOf(
            doc("photo", taken = "2026-11-25T23:30:00.000Z"),
            doc("screenshot", "image/png", created = "2026-11-25T22:30:00Z"),
            doc("earlier", taken = "2026-11-25T20:00:00.000Z"),
        )
        val day = LocalDate.of(2026, 11, 26)
        val feed = buildFeed(DocumentFilter.MEDIA, docs, day, helsinki)
        assertEquals(listOf("Today", "Yesterday"), headers(feed))
        assertEquals(listOf(listOf("screenshot"), listOf("photo", "earlier")), grids(feed))
    }

    @Test fun `the viewer swipes through photos in the order the grid shows them`() {
        val docs = listOf(
            doc("photo", taken = "2026-11-25T23:30:00.000Z"),
            doc("screenshot", "image/png", created = "2026-11-25T22:30:00Z"),
        )
        assertEquals(listOf("screenshot", "photo"), shownIds(FeedSource.MEDIA, docs, emptySet(), helsinki))
    }

    @Test fun `documents with no readable date come last`() {
        val docs = listOf(doc("broken", created = "soon"), doc("dated", created = "2026-11-23T10:00:00Z"))
        val feed = buildFeed(DocumentFilter.MEDIA, docs, today, utc)
        assertEquals(listOf("Today", "Undated"), headers(feed))
        assertEquals(listOf(listOf("dated"), listOf("broken")), grids(feed))
    }

    @Test fun `files list as rows grouped by upload day`() {
        val docs = listOf(
            doc("a", "application/pdf", created = "2026-11-23T09:00:00Z"),
            doc("b", "application/zip", created = "2026-11-22T09:00:00Z"),
        )
        assertEquals(
            listOf(
                FeedItem.Header("day:2026-11-23", "Today"), FeedItem.FileRow(docs[0]),
                FeedItem.Header("day:2026-11-22", "Yesterday"), FeedItem.FileRow(docs[1]),
            ),
            buildFeed(DocumentFilter.FILES, docs, today, utc),
        )
    }

    @Test fun `a day's photos carry on across a page boundary instead of starting a new group`() {
        val first = listOf(doc("p1", taken = "2026-11-23T12:00:00.000Z"), doc("p2", taken = "2026-11-23T11:00:00.000Z"))
        val more = first + doc("p3", taken = "2026-11-23T10:00:00.000Z")
        assertEquals(2, buildFeed(DocumentFilter.IMAGES, first, today, utc).size)
        assertEquals(
            listOf(FeedItem.Header("day:2026-11-23", "Today"), FeedItem.Media(more)),
            buildFeed(DocumentFilter.IMAGES, more, today, utc),
        )
    }
}
