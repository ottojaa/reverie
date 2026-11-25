package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test

/**
 * A video whose stored MIME type is upper-case ("Video/MP4": the server keeps the case it was uploaded
 * with) is drawn as a video, the same as "video/mp4": play badge and duration pill on both tiles.
 * The right tile is a PDF, which gets neither.
 */
class GalleryThumbnailScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    @Test
    fun upperCaseVideoMimeDrawsAsVideo() {
        paparazzi.snapshot {
            ReverieTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Row(Modifier.padding(12.dp)) {
                        tile("lower", "video/mp4", "clip.mp4", 75.0)
                        tile("upper", "Video/MP4", "CLIP.MP4", 75.0)
                        tile("pdf", "application/pdf", "scan.pdf", null)
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun tile(id: String, mime: String, name: String, seconds: Double?) {
        GalleryThumbnail(
            documentId = id, mimeType = mime, filename = name, blurhash = null, hasThumbnail = false, isThumbnailReady = false,
            modifier = Modifier.padding(4.dp).size(112.dp), durationSeconds = seconds,
        )
    }
}
