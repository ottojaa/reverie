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
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.domain.CachedFolders
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Favourites screen's sections, and using what is in them by touch and by keyboard. */
@OptIn(ExperimentalTestApi::class, ExperimentalComposeUiApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class FavouritesContentTest {
    @get:Rule
    val compose = createComposeRule()

    private var state by mutableStateOf(FavouriteFixtures.loaded)
    private var focusedId by mutableStateOf<String?>(null)
    private var inputMode: InputModeManager? = null
    private val calls = mutableListOf<String>()

    /** The tree knows one of the starred folders; the others are drawn from the favourite itself. */
    private val portugal = node("f-portugal").copy(name = "Portugal - 2025", kind_counts = KindCountsDto(image = 25))

    private fun show(isFetching: Boolean = false) = compose.setContent {
        inputMode = LocalInputModeManager.current
        ReverieTheme {
            FavouritesContent(
                state = state,
                folders = CachedFolders(byId = mapOf(portugal.id to portugal)),
                actions = FavouritesActions(
                    onBack = { calls += "back" },
                    onOpen = { calls += "open:${it.id}" },
                    onUnstar = { calls += "unstar:${it.id}" },
                    onHoldFolder = { calls += "hold:${it.id}" },
                    onRefresh = {},
                    onFocusConsumed = { focusedId = null },
                ),
                isFetching = isFetching,
                focusedId = focusedId,
            )
        }
    }

    private fun hold(text: String) {
        compose.onNodeWithText(text).performTouchInput { longClick() }
    }

    @Test fun `the screen counts and lists its three kinds of favourite`() {
        show()

        compose.onNodeWithText("3 folders · 1 photo · 1 video · 3 files").assertIsDisplayed()
        compose.onNodeWithText("Folders").assertIsDisplayed()
        compose.onNodeWithText("Photos and videos").assertIsDisplayed()
        compose.onNodeWithText("Files").assertIsDisplayed()
        compose.onNodeWithContentDescription("sunset.jpg").assertIsDisplayed()
        compose.onNodeWithText("0:42").assertIsDisplayed()
        compose.onNodeWithText("PDF · Other › Misc").assertIsDisplayed()
        compose.onNodeWithText("25 photos · in Photos").assertIsDisplayed()
    }

    @Test fun `a section is there only while something is in it`() {
        state = FavouriteFixtures.state(FavouriteFixtures.portugal)
        show()

        compose.onNodeWithText("Folders").assertIsDisplayed()
        compose.onNodeWithText("Photos and videos").assertDoesNotExist()
        compose.onNodeWithText("Files").assertDoesNotExist()

        state = FavouriteFixtures.state(FavouriteFixtures.notes)

        compose.onNodeWithText("Files").assertIsDisplayed()
        compose.onNodeWithText("Folders").assertDoesNotExist()
    }

    @Test fun `a tap opens each kind of favourite, and Back leaves`() {
        show()

        compose.onNodeWithText("Portugal - 2025").performClick()
        compose.onNodeWithContentDescription("sunset.jpg").performClick()
        compose.onNodeWithText("invoice-march.pdf").performClick()
        compose.onNodeWithText("Private").performClick()
        compose.onNodeWithContentDescription("Back").performClick()

        assertEquals(listOf("open:f-portugal", "open:d-sunset", "open:d-invoice", "open:d-secret", "back"), calls)
    }

    @Test fun `a private favourite says only what a tap will do`() {
        state = FavouriteFixtures.state(FavouriteFixtures.secret)
        show()

        compose.onNodeWithText("Private").assertIsDisplayed()
        compose.onNodeWithText("Unlock to see").assertIsDisplayed()
    }

    @Test fun `a long press on a folder asks for the folder's actions`() {
        show()

        hold("Portugal - 2025")

        assertEquals(listOf("hold:f-portugal"), calls)
    }

    @Test fun `a long press on anything else offers to unstar it`() {
        show()

        listOf("invoice-march.pdf", "Builds", "Private").forEach { name ->
            hold(name)
            compose.onNodeWithText("Remove from favourites").performClick()
        }
        compose.onNodeWithContentDescription("sunset.jpg").performTouchInput { longClick() }
        compose.onNodeWithText("Remove from favourites").performClick()

        assertEquals(listOf("unstar:d-invoice", "unstar:f-builds", "unstar:d-secret", "unstar:d-sunset"), calls)
    }

    @Test fun `Enter opens the focused row`() {
        show()
        compose.runOnIdle { inputMode!!.requestInputMode(InputMode.Keyboard) }

        compose.onNodeWithText("Builds").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Builds").performKeyInput { pressKey(Key.Enter) }

        assertEquals(listOf("open:f-builds"), calls)
    }

    private val many = (1..60).map {
        FavouriteFixtures.file(FavouriteFixtures.document("d$it", "scan-$it.pdf", "application/pdf", 1_000))
    }

    @Test fun `a long list scrolls to its last row`() {
        state = FavouritesState(items = many)
        show()

        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("scan-60.pdf"))

        compose.onNodeWithText("scan-60.pdf").assertIsDisplayed()
    }

    @Test fun `coming back from the viewer brings its document into view and is then done with`() {
        state = FavouritesState(items = many)
        show()

        focusedId = "d50"

        compose.onNodeWithText("scan-50.pdf").assertIsDisplayed()
        assertNull(focusedId)
    }

    @Test fun `with nothing starred the screen says how to star`() {
        state = FavouriteFixtures.state()
        show()

        compose.onNodeWithText("Nothing starred yet. Star a file or folder to find it here.").assertIsDisplayed()
    }

    @Test fun `a list that could not be read offers a pull`() {
        state = FavouritesState()
        show()

        compose.onNodeWithText("Couldn't load favourites. Pull down to try again.").assertIsDisplayed()
    }
}
