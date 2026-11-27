package com.reverie.app.ui.screens.favourites

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The whole Favourites screen on a fake server: a locked private tile, its unlock prompt, and where it leads. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FavouritesScreenUnlockTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld().apply {
        items = listOf(FavouriteFixtures.private("d-secret", locked = true))
    }
    private val opened = mutableListOf<Pair<String, Float?>>()

    private fun openPrompt() {
        val viewModel = FavouritesViewModel(world.deps)
        compose.setContent {
            ReverieTheme {
                FavouritesScreen(
                    onBack = {},
                    onOpenFolder = { opened += it to null },
                    onDocumentClick = { id, aspect -> opened += id to aspect },
                    viewModel = viewModel,
                )
            }
        }
        waitForText("Private")
        compose.onNodeWithText("Private").performClick()
        waitForText("Unlock private folder")
        compose.waitUntil(5_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun waitForText(text: String) = compose.waitUntil(5_000) {
        runCatching { compose.onNodeWithText(text).assertIsDisplayed() }.isSuccess
    }

    @Test fun `the keyboard's done key unlocks and opens the private document`() {
        openPrompt()
        assertEquals(emptyList<Pair<String, Float?>>(), opened)

        compose.onNode(hasSetTextAction()).performTextInput("hunter2")
        compose.onNode(hasSetTextAction()).performImeAction()
        // The answer arrives off the main thread; waiting for idle lets the main looper deliver it.
        compose.waitUntil(5_000) {
            compose.waitForIdle()
            opened.isNotEmpty()
        }

        assertEquals(listOf("d-secret" to null), opened.toList())
        assertEquals(1, world.requests.count { it.startsWith("POST vault/unlock") })
    }

    @Test fun `dismissing the prompt opens nothing`() {
        openPrompt()

        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss))
            .performSemanticsAction(SemanticsActions.Dismiss)
        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithText("Unlock private folder").assertDoesNotExist() }.isSuccess
        }

        assertEquals(emptyList<Pair<String, Float?>>(), opened)
        assertEquals(0, world.requests.count { it.startsWith("POST vault/unlock") })
    }
}
