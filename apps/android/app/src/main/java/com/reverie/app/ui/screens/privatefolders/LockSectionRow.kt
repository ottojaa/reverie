package com.reverie.app.ui.screens.privatefolders

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.ui.components.LockCheck
import com.reverie.app.ui.screens.manage.NO_PASSWORD_NOTICE

/** What the lock row can say: the status heard, whether or not the last read failed. */
internal fun toLockCheck(status: VaultStatus?, hasFailed: Boolean): LockCheck = when {
    status != null -> LockCheck.Known(status)
    hasFailed -> LockCheck.Failed
    else -> LockCheck.Checking
}

/** What private folders open with now, and the way to change it. */
@Composable
fun LockSectionRow(lock: LockCheck, onOpen: () -> Unit, onRetry: () -> Unit) {
    when (lock) {
        LockCheck.Checking -> LockRow("Private folders open with", "Checking…")
        LockCheck.Failed -> LockRow("Could not check how private folders open.") {
            TextButton(onClick = onRetry) { Text("Try again") }
        }
        is LockCheck.Known -> KnownLockRow(lock.status, onOpen)
    }
}

@Composable
private fun KnownLockRow(status: VaultStatus, onOpen: () -> Unit) {
    if (!status.has_password) {
        LockRow(NO_PASSWORD_NOTICE)
        return
    }
    LockRow("Private folders open with", status.toInUse(), Modifier.clickable(onClickLabel = "Change", onClick = onOpen)) {
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
    }
}

/** The secret in use by name, and below it that too many wrong tries have stopped it, if so. */
private fun VaultStatus.toInUse(): String {
    val name = when (secret_kind) {
        LockSecretKind.PIN -> "PIN"
        LockSecretKind.PASSWORD -> "Lock password"
        null -> "Account password"
    }
    if (secret_kind == null || ask != LockAsk.ACCOUNT_PASSWORD) return name
    val secret = if (secret_kind == LockSecretKind.PIN) "PIN" else "lock password"

    return "$name\nToo many wrong tries at your $secret. Until you enter your account password at a folder, " +
        "or save here, only that opens them."
}

@Composable
private fun LockRow(
    headline: String,
    supporting: String? = null,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    ListItem(
        headlineContent = { Text(headline) },
        supportingContent = supporting?.let { { Text(it) } },
        leadingContent = { Icon(Icons.Outlined.Lock, contentDescription = null) },
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = modifier,
    )
}
