package com.reverie.app.ui.screens.library

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Dragging the handles of the "Reorder shortcuts" sheet. What the sheet holds is shown on its own here,
 * because Robolectric delivers no touches to a bottom sheet's window.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class ReorderDragTest {
    @get:Rule
    val compose = createComposeRule()

    private val labels = listOf("Favourites", "Screenshots", "Receipts", "Trash")
    private val moves = mutableListOf<List<String>>()

    /** The order the sheet is given its chips in. */
    private var given by mutableStateOf(labels)

    private fun show() = compose.setContent {
        ReverieTheme {
            Surface {
                ReorderShortcuts(
                    shortcuts = given.map { Shortcut(it, Icons.Outlined.Search, it, count = null, onOpen = {}) },
                    onReorder = { moves += it },
                    onDone = {},
                )
            }
        }
    }

    private fun handle(label: String) = compose.onNodeWithContentDescription("Move $label")

    private fun sheetOrder() = labels.sortedBy { handle(it).getUnclippedBoundsInRoot().top }

    /** One finger on [label]'s handle, moved [rows] rows (negative: up) in small steps. */
    private fun drag(label: String, rows: Float) {
        handle(label).performTouchInput {
            down(center)
            repeat(10) { moveBy(Offset(0f, rows * 56.dp.toPx() / 10)) }
            up()
        }
        compose.waitForIdle()
    }

    @Test fun `dragging a handle up moves its chip past the ones it crosses, and says so once`() {
        show()

        drag("Trash", rows = -3f)

        val expected = listOf("Trash", "Favourites", "Screenshots", "Receipts")
        assertEquals(expected, sheetOrder())
        assertEquals(listOf(expected), moves)
    }

    @Test fun `dragging a handle down moves its chip`() {
        show()

        drag("Favourites", rows = 2f)

        assertEquals(listOf("Screenshots", "Receipts", "Favourites", "Trash"), sheetOrder())
    }

    @Test fun `a chip dragged past the end stops there`() {
        show()

        drag("Receipts", rows = 6f)

        assertEquals(listOf("Favourites", "Screenshots", "Trash", "Receipts"), sheetOrder())
    }

    @Test fun `a drag that does not pass half a row moves nothing`() {
        show()

        drag("Receipts", rows = -0.4f)

        assertEquals(labels, sheetOrder())
    }

    @Test fun `a second drag starts from where the first one left the chip`() {
        show()

        drag("Trash", rows = -1f)
        drag("Trash", rows = -1f)

        assertEquals(listOf("Favourites", "Trash", "Screenshots", "Receipts"), sheetOrder())
    }

    /** Saving takes a moment, so an order can come back to the sheet when the next drag is already under way. */
    @Test fun `the saved order coming back during the next drag leaves that drag going`() {
        show()
        drag("Trash", rows = -1f)

        handle("Favourites").performTouchInput {
            down(center)
            repeat(5) { moveBy(Offset(0f, 0.3f * 56.dp.toPx() / 5)) }
        }
        compose.runOnUiThread { given = moves.last() }
        compose.waitForIdle()
        handle("Favourites").performTouchInput {
            repeat(5) { moveBy(Offset(0f, 0.4f * 56.dp.toPx() / 5)) }
            up()
        }
        compose.waitForIdle()

        // More than half a row between the two parts of the one drag.
        assertEquals(listOf("Screenshots", "Favourites", "Trash", "Receipts"), sheetOrder())
    }
}
