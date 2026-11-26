package com.reverie.app.ui.screens.privatefolders

import android.os.Looper
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.lifecycle.viewModelScope
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The private folders screen over its view model and a fake server: which folders it lists and what a row does. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class PrivateFoldersScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val diary = node("Diary", parent = "Travel", isPrivate = true, lockId = "Diary")
    private val letters = node("Letters", parent = "Papers", lockId = "Papers")
    private val papers = node(
        "Papers", isPrivate = true, locked = false,
        children = listOf(letters),
    )
    private val vaulted = node("Vaulted", isPrivate = true, locked = true)

    private val world = FavouriteWorld().apply {
        tree = listOf(node("Travel", children = listOf(diary)), papers, vaulted)
    }
    private val calls = mutableListOf<String>()
    private lateinit var viewModel: PrivateFoldersViewModel

    @After fun tearDown() = viewModel.viewModelScope.cancel()

    private fun open() {
        viewModel = PrivateFoldersViewModel(world.deps)
        compose.setContent {
            ReverieTheme {
                PrivateFoldersScreen(
                    onBack = { calls += "back" },
                    onOpenFolder = { calls += "folder:$it" },
                    viewModel = viewModel,
                )
            }
        }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    @Test fun `folders marked private are listed at any depth, and nothing else`() {
        open()
        awaitText("Diary")

        compose.onNodeWithText("Papers").assertExists()
        compose.onNodeWithText("Vaulted").assertExists()
        compose.onNodeWithText("Locked").assertExists()
        compose.onNodeWithText("3 folders").assertExists()
        compose.onNodeWithText("Travel").assertDoesNotExist()
        compose.onNodeWithText("Letters").assertDoesNotExist()
    }

    @Test fun `a row opens its folder and back leaves`() {
        open()
        awaitText("Vaulted")

        compose.onNodeWithText("Vaulted").performClick()
        compose.onNodeWithContentDescription("Back").performClick()

        assertEquals(listOf("folder:Vaulted", "back"), calls)
    }

    @Test fun `a held row can be removed from private`() {
        open()
        awaitText("Diary")

        compose.onNodeWithText("Diary").performTouchInput { longClick() }
        awaitText("Remove from private")
        compose.onNodeWithText("Remove from private").performSemanticsAction(SemanticsActions.OnClick)

        await { world.requests.any { it == """PATCH folders/Diary {"is_private":false}""" } }
    }

    @Test fun `with no private folders it says how to make one`() {
        world.tree = listOf(node("Travel"))
        open()

        awaitText("No private folders. To make one, hold a folder and choose Make private.")
    }
}
