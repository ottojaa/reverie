package com.reverie.app.ui.screens.account

import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the avatar's sheet shows and where each of its rows leads. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class AccountMenuTest {
    @get:Rule
    val compose = createComposeRule()

    private val calls = mutableListOf<String>()

    @Composable
    private fun Menu() = AccountMenu(
        state = signedIn,
        links = AccountLinks(
            onOpenBackup = { calls += "backup" },
            onOpenPrivateFolders = { calls += "private" },
            onOpenSettings = { calls += "settings" },
        ),
        onSignOut = { calls += "sign out" },
    )

    private fun open() {
        compose.onNodeWithContentDescription("Account, backup and settings").performClick()
    }

    /** Robolectric drops some touches on a bottom sheet's own window. */
    private fun choose(text: String) = compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)

    @Test fun `the sheet says who is signed in, how backup stands and how full the account is`() {
        compose.setContent { ReverieTheme { Menu() } }
        compose.onNodeWithText("Settings").assertDoesNotExist()

        open()

        listOf(
            "Maria Oliveira-Santos", "maria.oliveira-santos@example.com", "Backup complete", "Camera · Wi-Fi only",
            "Storage", "22.3 GB of 1 TB",
        ).forEach { compose.onNodeWithText(it).assertIsDisplayed() }
    }

    @Test fun `each row leads on and closes the sheet`() {
        compose.setContent { ReverieTheme { Menu() } }

        listOf("Backup complete", "Private folders", "Settings").forEach { row ->
            open()
            choose(row)
            compose.onNodeWithText("Private folders").assertDoesNotExist()
        }

        assertEquals(listOf("backup", "private", "settings"), calls)
    }

    @Test fun `signing out is confirmed first`() {
        compose.setContent { ReverieTheme { Menu() } }

        open()
        choose("Sign out")
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(emptyList<String>(), calls)

        open()
        choose("Sign out")
        compose.onNodeWithText("Sign out?").assertIsDisplayed()
        compose.onNodeWithText("Sign out").performClick()

        assertEquals(listOf("sign out"), calls)
        compose.onNodeWithText("Sign out?").assertDoesNotExist()
    }
}
