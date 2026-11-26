package com.reverie.app.ui.screens.browse

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The floating date with animations turned off in the system's settings. */
@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DateChipStillTest {
    private val noMotion = object : MotionDurationScale {
        override val scaleFactor = 0f
    }

    @get:Rule
    val compose = createComposeRule(noMotion)

    private var date by mutableStateOf(TopDate("Today", position = 0, isOverPhotos = true))

    @Test fun `the text just changes`() {
        compose.setContent {
            ReverieTheme { ScrollChips(topDate = date, processingCount = 0, onProcessingClick = {}, visibility = { 1f }) }
        }
        compose.mainClock.autoAdvance = false

        compose.runOnUiThread {
            date = TopDate("Yesterday", position = 3, isOverPhotos = true)
            Snapshot.sendApplyNotifications()
        }
        // Two frames: one to compose the change, one for the animation to find it has no duration.
        repeat(2) { compose.mainClock.advanceTimeByFrame() }

        compose.onAllNodesWithText("Today").assertCountEquals(0)
        compose.onAllNodesWithText("Yesterday").assertCountEquals(1)
    }
}
