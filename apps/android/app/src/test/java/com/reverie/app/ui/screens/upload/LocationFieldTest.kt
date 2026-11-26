package com.reverie.app.ui.screens.upload

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the upload screen's Location says, and the line under it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class LocationFieldTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(state: ReviewState) = compose.setContent { ReverieTheme { LocationField(state, onClick = {}) } }

    @Test fun `with no folder chosen it says My files, and offers a folder`() {
        show(ReviewState(files = emptyList()))

        compose.onNodeWithText("My files").assertIsDisplayed()
        compose.onNodeWithText("In My files. Tap to choose a folder.").assertIsDisplayed()
    }

    @Test fun `with a folder chosen it offers another`() {
        show(ReviewState(files = emptyList(), folderId = "trips", folderName = "Trips"))

        compose.onNodeWithText("Trips").assertIsDisplayed()
        compose.onNodeWithText("Tap to choose another folder.").assertIsDisplayed()
    }
}
