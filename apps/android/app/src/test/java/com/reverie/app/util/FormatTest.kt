package com.reverie.app.util

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {

    @Test fun `formats sub-minute durations as m colon ss`() {
        assertEquals("0:00", formatDuration(0.0))
        assertEquals("0:05", formatDuration(5.0))
        assertEquals("0:59", formatDuration(59.0))
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
