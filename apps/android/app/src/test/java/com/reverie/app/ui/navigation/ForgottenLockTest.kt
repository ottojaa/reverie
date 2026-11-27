package com.reverie.app.ui.navigation

import android.os.Looper
import androidx.compose.material3.Text
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.ui.components.FolderUnlocker
import com.reverie.app.ui.components.UnlockSheetHost
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.privatefolders.PrivateFoldersViewModel
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** "Forgot it?" on an unlock prompt, in the app's shell: it lands on the lock settings, on Private folders. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class ForgottenLockTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld().apply { secretKind = LockSecretKind.PIN }
    private lateinit var nav: NavHostController
    private lateinit var unlocker: FolderUnlocker

    private fun open() = compose.setContent {
        nav = rememberNavController()
        val scope = rememberCoroutineScope()
        unlocker = remember { FolderUnlocker(world.vault, scope) {} }
        ReverieTheme {
            MainShell(nav) { modifier ->
                NavHost(nav, startDestination = Routes.LIBRARY, modifier = modifier) {
                    composable(Routes.LIBRARY) { Text("The library") }
                    privateFolders(nav) { viewModel { PrivateFoldersViewModel(world.deps) } }
                }
                UnlockSheetHost(unlocker)
            }
        }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun awaitNoText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty() }

    private fun forget() {
        compose.runOnIdle { unlocker.request("f", "Taxes") }
        awaitText("Forgot it?")
        compose.onNodeWithText("Forgot it?").performSemanticsAction(SemanticsActions.OnClick)
    }

    private fun closeSheet() {
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss))
            .performSemanticsAction(SemanticsActions.Dismiss)
        awaitNoText("Save")
    }

    private fun routes(): List<String?> = compose.runOnIdle {
        nav.currentBackStack.value.mapNotNull { it.destination.route }
    }

    @Test fun `it opens the lock settings on Private folders, and Back from there returns`() {
        open()

        forget()

        awaitText("Save")
        compose.onNodeWithText("Forgot it?").assertDoesNotExist()
        assertEquals(listOf(Routes.LIBRARY, Routes.PRIVATE_FOLDERS), routes())
        closeSheet()
        compose.runOnIdle { nav.popBackStack() }
        awaitText("The library")
        assertEquals(listOf(Routes.LIBRARY), routes())
    }

    @Test fun `already on Private folders it opens them there, each time it is asked`() {
        open()
        compose.runOnIdle { nav.navigate(Routes.PRIVATE_FOLDERS) }
        awaitText("Private folders open with")

        repeat(2) {
            forget()
            awaitText("Save")
            assertEquals(listOf(Routes.LIBRARY, Routes.PRIVATE_FOLDERS), routes())
            closeSheet()
        }
    }

    @Test fun `closing the lock settings leaves them closed on returning to the screen`() {
        open()
        forget()
        awaitText("Save")
        closeSheet()

        compose.runOnIdle { nav.popBackStack() }
        awaitText("The library")
        compose.runOnIdle { nav.navigate(Routes.PRIVATE_FOLDERS) }
        awaitText("Private folders open with")

        compose.onNodeWithText("Save").assertDoesNotExist()
    }
}
