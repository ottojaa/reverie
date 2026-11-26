package com.reverie.app.ui.screens.manage

import android.os.Looper
import androidx.compose.material3.SnackbarHostState
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.pressKey
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** A folder's menu and the dialogs it leads to. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class ManageHostTest {
    @get:Rule
    val compose = createComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val world = FavouriteWorld()
    private val manage = ManageController(world.folders, world.documents, world.vault, world.controller(), scope)
    private val trips = node("Trips").copy(kind_counts = KindCountsDto(image = 12))

    @After fun tearDown() = scope.cancel()

    private fun show() = compose.setContent {
        ReverieTheme { ManageHost(manage, SnackbarHostState()) }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    /** A click by its action: Robolectric drops some touches on a bottom sheet's window. */
    private fun press(text: String) {
        compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)
    }

    @Test fun `delete says what goes with the folder and then deletes it`() {
        show()
        compose.runOnIdle { manage.openMenu(trips) }

        listOf("Add to favourites", "Rename", "Move", "Make private").forEach {
            compose.onNodeWithText(it).assertIsDisplayed()
        }
        press("Delete")
        compose.onNodeWithText("12 files go to the trash with it.").assertIsDisplayed()
        press("Delete")

        await { "DELETE folders/Trips" in world.requests }
        compose.onNodeWithText("12 files go to the trash with it.").assertDoesNotExist()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `Enter runs the focused menu item`() {
        show()
        compose.runOnIdle { manage.openMenu(trips) }

        compose.onNodeWithText("Rename").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Rename").performKeyInput { pressKey(Key.Enter) }

        compose.onNodeWithText("Edit folder").assertIsDisplayed()
    }

    @Config(qualifiers = "w320dp-h480dp")
    @Test fun `on a short screen the menu opens far enough to show its last row`() {
        show()
        compose.runOnIdle { manage.openMenu(trips) }

        compose.onNodeWithText("Delete").assertIsDisplayed()
    }

    @Test fun `a folder private through one above it is not offered to change that`() {
        show()
        compose.runOnIdle { manage.openMenu(node("Taxes", parent = "Safe", lockId = "Safe")) }

        compose.onNodeWithText("Make private").assertDoesNotExist()
        compose.onNodeWithText("Remove from private").assertDoesNotExist()
        compose.onNodeWithText("Delete").assertIsDisplayed()
    }
}
