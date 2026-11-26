package com.reverie.app.ui.screens.library

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** The shortcut strip's order, and the sheet that changes it without dragging (see ReorderDragTest for that). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class ReorderShortcutsTest {
    @get:Rule
    val compose = createComposeRule()

    private val state = LibraryState(
        smartViews = listOf(
            QuickFilter("screenshots", "Screenshots", "q", count = 45),
            QuickFilter("receipts", "Receipts", "q", count = 3),
        ),
    )
    private var order by mutableStateOf(emptyList<String>())
    private val moves = mutableListOf<List<String>>()

    private fun show() = compose.setContent {
        ReverieTheme {
            val rows = RowActions(selected = { false }, onClick = {}, onLongClick = {})
            LibraryBody(
                state = state,
                marks = LibraryMarks(favouriteCount = 5, shortcutOrder = order),
                links = LibraryLinks({}, {}, {}, {}, {}, {}),
                actions = LibraryActions(
                    rows, rows, onLoadMore = {}, onNewFolder = {}, onFocusConsumed = {},
                    // What the view model does with a move, without the disk.
                    onReorderShortcuts = {
                        moves += it
                        order = reorderedShortcuts(orderedShortcuts(order), it)
                    },
                ),
                day = LibraryDay(LocalDate.of(2026, 11, 26), ZoneOffset.UTC),
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onTopDate = {}, onUpload = {}),
            )
        }
    }

    private val labels = listOf("Favourites", "Screenshots", "Receipts", "Trash")

    private fun stripOrder() = labels.sortedBy { compose.onNodeWithText(it).getUnclippedBoundsInRoot().left }

    private fun handle(label: String) = compose.onNodeWithContentDescription("Move $label")

    private fun sheetOrder() = labels.sortedBy { handle(it).getUnclippedBoundsInRoot().top }

    private fun openSheet() {
        compose.onNodeWithContentDescription("Reorder shortcuts").performScrollTo().performClick()
        compose.waitForIdle()
    }

    private fun done() {
        compose.onNodeWithText("Done").performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
    }

    private fun movesOf(label: String) =
        handle(label).fetchSemanticsNode().config[SemanticsActions.CustomActions]

    private fun move(label: String, direction: String) {
        val action = movesOf(label).single { it.label == direction }
        compose.runOnUiThread { action.action() }
        compose.waitForIdle()
    }

    @Test fun `the strip draws the chips in the saved order`() {
        order = listOf("trash", "receipts", "favourites", "screenshots")
        show()

        assertEquals(listOf("Trash", "Receipts", "Favourites", "Screenshots"), stripOrder())
    }

    @Test fun `a button ends the strip and opens a sheet listing the chips on show`() {
        show()
        val button = compose.onNodeWithContentDescription("Reorder shortcuts").getUnclippedBoundsInRoot()
        assertEquals(true, button.left > compose.onNodeWithText("Trash").getUnclippedBoundsInRoot().right)

        openSheet()

        compose.onNodeWithText("Reorder shortcuts").assertIsDisplayed()
        compose.onNodeWithText("Hold a handle and drag.").assertIsDisplayed()
        assertEquals(labels, sheetOrder())
        compose.onNodeWithContentDescription("Move Statements").assertDoesNotExist()
    }

    @Test fun `each chip can be moved without dragging`() {
        show()
        openSheet()

        move("Receipts", "Move up")
        move("Receipts", "Move up")
        move("Favourites", "Move down")

        assertEquals(listOf("Receipts", "Screenshots", "Favourites", "Trash"), sheetOrder())
        done()
        assertEquals(listOf("Receipts", "Screenshots", "Favourites", "Trash"), stripOrder())
    }

    @Test fun `the first chip cannot move up, nor the last down`() {
        show()
        openSheet()

        assertEquals(listOf("Move down"), movesOf("Favourites").map { it.label })
        assertEquals(listOf("Move up", "Move down"), movesOf("Screenshots").map { it.label })
        assertEquals(listOf("Move up"), movesOf("Trash").map { it.label })
    }
}
