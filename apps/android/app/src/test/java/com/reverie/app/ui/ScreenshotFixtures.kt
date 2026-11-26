package com.reverie.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.platform.LocalInspectionMode
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.ui.components.BlurhashDecoder
import com.reverie.app.ui.components.painterCache
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode

/** Blurhashes stand in for thumbnails: a screenshot test has no network. */
internal val BLURHASHES =
    listOf("LEHV6nWB2yk8pyo0adR*.7kCMdnj", "L6PZfSi_.AyE_3t7t7R**0o#DgR4", "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", "L9AB*A%LPqWF_3ofWFj[IUWBM{WB")

/** Decodes the blurhashes up front: the real painter is made off-thread, after a screenshot's one frame. */
internal fun warmBlurhashes() {
    BLURHASHES.forEach { hash ->
        val bitmap = checkNotNull(BlurhashDecoder.decode(hash, 32, 24)) { "blurhash did not decode: $hash" }
        painterCache.put(hash, BitmapPainter(bitmap.asImageBitmap()))
    }
}

/** A folder cover of [tiles] photos. */
internal fun photoCover(folderId: String, tiles: Int = 4) = FolderCoverDto(
    tiles = (0 until tiles).map {
        FolderCoverTileDto("$folderId-$it", "image/jpeg", "IMG_$it.jpg", BLURHASHES[(folderId.length + it) % BLURHASHES.size])
    },
)

/** [content] on the app's background, recorded in the dark theme and in the light one. */
internal fun Paparazzi.snapshotThemes(state: String, content: @Composable () -> Unit) {
    warmBlurhashes()
    listOf(ThemeMode.DARK to "dark", ThemeMode.LIGHT to "light").forEach { (mode, name) ->
        snapshot("${state}_$name") {
            // Inspection mode makes Coil draw the placeholder instead of nothing.
            CompositionLocalProvider(LocalInspectionMode provides true) {
                ReverieTheme(themeMode = mode) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { content() }
                }
            }
        }
    }
}
