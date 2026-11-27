package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test

/**
 * Names under both captioned tiles, at a grid tile's width and a narrower one. Left to right: one whose
 * extension would be split, one too long for two lines, one with a long extension, and one with none.
 */
class FileTileNameScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val files = listOf(
        "application/zip" to "holiday-originals.zip",
        "application/vnd.android.package-archive" to "reverie-android-1.12.0-release-universal.apk",
        "application/octet-stream" to "Household budget with the new flat.numbers",
        "application/octet-stream" to "a-very-long-name-with-no-extension-at-all",
    )

    @Test fun longNamesDark() = snapshot(isDark = true)

    @Test fun longNamesLight() = snapshot(isDark = false)

    private fun snapshot(isDark: Boolean) {
        paparazzi.snapshot {
            ReverieTheme(themeMode = if (isDark) ThemeMode.DARK else ThemeMode.LIGHT) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Column(Modifier.padding(4.dp), Arrangement.spacedBy(2.dp)) {
                        listOf(124.dp, 92.dp).forEach { width ->
                            FolderTiles(width)
                            GalleryTiles(width)
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun FolderTiles(width: Dp) = Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        files.take(visible(width)).forEach { (mime, name) ->
            FileTypeTile(mime, name, Modifier.size(width), 28.dp, name)
        }
    }

    @Composable
    private fun GalleryTiles(width: Dp) = Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        files.take(visible(width)).forEach { (mime, name) ->
            GalleryThumbnail(
                documentId = name, mimeType = mime, filename = name, blurhash = null, hasThumbnail = false,
                modifier = Modifier.size(width),
            )
        }
    }

    /** As many tiles of [width] as the screen is wide enough for. */
    private fun visible(width: Dp): Int = if (width > 100.dp) 3 else 4
}
