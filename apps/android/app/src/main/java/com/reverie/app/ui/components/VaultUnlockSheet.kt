package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.VaultStatus

/** Leads to where the PIN or lock password is set; null where the app cannot go there. */
val LocalOpenLockSettings = staticCompositionLocalOf<(() -> Unit)?> { null }

data class UnlockActions(
    val onSubmit: (String) -> Unit,
    val onRetry: () -> Unit,
    val onDismiss: () -> Unit,
    /** "Forgot it?", offered while a PIN or lock password is asked for; null hides it. */
    val onForgot: (() -> Unit)? = null,
)

/** The unlock sheet of [unlocker], while it has a prompt. */
@Composable
fun UnlockSheetHost(unlocker: FolderUnlocker, onDismiss: () -> Unit = unlocker::dismiss) {
    val prompt by unlocker.prompt.collectAsStateWithLifecycle()
    val openLockSettings = LocalOpenLockSettings.current
    val current = prompt ?: return
    val actions = UnlockActions(
        onSubmit = unlocker::submit,
        onRetry = unlocker::retry,
        onDismiss = onDismiss,
        onForgot = openLockSettings?.let { open ->
            {
                onDismiss()
                open()
            }
        },
    )
    VaultUnlockSheet(current, actions)
}

/**
 * Sheet that opens ONE private folder's lock with a PIN, a lock password or the account password,
 * whichever the lock takes now. It stays open until the user signs out or the app process ends; there
 * is no way to re-lock it by hand.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultUnlockSheet(prompt: FolderUnlockPrompt, actions: UnlockActions) {
    ModalBottomSheet(
        onDismissRequest = actions.onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        UnlockForm(prompt, actions, Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()))
    }
}

/** The sheet's contents. */
@Composable
fun UnlockForm(prompt: FolderUnlockPrompt, actions: UnlockActions, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            prompt.folderName?.let { "Unlock \"$it\"" } ?: "Unlock private folder",
            style = MaterialTheme.typography.titleMedium,
        )
        when (val lock = prompt.lock) {
            LockCheck.Checking -> Checking(actions)
            LockCheck.Failed -> CheckFailed(actions)
            is LockCheck.Known -> Entry(prompt, lock.status, actions)
        }
    }
}

@Composable
private fun ColumnScope.Checking(actions: UnlockActions) {
    Description("Checking how this folder opens.")
    CircularProgressIndicator(Modifier.size(24.dp).align(Alignment.CenterHorizontally), strokeWidth = 2.dp)
    SheetButtons(actions.onDismiss)
}

@Composable
private fun CheckFailed(actions: UnlockActions) {
    Description("Could not check how this folder opens.")
    SheetButtons(actions.onDismiss) { Button(onClick = actions.onRetry) { Text("Try again") } }
}

/** The field for what the lock takes, and the answer to the last try. */
@Composable
private fun Entry(prompt: FolderUnlockPrompt, status: VaultStatus, actions: UnlockActions) {
    val ask = status.ask
    if (ask == null) {
        NoAccountPassword(actions)
        return
    }
    Description(toDescription(ask, isStopped = status.secret_kind != null))
    if (ask == LockAsk.PIN) PinForm(prompt, actions) else PasswordForm(prompt, ask, actions)
}

// What is typed is held here only, never saved: it must not outlive the sheet or reach saved instance state.

@Composable
private fun PinForm(prompt: FolderUnlockPrompt, actions: UnlockActions) {
    var typed by remember(prompt.id, prompt.entry) { mutableStateOf("") }
    PinEntry(
        pin = typed,
        onPinChange = { next ->
            if (prompt.isBusy) return@PinEntry
            val completes = typed.length < PIN_LENGTH && next.length == PIN_LENGTH
            typed = next
            if (completes) actions.onSubmit(next)
        },
        isError = prompt.error != null,
    )
    Verdict(prompt.error)
    SheetButtons(actions.onDismiss, actions.onForgot)
}

/** For the lock password or the account password. */
@Composable
private fun PasswordForm(prompt: FolderUnlockPrompt, ask: LockAsk, actions: UnlockActions) {
    var typed by remember(prompt.id, ask, prompt.entry) { mutableStateOf("") }
    val submit = { if (typed.isNotEmpty()) actions.onSubmit(typed) }
    SecretField(
        label = if (ask == LockAsk.PASSWORD) "Lock password" else "Account password",
        value = typed,
        onValueChange = { typed = it },
        enabled = !prompt.isBusy,
        isError = prompt.error != null,
        onDone = submit,
    )
    Verdict(prompt.error)
    SheetButtons(actions.onDismiss, actions.onForgot.takeIf { ask == LockAsk.PASSWORD }) {
        Button(onClick = submit, enabled = !prompt.isBusy && typed.isNotEmpty()) { Text("Unlock") }
    }
}

/** [isStopped]: a PIN or lock password is set, but too many wrong tries have stopped it. */
private fun toDescription(ask: LockAsk, isStopped: Boolean): String = when {
    ask == LockAsk.PIN -> "Enter your PIN."
    ask == LockAsk.PASSWORD -> "Enter your lock password."
    isStopped -> "Too many wrong tries. Enter your account password."
    else -> "Enter your account password to open this private folder. It stays open until you sign out or the app closes."
}

@Composable
private fun NoAccountPassword(actions: UnlockActions) {
    Description("Your account has no password, so nothing is locked yet.")
    Description("Set a password under Settings, Change password, to lock private folders.")
    SheetButtons(actions.onDismiss)
}

@Composable
private fun Description(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Verdict(error: String?) {
    if (error == null) return
    Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
}

/** "Forgot it?" at the start; Cancel and the [primary] button at the end, below it when there is no room beside. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SheetButtons(onCancel: () -> Unit, onForgot: (() -> Unit)? = null, primary: @Composable () -> Unit = {}) {
    FlowRow(Modifier.fillMaxWidth()) {
        if (onForgot != null) TextButton(onClick = onForgot) { Text("Forgot it?") }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            primary()
        }
    }
}
