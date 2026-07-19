package com.reverie.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.format.DateTimeFormatter

class FormatTest {

    @Test fun `formats sub-minute durations as m colon ss`() {
        assertEquals("0:00", formatDuration(0.0))
        assertEquals("0:05", formatDuration(5.0))
        assertEquals("0:59", formatDuration(59.0))
    }

    @Test fun `formatDayDate leads with the weekday`() {
        // 27 Oct 2003 was a Monday.
        assertEquals("Mon, 27 Oct 2003", formatDayDate("2003-10-27"))
    }

    @Test fun `formatDayDate accepts full ISO instants`() {
        // Date-only assertion is timezone-safe; the instant is well before any TZ day boundary swing.
        assertEquals("Mon, 27 Oct 2003", formatDayDate("2003-10-27T12:00:00.000Z"))
    }

    @Test fun `formatDayDate is blank on null or garbage`() {
        assertEquals("", formatDayDate(null))
        assertEquals("", formatDayDate(""))
        assertEquals("", formatDayDate("not-a-date"))
    }

    @Test fun `formatTimeOfDay is null for date-only values`() {
        assertNull(formatTimeOfDay("2003-10-27"))
        assertNull(formatTimeOfDay(null))
        assertNull(formatTimeOfDay("garbage"))
    }

    @Test fun `formatTimeOfDay reads the clock time from an instant`() {
        // UTC noon; assert it parses to some HH:mm without asserting the device timezone offset.
        val t = formatTimeOfDay("2003-10-27T12:34:00.000Z")
        assertEquals(true, t?.matches(Regex("""\d{2}:\d{2}""")))
    }

    @Test fun `formatRelativeAge covers the near-term buckets`() {
        val today = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
        val yesterday = LocalDate.now().minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE)
        val threeDays = LocalDate.now().minusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE)
        val twoWeeks = LocalDate.now().minusDays(14).format(DateTimeFormatter.ISO_LOCAL_DATE)
        assertEquals("today", formatRelativeAge(today))
        assertEquals("yesterday", formatRelativeAge(yesterday))
        assertEquals("3 days ago", formatRelativeAge(threeDays))
        assertEquals("2 weeks ago", formatRelativeAge(twoWeeks))
    }

    @Test fun `formatRelativeAge is null when older than a month or unparseable`() {
        val old = LocalDate.now().minusDays(90).format(DateTimeFormatter.ISO_LOCAL_DATE)
        assertNull(formatRelativeAge(old))
        assertNull(formatRelativeAge(null))
        assertNull(formatRelativeAge("nope"))
    }

    @Test fun `formats minutes and truncates fractional seconds`() {
        assertEquals("1:05", formatDuration(65.0))
        assertEquals("2:05", formatDuration(125.9)) // truncates, never rounds up
        assertEquals("9:59", formatDuration(599.0))
    }

    @Test fun `switches to h colon mm colon ss at an hour`() {
        assertEquals("1:00:00", formatDuration(3600.0))
        assertEquals("1:01:01", formatDuration(3661.0))
    }

    @Test fun `clamps negative input to zero`() {
        assertEquals("0:00", formatDuration(-5.0))
    }
}
