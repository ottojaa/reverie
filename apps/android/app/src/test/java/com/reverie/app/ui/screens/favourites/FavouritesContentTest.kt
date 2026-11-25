package com.reverie.app.ui.screens.favourites

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Using the Favourites screen: its chips, cards and stars, by touch and by keyboard. */
@OptIn(ExperimentalTestApi::class, ExperimentalComposeUiApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FavouritesContentTest {
    @get:Rule
    val compose = createComposeRule()

    private var filter by mutableStateOf(FavouriteFilter.ALL)
    private var inputMode: InputModeManager? = null
    private val calls = mutableListOf<String>()

    private fun show(state: FavouritesState = FavouriteFixtures.loaded) = compose.setContent {
        inputMode = LocalInputModeManager.current
        ReverieTheme {
            FavouritesContent(
                state,
                filter,
                FavouritesActions(
                    onBack = { calls += "back" },
                    onFilter = { filter = it },
                    onOpen = { calls += "open:${it.id}" },
                    onUnstar = { calls += "unstar:${it.id}" },
                ),
            )
        }
    }

    @Test fun `the chips narrow the grid and leave the count alone`() {
        show()

        compose.onNodeWithText("Folders").performClick()
        compose.onNodeWithText("Folders").assertIsSelected()
        compose.onNodeWithText("Portugal - 2025").assertIsDisplayed()
        compose.onNodeWithText("invoice-march.pdf").assertDoesNotExist()
        compose.onNodeWithText("3 folders · 4 files").assertIsDisplayed()

        compose.onNodeWithText("Files").performClick()
        compose.onNodeWithText("invoice-march.pdf").assertIsDisplayed()
        compose.onNodeWithText("Portugal - 2025").assertDoesNotExist()
    }

    @Test fun `a card opens its item, and its star only unstars it`() {
        show()

        compose.onNodeWithText("Portugal - 2025").performClick()
        compose.onAllNodesWithContentDescription("Remove from favourites").onFirst().performClick()
        compose.onNodeWithContentDescription("Back").performClick()

        assertEquals(listOf("open:f-portugal", "unstar:f-portugal", "back"), calls)
    }

    @Test fun `a long list scrolls to its last card`() {
        val many = (1..60).map { FavouriteFixtures.file(FavouriteFixtures.document("d$it", "scan-$it.pdf", "application/pdf", 1_000)) }
        show(FavouritesState(items = many))

        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("scan-60.pdf"))

        compose.onNodeWithText("scan-60.pdf").assertIsDisplayed()
    }

    @Test fun `Enter picks a focused chip and opens a focused card`() {
        show()
        compose.runOnIdle { inputMode!!.requestInputMode(InputMode.Keyboard) }

        pressEnterOn("Folders")
        compose.onNodeWithText("Folders").assertIsSelected()
        pressEnterOn("Builds")

        assertEquals(listOf("open:f-builds"), calls)
    }

    private fun pressEnterOn(text: String) {
        compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText(text).performKeyInput { pressKey(Key.Enter) }
        compose.waitForIdle()
    }
}
