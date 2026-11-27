package com.reverie.app.ui.screens.privatefolders

import android.os.Looper
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.viewModelScope
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.ui.CapturedKeyboard
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The lock settings on the Private folders screen: what its row says, and setting, changing and removing a secret. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class LockSettingsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld()
    private val keyboard = CapturedKeyboard()
    private var heard = 0
    private lateinit var viewModel: PrivateFoldersViewModel

    @After fun tearDown() = viewModel.viewModelScope.cancel()

    private fun open(openLockSettings: Boolean = false) {
        viewModel = PrivateFoldersViewModel(world.deps)
        compose.setContent {
            keyboard.Capturing {
                ReverieTheme {
                    PrivateFoldersScreen(
                        onBack = {},
                        onOpenFolder = {},
                        openLockSettings = openLockSettings,
                        onLockSettingsOpened = { heard++ },
                        viewModel = viewModel,
                    )
                }
            }
        }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun awaitNoSheet() = await { compose.onAllNodes(hasText("Save")).fetchSemanticsNodes().isEmpty() }

    private fun SemanticsNodeInteraction.click() = performSemanticsAction(SemanticsActions.OnClick)

    private fun row() = compose.onNodeWithText("Private folders open with")

    private fun openSheet(inUse: String) {
        awaitText(inUse)
        row().click()
        awaitText("Save")
    }

    private fun choice(label: String) = compose.onNode(isSelectable() and hasText(label))

    private fun field(label: String) = compose.onNode(hasSetTextAction() and hasText(label))

    private fun type(label: String, text: String) = field(label).performTextInput(text)

    private fun save() = compose.onNodeWithText("Save")

    private fun saves() = world.requests.filter { it.startsWith("PUT vault/secret") }

    private fun refuseSave() {
        world.vaultRefusals += HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"invalid_credentials","message":"No","details":{"ask":"account_password","tries_left":null}}"""
    }

    @Test fun `a PIN is set with the account password, and the row then says so`() {
        open()
        openSheet("Account password")
        choice("Account password").assertIsSelected()

        choice("PIN").click()
        compose.onNodeWithText("Don't reuse a PIN that guards something else.").assertExists()
        type("New PIN", "4821")
        type("Repeat PIN", "4821")
        save().assertIsNotEnabled()
        type("Account password", "hunter2")
        save().click()

        awaitNoSheet()
        awaitText("Private folders now open with your PIN")
        compose.onNodeWithText("PIN").assertExists()
        assertEquals(
            listOf("""PUT vault/secret {"account_password":"hunter2","secret":{"kind":"pin","value":"4821"}}"""),
            saves(),
        )
    }

    @Test fun `a PIN is changed to a lock password`() {
        world.secretKind = LockSecretKind.PIN
        open()
        openSheet("PIN")
        choice("PIN").assertIsSelected()

        choice("Password").click()
        compose.onNodeWithText("Don't reuse a password that guards something else.").assertExists()
        type("New lock password", "open sesame")
        type("Repeat lock password", "open sesame")
        type("Account password", "hunter2")
        save().click()

        awaitNoSheet()
        awaitText("Private folders now open with your lock password")
        compose.onNodeWithText("Lock password").assertExists()
        assertEquals(
            listOf("""PUT vault/secret {"account_password":"hunter2","secret":{"kind":"password","value":"open sesame"}}"""),
            saves(),
        )
    }

    @Test fun `going back to the account password removes the PIN`() {
        world.secretKind = LockSecretKind.PIN
        open()
        openSheet("PIN")

        choice("Account password").click()
        compose.onNodeWithText("Saving removes your PIN.").assertExists()
        field("New PIN").assertDoesNotExist()
        save().assertIsNotEnabled()
        type("Account password", "hunter2")
        save().click()

        awaitNoSheet()
        awaitText("Private folders now open with your account password")
        compose.onNodeWithText("Account password").assertExists()
        assertEquals(listOf("""PUT vault/secret {"account_password":"hunter2","secret":null}"""), saves())
    }

    @Test fun `with the account password in use and chosen there is nothing to save`() {
        open()
        openSheet("Account password")

        type("Account password", "hunter2")

        save().assertIsNotEnabled()
    }

    @Test fun `a wrong account password is explained and nothing changes`() {
        world.secretKind = LockSecretKind.PIN
        refuseSave()
        open()
        openSheet("PIN")
        choice("Account password").click()
        type("Account password", "wrong")

        save().click()
        awaitText("Incorrect account password.")

        save().assertIsEnabled()
        assertEquals(1, saves().size)
        assertEquals(LockSecretKind.PIN, viewModel.lockStatus.value?.secret_kind)
        type("Account password", "!")
        compose.onNodeWithText("Incorrect account password.").assertDoesNotExist()
    }

    @Test fun `a PIN or lock password that would not do is explained before anything is sent`() {
        open()
        openSheet("Account password")
        type("Account password", "hunter2")

        choice("PIN").click()
        type("New PIN", "482")
        save().click()
        compose.onNodeWithText("A PIN is exactly four digits.").assertExists()
        type("New PIN", "1")
        compose.onNodeWithText("A PIN is exactly four digits.").assertDoesNotExist()
        type("Repeat PIN", "4822")
        save().click()
        compose.onNodeWithText("The PINs do not match.").assertExists()

        choice("Password").click()
        type("New lock password", "abc")
        save().click()
        compose.onNodeWithText("A lock password is 4 to 128 characters.").assertExists()
        type("New lock password", "d")
        type("Repeat lock password", "abce")
        save().click()
        compose.onNodeWithText("The passwords do not match.").assertExists()

        assertEquals(emptyList<String>(), saves())
    }

    @Test fun `a save on its way cannot be sent again`() {
        world.secretKind = LockSecretKind.PIN
        open()
        openSheet("PIN")
        choice("Account password").click()
        type("Account password", "hunter2")
        val gate = CompletableDeferred<Unit>()
        world.vaultGate = gate

        save().click()
        await { viewModel.lock.state.value.isSaving }
        save().assertIsNotEnabled()
        viewModel.lock.save("hunter2", null)
        gate.complete(Unit)

        awaitNoSheet()
        assertEquals(1, saves().size)
    }

    @Test fun `each field gets the keyboard that suits what it takes`() {
        open()
        openSheet("Account password")
        fun assertKeyboard(label: String, check: CapturedKeyboard.() -> Unit) {
            keyboard.inputType = null
            type(label, "1")
            await { keyboard.inputType != null }
            keyboard.check()
        }

        choice("PIN").click()
        assertKeyboard("New PIN") { assertForPin() }
        assertKeyboard("Repeat PIN") { assertForPin() }
        assertKeyboard("Account password") { assertForPassword() }
        choice("Password").click()
        assertKeyboard("New lock password") { assertForPassword() }
        assertKeyboard("Repeat lock password") { assertForPassword() }
    }

    @Test fun `closing the sheet forgets what was typed`() {
        open()
        openSheet("Account password")
        choice("PIN").click()
        type("Account password", "hunter2")

        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss))
            .performSemanticsAction(SemanticsActions.Dismiss)
        awaitNoSheet()
        openSheet("Account password")

        choice("Account password").assertIsSelected()
        compose.onNodeWithText("hunter2").assertDoesNotExist()
        save().assertIsNotEnabled()
    }

    @Test fun `an account without a password keeps the notice, which leads nowhere`() {
        world.hasPassword = false
        open()

        awaitText("Private folders only lock once your account has a password.")

        compose.onNodeWithText("Private folders only lock once your account has a password.").assertHasNoClickAction()
        compose.onNodeWithText("Private folders open with").assertDoesNotExist()
    }

    @Test fun `a lock that cannot be read says so and can be read again`() {
        world.isStatusDown = true
        open()
        awaitText("Could not check how private folders open.")

        world.isStatusDown = false
        compose.onNodeWithText("Try again").click()

        awaitText("Account password")
        row().assertHasClickAction()
    }

    @Test fun `a PIN stopped by wrong tries is said on the row`() {
        world.secretKind = LockSecretKind.PIN
        world.isStopped = true
        open()

        awaitText(
            "PIN\nToo many wrong tries at your PIN. Until you enter your account password at a folder, " +
                "or save here, only that opens them.",
        )
    }

    @Test fun `asked to open the lock settings, it does so once the lock is known`() {
        val gate = CompletableDeferred<Unit>()
        world.vaultGate = gate
        world.secretKind = LockSecretKind.PIN
        open(openLockSettings = true)
        awaitText("Checking…")
        save().assertDoesNotExist()

        gate.complete(Unit)

        awaitText("Save")
        await { heard == 1 }
        choice("PIN").assertIsSelected()
    }

    @Test fun `asked to open them on an account without a password, nothing opens`() {
        world.hasPassword = false
        open(openLockSettings = true)

        await { heard == 1 }

        save().assertDoesNotExist()
    }
}
