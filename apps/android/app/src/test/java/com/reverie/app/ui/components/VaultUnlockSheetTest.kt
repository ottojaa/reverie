package com.reverie.app.ui.components

import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.ui.CapturedKeyboard
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.http.HttpStatusCode
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
import java.util.concurrent.CopyOnWriteArrayList

/** The unlock sheet over its unlocker and a fake server: what it asks for, what it sends and what an answer does. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class VaultUnlockSheetTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld().apply { secretKind = LockSecretKind.PIN }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val opened = CopyOnWriteArrayList<String>()
    private val unlocker = FolderUnlocker(world.vault, scope) { opened += it }
    private val keyboard = CapturedKeyboard()
    private var forgotten = 0

    @After fun tearDown() = scope.cancel()

    @Composable
    private fun Sheet(openLockSettings: (() -> Unit)?) {
        keyboard.Capturing {
            ReverieTheme {
                CompositionLocalProvider(LocalOpenLockSettings provides openLockSettings) { UnlockSheetHost(unlocker) }
            }
        }
    }

    private fun open(openLockSettings: (() -> Unit)? = { forgotten++ }) {
        compose.setContent { Sheet(openLockSettings) }
        compose.runOnIdle { unlocker.request("f", "Taxes") }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun assertNoText(text: String) = compose.onNodeWithText(text).assertDoesNotExist()

    private fun click(text: String) = compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)

    private fun pin() = compose.onNodeWithContentDescription("PIN")

    private fun field() = compose.onNode(hasSetTextAction())

    private fun assertEmpty() = field().assert(
        SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")),
    )

    private fun tries() = world.requests.filter { it.startsWith("POST vault/unlock") }

    private fun refuse(ask: String, triesLeft: Int?) {
        world.vaultRefusals += HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"invalid_credentials","message":"No","details":{"ask":"$ask","tries_left":$triesLeft}}"""
    }

    @Test fun `a PIN lock asks for the PIN, masked, on a number keyboard ready as the sheet opens`() {
        open()
        awaitText("Enter your PIN.")

        compose.onNodeWithText("Unlock \"Taxes\"").assertExists()
        pin().assertIsFocused().assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
        compose.onNodeWithText("Forgot it?").assertExists()
        compose.onNodeWithText("Cancel").assertExists()
        assertNoText("Unlock")
        await { keyboard.inputType != null }
        keyboard.assertForPin()
    }

    @Test fun `the fourth digit sends the PIN, and nothing before it`() {
        open()
        awaitText("Enter your PIN.")

        pin().performTextInput("48")
        pin().performTextInput("a2")
        compose.waitForIdle()
        assertEquals(emptyList<String>(), tries())
        pin().performTextInput("1")
        await { opened.isNotEmpty() }

        assertEquals(listOf("""POST vault/unlock {"password":"4821","folder_id":"f"}"""), tries())
        assertEquals(listOf("f"), opened.toList())
        await { compose.onAllNodes(hasText("Unlock \"Taxes\"")).fetchSemanticsNodes().isEmpty() }
    }

    @Test fun `a wrong PIN shows the tries left and empties the field for the next`() {
        refuse("pin", 7)
        open()
        awaitText("Enter your PIN.")

        pin().performTextInput("0000")
        awaitText("Incorrect PIN. 7 tries left.")

        assertEmpty()
        assertEquals(1, tries().size)
        pin().performTextInput("4821")
        await { opened.isNotEmpty() }
        assertEquals(2, tries().size)
    }

    @Test fun `the last wrong try turns the sheet to the account password`() {
        refuse("account_password", null)
        open()
        awaitText("Enter your PIN.")

        pin().performTextInput("0000")
        awaitText("Too many wrong tries. Enter your account password.")

        compose.onNodeWithText("Account password").assertExists()
        compose.onNodeWithContentDescription("PIN").assertDoesNotExist()
        assertNoText("Forgot it?")
        assertEmpty()
        compose.onNodeWithText("Unlock").assertIsNotEnabled()
    }

    @Test fun `a lock stopped elsewhere asks for the account password from the start`() {
        world.isStopped = true
        refuse("account_password", null)
        open()
        awaitText("Too many wrong tries. Enter your account password.")

        field().performTextInput("wrong")
        click("Unlock")
        awaitText("Incorrect password. Try again.")

        assertEmpty()
        assertEquals(1, tries().size)
    }

    @Test fun `a refusal that names the lock password switches the form`() {
        refuse("password", 9)
        open()
        awaitText("Enter your PIN.")

        pin().performTextInput("4821")
        awaitText("Enter your lock password.")

        compose.onNodeWithText("Lock password").assertExists()
        compose.onNodeWithText("Incorrect password. 9 tries left.").assertExists()
        compose.onNodeWithContentDescription("PIN").assertDoesNotExist()
        assertEmpty()
    }

    @Test fun `a sheet opened after the kind changed elsewhere asks for the new kind`() {
        open()
        awaitText("Enter your PIN.")
        click("Cancel")
        world.secretKind = LockSecretKind.PASSWORD

        compose.runOnIdle { unlocker.request("f", "Taxes") }

        awaitText("Enter your lock password.")
        compose.onNodeWithContentDescription("PIN").assertDoesNotExist()
        assertEquals(emptyList<String>(), tries())
    }

    @Test fun `a lock password goes from the Unlock button or the keyboard, typed on a password keyboard`() {
        world.secretKind = LockSecretKind.PASSWORD
        refuse("password", 1)
        open()
        awaitText("Enter your lock password.")
        compose.onNodeWithText("Unlock").assertIsNotEnabled()
        field().performImeAction()

        field().performTextInput("open sesame")
        await { keyboard.inputType != null }
        keyboard.assertForPassword()
        compose.onNodeWithText("Unlock").assertIsEnabled()
        click("Unlock")
        awaitText("Incorrect password. 1 try left.")
        field().performTextInput("open barley")
        field().performImeAction()
        await { opened.isNotEmpty() }

        assertEquals(
            listOf(
                """POST vault/unlock {"password":"open sesame","folder_id":"f"}""",
                """POST vault/unlock {"password":"open barley","folder_id":"f"}""",
            ),
            tries(),
        )
    }

    @Test fun `with no PIN or lock password it asks for the account password`() {
        world.secretKind = null
        open()
        awaitText("Account password")

        compose.onNodeWithText(
            "Enter your account password to open this private folder. It stays open until you sign out or the app closes.",
        ).assertExists()
        assertNoText("Forgot it?")
        field().performTextInput("hunter2")
        await { keyboard.inputType != null }
        keyboard.assertForPassword()
        field().performImeAction()
        await { opened.isNotEmpty() }
    }

    @Test fun `an account without a password is told there is nothing to unlock with`() {
        world.hasPassword = false
        world.secretKind = null
        open()

        awaitText("Your account has no password, so nothing is locked yet.")

        compose.onNode(hasSetTextAction()).assertDoesNotExist()
        assertNoText("Unlock")
    }

    @Test fun `a lock that cannot be read says so and can be read again`() {
        world.isStatusDown = true
        open()
        awaitText("Could not check how this folder opens.")
        compose.onNode(hasSetTextAction()).assertDoesNotExist()

        world.isStatusDown = false
        click("Try again")

        awaitText("Enter your PIN.")
        assertEquals(emptyList<String>(), tries())
    }

    @Test fun `Forgot it closes the prompt and leads to the lock settings`() {
        open()
        awaitText("Enter your PIN.")

        click("Forgot it?")

        await { forgotten == 1 }
        assertNull(unlocker.prompt.value)
        assertEquals(emptyList<String>(), tries())
    }

    @Test fun `where there is no way to the lock settings the link is not offered`() {
        open(openLockSettings = null)
        awaitText("Enter your PIN.")

        assertNoText("Forgot it?")
    }

    @Test fun `what is typed is not saved with the screen's state`() {
        world.secretKind = LockSecretKind.PASSWORD
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Sheet(openLockSettings = null) }
        compose.runOnIdle { unlocker.request("f") }
        awaitText("Enter your lock password.")
        field().performTextInput("open sesame")

        restoration.emulateSavedInstanceStateRestore()

        awaitText("Enter your lock password.")
        assertEmpty()
    }
}
