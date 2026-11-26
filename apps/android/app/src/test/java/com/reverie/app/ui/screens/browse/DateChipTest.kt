package com.reverie.app.ui.screens.browse

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The floating date: where it stands, and how one date makes way for the next. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class DateChipTest {
    @get:Rule
    val compose = createComposeRule()

    private var date by mutableStateOf(TopDate("Today", position = 0, isOverPhotos = true))
    private var headerPx by mutableStateOf(0)

    private fun show() = compose.setContent {
        ReverieTheme {
            ScrollChips(
                topDate = date, processingCount = 0, onProcessingClick = {}, visibility = { 0f },
                dateBelow = { headerPx },
            )
        }
    }

    private fun top(text: String): Dp = compose.onNodeWithText(text).getUnclippedBoundsInRoot().top

    /** Shows [next] with the clock stopped, so that a test steps through the change. */
    private fun change(next: TopDate) {
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            date = next
            Snapshot.sendApplyNotifications()
        }
    }

    /** The dates' tops part way through a change from "Today" to [next]. */
    private fun midway(next: TopDate): Pair<Dp, Dp> {
        change(next)
        compose.mainClock.advanceTimeBy(80)
        return top("Today") to top(next.title)
    }

    @Test fun `scrolling down, the new date comes up from below as the old one leaves upward`() {
        show()
        val resting = top("Today")

        val (old, new) = midway(TopDate("Yesterday", position = 3, isOverPhotos = true))

        assertTrue("old $old, resting $resting", old < resting)
        assertTrue("new $new, resting $resting", new > resting)
    }

    @Test fun `scrolling up, the new date comes down from above`() {
        date = date.copy(position = 5)
        show()
        val resting = top("Today")

        val (old, new) = midway(TopDate("Tomorrow", position = 2, isOverPhotos = true))

        assertTrue("old $old, resting $resting", old > resting)
        assertTrue("new $new, resting $resting", new < resting)
    }

    @Test fun `the change is over quickly, leaving only the new date where the old one stood`() {
        show()
        val resting = top("Today")

        change(TopDate("Yesterday", position = 3, isOverPhotos = true))
        compose.mainClock.advanceTimeBy(260)

        compose.onAllNodesWithText("Today").assertCountEquals(0)
        assertTrue(top("Yesterday") == resting)
    }

    @Test fun `over photos the date stays under the header, though nothing has been scrolled away`() {
        show()
        val atTop = top("Today")

        headerPx = 200

        assertTrue(top("Today") > atTop)
    }
}
