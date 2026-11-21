package com.reverie.app.ui.screens.viewer.insight

import com.reverie.app.data.api.model.DocumentPhotoMetadata
import com.reverie.app.data.api.model.DocumentVideoMetadata
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaFactsTest {

    @Test fun `camera row carries the camera over the exposure line`() {
        val photo = DocumentPhotoMetadata(
            camera_make = "Apple", camera_model = "iPhone 15 Pro", iso = 80, f_number = 1.78,
            exposure_time = 1.0 / 120, focal_length = 6.765, focal_length_35mm = 24.0, flash_fired = false,
        )

        assertEquals("Apple iPhone 15 Pro" to "ISO 80 · f/1.8 · 1/120 s · 6.8 mm (24 mm equiv.)", cameraSummary(photo))
    }

    @Test fun `a photo with no camera facts has no row`() {
        assertNull(cameraSummary(DocumentPhotoMetadata(city = "Helsinki", taken_at = "2024-05-01T14:03:22.000Z")))
    }

    @Test fun `camera facts without a camera name still show`() {
        assertEquals("ISO 400 · Flash" to null, cameraSummary(DocumentPhotoMetadata(iso = 400, flash_fired = true)))
        assertEquals("Canon EOS R5" to null, cameraSummary(DocumentPhotoMetadata(camera_make = "Canon", camera_model = "Canon EOS R5")))
    }

    @Test fun `shutter speeds read the way a camera shows them`() {
        assertEquals("1/4000 s", formatExposureTime(1.0 / 4000))
        assertEquals("1/2 s", formatExposureTime(0.5))
        assertEquals("30 s", formatExposureTime(30.0))
        assertEquals("1.3 s", formatExposureTime(1.3))
    }

    @Test fun `focal length is written once when both agree`() {
        assertEquals("50 mm", formatFocalLength(50.0, 50.0))
        assertEquals("24 mm equiv.", formatFocalLength(null, 24.0))
        assertNull(formatFocalLength(null, null))
    }

    @Test fun `video row lists codec size frame rate audio bitrate and duration`() {
        val video = DocumentVideoMetadata(
            video_codec = "hevc", width = 3840, height = 2160, rotation = 0, is_hdr = true,
            frame_rate = 29.97, audio_codec = "aac", bitrate = 42_500_000,
        )

        assertEquals("HEVC · 3840 × 2160 · HDR · 29.97 fps" to "AAC · 42.5 Mbit/s · 1:02:07", videoSummary(video, 3727.0))
    }

    @Test fun `a clip stored sideways shows the size a player shows`() {
        val video = DocumentVideoMetadata(video_codec = "h264", width = 1920, height = 1080, rotation = 90)

        assertEquals("H.264 · 1080 × 1920", videoSummary(video, null)?.first)
    }

    @Test fun `a video with no audio says so and unprobed fields are left out`() {
        assertEquals("H.264 · 30 fps" to "No audio · 0:05", videoSummary(DocumentVideoMetadata(video_codec = "h264", frame_rate = 30.0), 5.0))
        assertNull(videoSummary(DocumentVideoMetadata(), null))
    }
}
