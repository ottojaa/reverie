package com.reverie.app.ui.screens.upload

import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The "add" sheet behind the + in a header. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w640dp-h360dp")
class UploadActionSheetTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun `on a short screen the last row can be reached`() {
        compose.setContent {
            ReverieTheme {
                UploadActionSheet(onFilesPicked = {}, loadMedia = { emptyList() }, onDismiss = {}, onNewFolder = {})
            }
        }

        val bottom = compose.onNodeWithText("New folder").performScrollTo().getUnclippedBoundsInRoot().bottom

        assertTrue("the last row ends at $bottom", bottom <= 360.dp)
    }
}
