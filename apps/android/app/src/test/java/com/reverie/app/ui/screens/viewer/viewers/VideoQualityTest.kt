package com.reverie.app.ui.screens.viewer.viewers

import org.junit.Assert.assertEquals
import org.junit.Test

class VideoQualityTest {
    @Test
    fun `a rung is named by the picture's shorter side`() {
        assertEquals("1080p", toQualityLabel(1920, 1080))
        assertEquals("1080p", toQualityLabel(1080, 1920))
        assertEquals("480p", toQualityLabel(854, 480))
    }

    @Test
    fun `a rotated signature leaves the set key alone`() {
        val hash = "a".repeat(64)
        val first = "/files/hls/1790000000/AbC-_1/$hash/master.m3u8"
        val rotated = "https://api.example.dev/files/hls/1790003600/ZzY_-9/$hash/master.m3u8"

        assertEquals(toHlsSetKey(first), toHlsSetKey(first.replace("1790000000/AbC-_1", "1790003600/XyZ")))
        assertEquals("/files/hls/$hash/master.m3u8", toHlsSetKey(first))
        assertEquals("https://api.example.dev/files/hls/$hash/master.m3u8", toHlsSetKey(rotated))
    }
}
