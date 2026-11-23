package com.reverie.app.ui.screens.browse

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.YearMonth

class BrowseGroupingTest {

    private val today = LocalDate.of(2026, 11, 23)
    private val utc: ZoneId = ZoneOffset.UTC

    @Test fun `day labels`() {
        assertEquals("Today", dayLabel(today, today))
        assertEquals("Yesterday", dayLabel(today.minusDays(1), today))
        assertEquals("Friday", dayLabel(LocalDate.of(2026, 11, 20), today))
        assertEquals("Nov 16", dayLabel(LocalDate.of(2026, 11, 16), today))
        assertEquals("Dec 31, 2025", dayLabel(LocalDate.of(2025, 12, 31), today))
    }

    @Test fun `month labels carry the year only when it is not this year`() {
        assertEquals("November", monthLabel(YearMonth.of(2026, 11), today))
        assertEquals("October 2025", monthLabel(YearMonth.of(2025, 10), today))
    }

    @Test fun `a day summary leaves out kinds the day does not hold`() {
        val day = listOf(doc("a"), doc("b"), doc("c"), doc("v", "video/mp4"), doc("f1", "text/markdown"), doc("f2", ""), doc("f3", "application/zip"))
        assertEquals("3 photos · 1 video · 3 files", daySummary(day))
        assertEquals("1 photo", daySummary(listOf(doc("a"))))
        assertEquals("2 files", daySummary(listOf(doc("f1", "text/markdown"), doc("f2", ""))))
    }

    @Test fun `the date taken is read as written and the upload time in the device zone`() {
        // 23:30 taken on Oct 31 stays October; an upload at 23:30 UTC is already November in Helsinki (UTC+2).
        val taken = doc("t", taken = "2026-10-31T23:30:00.000Z", created = "2026-11-23T10:00:00Z")
        val uploaded = doc("u", created = "2026-10-31T23:30:00Z")
        assertEquals(YearMonth.of(2026, 10), monthOf(taken, ZoneId.of("Pacific/Auckland")))
        assertEquals(YearMonth.of(2026, 11), monthOf(uploaded, ZoneId.of("Europe/Helsinki")))
        assertEquals(YearMonth.of(2026, 10), monthOf(uploaded, utc))
    }

    @Test fun `photos group by month with a count of what is loaded`() {
        val docs = listOf(
            doc("n1", taken = "2026-11-20T10:00:00.000Z"), doc("n2", taken = "2026-11-02T10:00:00.000Z"),
            doc("o1", taken = "2026-10-30T10:00:00.000Z"),
        )
        val feed = buildFeed(BrowseTab.PHOTOS, docs, today, utc)
        assertEquals(
            listOf(
                FeedItem.Header("month:2026-11", "November", "2 photos"), FeedItem.Media(docs.take(2)),
                FeedItem.Header("month:2026-10", "October", "1 photo"), FeedItem.Media(docs.drop(2)),
            ),
            feed,
        )
    }

    @Test fun `videos sit two to a row under their month`() {
        val docs = (1..3).map { doc("v$it", "video/mp4", created = "2026-11-2${it}T10:00:00Z") }.reversed()
        val feed = buildFeed(BrowseTab.VIDEOS, docs, today, utc)
        assertEquals(FeedItem.Header("month:2026-11", "November", "3 videos"), feed[0])
        assertEquals(listOf(2, 1), feed.drop(1).map { (it as FeedItem.VideoRow).docs.size })
    }

    @Test fun `files list as rows grouped by upload day`() {
        val docs = listOf(
            doc("a", "application/pdf", created = "2026-11-23T09:00:00Z"),
            doc("b", "application/zip", created = "2026-11-22T09:00:00Z"),
        )
        val feed = buildFeed(BrowseTab.FILES, docs, today, utc)
        assertEquals(
            listOf(
                FeedItem.Header("day:2026-11-23", "Today", ""), FeedItem.FileRow(docs[0]),
                FeedItem.Header("day:2026-11-22", "Yesterday", ""), FeedItem.FileRow(docs[1]),
            ),
            feed,
        )
    }

    @Test fun `the all tab makes a mosaic run of neighbouring media and a card of neighbouring files`() {
        val day = "2026-11-23T1"
        val docs = listOf(
            doc("p1", created = "${day}2:00:00Z"), doc("v1", "video/mp4", created = "${day}1:50:00Z"),
            doc("f1", "text/markdown", created = "${day}1:40:00Z"), doc("f2", "", created = "${day}1:30:00Z"),
            doc("p2", created = "${day}1:20:00Z"),
        )
        val feed = buildFeed(BrowseTab.ALL, docs, today, utc)
        assertEquals(
            listOf(
                FeedItem.Header("day:2026-11-23", "Today", "2 photos · 1 video · 2 files"),
                FeedItem.Media(listOf(docs[0], docs[1])), FeedItem.FileCard(listOf(docs[2], docs[3])), FeedItem.Media(listOf(docs[4])),
            ),
            feed,
        )
    }

    @Test fun `a run carries on across a page boundary instead of starting a new group`() {
        val first = listOf(doc("p1", created = "2026-11-23T12:00:00Z"), doc("p2", created = "2026-11-23T11:00:00Z"))
        val more = first + doc("p3", created = "2026-11-23T10:00:00Z")
        val before = buildFeed(BrowseTab.ALL, first, today, utc)
        val after = buildFeed(BrowseTab.ALL, more, today, utc)
        assertEquals(2, before.size)
        assertEquals(listOf(FeedItem.Header("day:2026-11-23", "Today", "3 photos"), FeedItem.Media(more)), after)
    }
}
