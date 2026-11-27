package com.reverie.app.ui.screens.privatefolders

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.ui.components.FolderUnlockPrompt
import com.reverie.app.ui.components.LockCheck
import com.reverie.app.ui.components.PinEntry
import com.reverie.app.ui.components.UnlockActions
import com.reverie.app.ui.components.UnlockForm
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

/** The unlock sheet and the lock settings, dark and light: each thing asked for, what can go wrong, and the row. */
class FolderLockScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private val longName = "Taxes, insurance papers and the apartment purchase 2019–2026"

    private fun status(kind: LockSecretKind?, ask: LockAsk?) = VaultStatus(false, ask != null, kind, ask)

    private val pin = status(LockSecretKind.PIN, LockAsk.PIN)
    private val password = status(LockSecretKind.PASSWORD, LockAsk.PASSWORD)
    private val account = status(null, LockAsk.ACCOUNT_PASSWORD)
    private val stopped = status(LockSecretKind.PIN, LockAsk.ACCOUNT_PASSWORD)
    private val noPassword = status(null, null)

    /** [content] as it stands in a bottom sheet. */
    @Composable
    private fun InSheet(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Box(Modifier.padding(top = 24.dp)) { content() }
            }
        }
    }

    private fun unlock(state: String, lock: LockCheck, error: String? = null, name: String = "Taxes") =
        paparazzi.snapshotThemes(state) {
            InSheet {
                UnlockForm(
                    FolderUnlockPrompt("f", name, id = 1, lock = lock, error = error),
                    UnlockActions(onSubmit = {}, onRetry = {}, onDismiss = {}, onForgot = {}),
                )
            }
        }

    private fun settings(state: String, current: LockSecretKind?, error: String? = null) = paparazzi.snapshotThemes(state) {
        InSheet { LockForm(LockFormState(current, error = error), LockFormActions({ _, _ -> }, {})) }
    }

    private fun row(state: String, lock: LockCheck) = paparazzi.snapshotThemes(state) {
        val folders = listOf(node("Diary", isPrivate = true), node(longName, isPrivate = true, locked = true))
        PrivateFoldersContent(PrivateFoldersState(folders, lock = lock), PrivateFoldersActions({}, {}, {}))
    }

    @Test fun unlockPin() = unlock("pin", LockCheck.Known(pin))

    @Test fun unlockPassword() = unlock("password", LockCheck.Known(password))

    @Test fun unlockAccount() = unlock("account", LockCheck.Known(account))

    @Test fun wrongPin() = unlock("wrong_pin", LockCheck.Known(pin), "Incorrect PIN. 7 tries left.")

    @Test fun wrongPassword() =
        unlock("wrong_password", LockCheck.Known(password), "Incorrect password. 1 try left.", longName)

    @Test fun stoppedLock() = unlock("stopped", LockCheck.Known(stopped))

    @Test fun wrongAccount() = unlock("wrong_account", LockCheck.Known(stopped), "Incorrect password. Try again.")

    @Test fun noAccountPassword() = unlock("no_password", LockCheck.Known(noPassword))

    @Test fun checking() = unlock("checking", LockCheck.Checking)

    @Test fun unread() = unlock("unread", LockCheck.Failed)

    /** The dots as digits go in. */
    @Test fun pinDots() = paparazzi.snapshotThemes("pin_dots") { InSheet { PinEntry("48", {}, isError = false) } }

    @Test fun settingsPin() = settings("settings_pin", LockSecretKind.PIN)

    @Test fun settingsPassword() = settings("settings_password", LockSecretKind.PASSWORD)

    @Test fun settingsAccount() = settings("settings_account", null)

    @Test fun settingsRefused() = settings("settings_refused", LockSecretKind.PIN, "Incorrect account password.")

    @Test fun rowPin() = row("row_pin", LockCheck.Known(pin))

    @Test fun rowStopped() = row("row_stopped", LockCheck.Known(stopped))

    @Test fun rowAccount() = row("row_account", LockCheck.Known(account))

    @Test fun rowNoPassword() = row("row_no_password", LockCheck.Known(noPassword))

    @Test fun rowUnread() = row("row_unread", LockCheck.Failed)
}
