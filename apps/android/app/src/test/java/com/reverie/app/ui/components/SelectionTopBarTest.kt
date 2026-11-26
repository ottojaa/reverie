package com.reverie.app.ui.components

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The bar over a list while rows are selected. */
@RunWith(RobolectricTestRunner::class)
// Native graphics, so text is measured with real glyph widths.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w320dp-h640dp")
class SelectionTopBarTest {
    @get:Rule
    val compose = createComposeRule()

    @Test fun `a large count stays whole on one line on a narrow phone`() {
        compose.setContent {
            ReverieTheme { SelectionTopBar(count = 1252, onClose = {}, onDownload = {}, onMove = {}, onDelete = {}) }
        }

        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText("1252 selected").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }

        assertEquals(1, layouts.single().lineCount)
        assertFalse("the count is cut off", layouts.single().hasVisualOverflow)
    }
}
