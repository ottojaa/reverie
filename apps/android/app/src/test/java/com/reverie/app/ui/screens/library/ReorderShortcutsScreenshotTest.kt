package com.reverie.app.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

/**
 * The reorder sheet's content on a sheet-shaped surface (the sheet itself opens its own window, which a
 * screenshot does not include), under the end of the chip strip with the button that opens it.
 */
class ReorderShortcutsScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val links = LibraryLinks(
        onOpenFolder = {}, onOpenList = {}, onOpenMyFiles = {}, onOpenFavourites = {}, onSearch = {}, onOpenTrash = {},
    )

    private val marks = LibraryMarks(favouriteCount = 5)

    private val shortcuts = libraryShortcuts(
        listOf(
            QuickFilter("screenshots", "Screenshots", "q", count = 45),
            QuickFilter("receipts", "Receipts", "q", count = 3),
            QuickFilter("statements", "Statements", "q", count = 9),
            QuickFilter("large-files", "Large files", "q", count = 52),
        ),
        marks,
        links,
    )

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    private fun Page(state: ReorderState) = Box(Modifier.fillMaxSize()) {
        // Three chips are few enough to leave the strip's last button on screen.
        Column { LibraryChips(shortcuts.takeLast(2), onReorder = {}) }
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f)))
        Surface(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            shape = BottomSheetDefaults.ExpandedShape,
            color = MaterialTheme.colorScheme.surfaceContainerLow,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                BottomSheetDefaults.DragHandle()
                ReorderShortcuts(shortcuts, onReorder = {}, onDone = {}, state = state)
            }
        }
    }

    private fun state() = ReorderState(shortcuts.map { it.id })

    /** One row held, a little way from its place. */
    @Test fun dragging() {
        val held = state().apply { drag(shortcuts[1].id, by = -6f, rowHeight = 1_000) }
        paparazzi.snapshotThemes("dragging") { Page(held) }
    }

    /** A 320dp-wide phone with text at twice its size. */
    @Test fun narrowLargeText() {
        paparazzi.unsafeUpdateConfig(
            DeviceConfig.PIXEL_5.copy(
                screenWidth = 640, screenHeight = 1500, xdpi = 320, ydpi = 320, density = Density.XHIGH, fontScale = 2f,
            ),
        )
        paparazzi.snapshotThemes("narrowLargeText") { Page(state()) }
    }
}
