package com.reverie.app.ui.screens.manage

import android.os.Looper
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.api.model.FavouriteType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The selection bar, and the dialogs it leads to. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class ManageHostTest {
    @get:Rule
    val compose = createComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val world = FavouriteWorld()
    private val manage = ManageController(world.folders, world.documents, world.vault, world.controller(), scope)
    private val selection = Selection()
    private val trips = node("Trips").copy(kind_counts = KindCountsDto(image = 12))
    private var back: OnBackPressedDispatcher? = null

    @After fun tearDown() = scope.cancel()

    private fun select(folder: FolderWithChildren) {
        compose.setContent {
            back = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
            val ids by selection.ids.collectAsStateWithLifecycle()
            ReverieTheme {
                PickedSelection(pickFrom(ids, folders = listOf(folder)), selection, manage)
                ManageHost(manage, SnackbarHostState())
            }
        }
        compose.runOnIdle { selection.toggle(folder.id) }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun tap(description: String) = compose.onNodeWithContentDescription(description).performClick()

    /** A click by its action: Robolectric drops some touches on a dialog's window. */
    private fun press(text: String) {
        compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)
    }

    @Test fun `Trash says what goes with the folder, then deletes it and ends the selection`() {
        val question = "12 files go to Trash with it. You can restore it from Trash."
        select(trips)

        tap("Move to Trash")
        compose.onNodeWithText(question).assertIsDisplayed()
        press("Move to Trash")

        await { "DELETE folders/Trips" in world.requests && selection.ids.value.isEmpty() }
        compose.onNodeWithText(question).assertDoesNotExist()
    }

    @Test fun `cancelling a delete keeps the selection`() {
        select(trips)

        tap("Move to Trash")
        press("Cancel")

        compose.onNodeWithText("1 selected").assertIsDisplayed()
        assertEquals(setOf("Trips"), selection.ids.value)
    }

    @Test fun `Back ends the selection`() {
        select(trips)
        compose.onNodeWithText("1 selected").assertIsDisplayed()

        compose.runOnIdle { back?.onBackPressed() }

        compose.onNodeWithText("1 selected").assertDoesNotExist()
        assertEquals(emptySet<String>(), selection.ids.value)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `Enter runs the focused menu item`() {
        select(trips)
        tap("More folder actions")

        compose.onNodeWithText("Rename").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Rename").performKeyInput { pressKey(Key.Enter) }

        compose.onNodeWithText("Edit folder").assertIsDisplayed()
    }

    @Config(qualifiers = "w320dp-h480dp")
    @Test fun `on a small screen the bar keeps every action and the menu its last row`() {
        select(trips)

        listOf("Add to favourites", "Move", "Move to Trash").forEach {
            compose.onNodeWithContentDescription(it).assertIsDisplayed()
        }
        tap("More folder actions")

        compose.onNodeWithText("Make private").assertIsDisplayed()
    }

    @Test fun `a folder private through one above it is not offered to change that`() {
        select(node("Taxes", parent = "Safe", lockId = "Safe"))

        tap("More folder actions")

        compose.onNodeWithText("Rename").assertIsDisplayed()
        compose.onNodeWithText("Make private").assertDoesNotExist()
        compose.onNodeWithText("Remove from private").assertDoesNotExist()
    }

    private fun bar(picked: Picked) = compose.setContent {
        ReverieTheme { PickedTopBar(picked, isStarred = false, canDownload = true, onClose = {}, onPick = {}) }
    }

    private fun shows(vararg descriptions: String) {
        val all = listOf("Download", "Add to favourites", "Move", "Move to Trash", "More folder actions")
        all.forEach { description ->
            val node = compose.onNodeWithContentDescription(description)
            if (description in descriptions) node.assertIsDisplayed() else node.assertDoesNotExist()
        }
    }

    @Test fun `files alone can be downloaded`() {
        bar(Picked(documents = listOf(PickedDocument("a", null, "a.pdf"))))

        shows("Download", "Add to favourites", "Move", "Move to Trash")
    }

    @Test fun `a folder among files takes the download and the folder menu away`() {
        bar(Picked(documents = listOf(PickedDocument("a", null, "a.pdf")), folders = listOf(trips)))

        shows("Add to favourites", "Move", "Move to Trash")
    }

    @Test fun `with a locked favourite selected only the star is offered`() {
        bar(Picked(locked = listOf(FavouriteKey(FavouriteType.FOLDER, "vault"))))

        shows("Add to favourites")
    }
}
