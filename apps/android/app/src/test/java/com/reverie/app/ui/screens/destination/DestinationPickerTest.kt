package com.reverie.app.ui.screens.destination

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithContentDescription
import android.os.Looper
import android.view.KeyEvent
import androidx.activity.ComponentDialog
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

/** The "Select destination" browser over a real repository: walking, locks, search, new folders, back. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DestinationPickerTest {
    @get:Rule
    val compose = createComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val world = FavouriteWorld().apply {
        tree = listOf(
            node("Photos", children = listOf(node("Portugal", "Photos"))),
            node("Secret", isPrivate = true, locked = true),
        )
    }
    private val browser = DestinationBrowser(world.folders, world.vault, scope)
    private val selected = mutableListOf<Destination>()

    @After fun tearDown() = scope.cancel()

    private fun show(rules: DestinationRules = DestinationRules()) {
        compose.setContent { ReverieTheme { DestinationPickerDialog(browser, onSelect = { selected += it }) } }
        browser.show(rules)
        awaitText("Photos")
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) =
        await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun press(keyCode: Int) {
        val dialog = ShadowDialog.getLatestDialog() as ComponentDialog
        compose.runOnUiThread {
            dialog.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
            dialog.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        }
        compose.waitForIdle()
    }

    @Test fun `walking into a folder and selecting it hands it back and closes`() {
        show()
        compose.onNodeWithText("Photos").performClick()
        awaitText("Portugal")
        compose.onNodeWithText("Portugal").performClick()
        awaitText("Select Portugal")

        compose.onNodeWithText("Select Portugal").performClick()

        assertEquals(listOf(Destination("Portugal", "Portugal")), selected)
        await { browser.state.value == null }
    }

    @Test fun `back goes up a level at a time, then closes with nothing picked`() {
        show()
        compose.onNodeWithText("Photos").performClick()
        awaitText("Portugal")
        compose.onNodeWithText("Portugal").performClick()
        awaitText("Select Portugal")

        press(KeyEvent.KEYCODE_BACK)
        awaitText("Select Photos")
        press(KeyEvent.KEYCODE_BACK)
        awaitText("Select My files")
        press(KeyEvent.KEYCODE_BACK)

        await { browser.state.value == null }
        assertEquals(emptyList<Destination>(), selected)
    }

    @Test fun `Escape does what back does`() {
        show()
        compose.onNodeWithText("Photos").performClick()
        awaitText("Select Photos")

        press(KeyEvent.KEYCODE_ESCAPE)

        awaitText("Select My files")
    }

    @Test fun `a locked folder asks for the password, and opens once it is accepted`() {
        show()
        compose.onNodeWithText("Secret").performClick()
        awaitText("Unlock Secret")
        assertNull(browser.state.value?.at)
        world.tree = listOf(node("Secret", children = listOf(node("Letters", "Secret", lockId = "Secret")), isPrivate = true))

        compose.onNode(hasSetTextAction()).performTextInput("hunter2")
        compose.onNode(hasSetTextAction()).performImeAction()

        awaitText("Letters")
        compose.onNodeWithText("Select Secret").assertIsEnabled()
    }

    @Test fun `Enter in the search opens the only folder that matches`() {
        show()
        compose.onNodeWithContentDescription("Search folders").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("portu")
        awaitText("My files › Photos")
        // No folder is being looked at among the results, so there is none to select.
        compose.onNodeWithText("Select My files").assertDoesNotExist()
        compose.onNodeWithText("Open a folder to select it.").assertIsDisplayed()

        compose.onNode(hasSetTextAction()).performImeAction()

        awaitText("Select Portugal")
    }

    @Test fun `Enter on a new folder's name creates it here and goes into it`() {
        show()
        compose.onNodeWithText("Photos").performClick()
        awaitText("Select Photos")
        compose.onNodeWithContentDescription("New folder here").performClick()
        compose.onNode(hasSetTextAction() and hasText("Name")).performTextInput("Norway")

        compose.onNode(hasSetTextAction() and hasText("Norway")).performImeAction()

        awaitText("Select Norway")
        assertEquals(true, world.requests.any { it.startsWith("POST folders ") && "\"parent_id\":\"Photos\"" in it })
    }

    @Test fun `a backup destination offers no private folder and not the root itself`() {
        show(DestinationRules(allowPrivate = false, allowTop = false))

        compose.onNodeWithText("Secret").assertDoesNotExist()
        compose.onNodeWithText("Select My files").assertIsNotEnabled()
        compose.onNodeWithText("Open a folder to select it.").assertIsDisplayed()
    }


    @Test fun `each folder to choose from wears the folder badge, a locked one with its lock`() {
        show()

        compose.onAllNodesWithContentDescription("Folder", useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithContentDescription("Locked folder", useUnmergedTree = true).assertCountEquals(1)
    }
}
