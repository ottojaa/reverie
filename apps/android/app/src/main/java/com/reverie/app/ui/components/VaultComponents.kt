package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.Locale

/** Passcode sheet to reveal private items. Shakes/red on wrong password. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultUnlockSheet(
    onUnlock: (String, onResult: (Boolean) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Reveal private items", style = MaterialTheme.typography.titleMedium)
            Text(
                "Enter your account password. Private items auto-lock after 15 minutes.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; error = false },
                label = { Text("Password") },
                singleLine = true,
                isError = error,
                enabled = !loading,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit(password, onUnlock, onSetLoading = { loading = it }, onError = { error = it }, onDismiss) }),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error) {
                Text("Incorrect password.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            Button(
                onClick = { submit(password, onUnlock, onSetLoading = { loading = it }, onError = { error = it }, onDismiss) },
                enabled = !loading && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Reveal") }
        }
    }
}

private fun submit(
    password: String,
    onUnlock: (String, (Boolean) -> Unit) -> Unit,
    onSetLoading: (Boolean) -> Unit,
    onError: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    onSetLoading(true)
    onUnlock(password) { success ->
        onSetLoading(false)
        if (success) onDismiss() else onError(true)
    }
}

/** Bottom-of-collections control: reveal / lock-now with a live countdown, or enable hiding. */
@Composable
fun VaultControlRow(
    vault: VaultStatus?,
    onReveal: () -> Unit,
    onLock: () -> Unit,
    onEnableHide: () -> Unit,
    onExpired: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (vault == null || !vault.has_password) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when {
            vault.hide_enabled && vault.unlocked -> {
                Icon(Icons.Outlined.LockOpen, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                Column(Modifier.weight(1f).padding(start = 8.dp)) {
                    Text("Private items visible", style = MaterialTheme.typography.bodyMedium)
                    Countdown(expiresAt = vault.expires_at, onExpired = onExpired)
                }
                TextButton(onClick = onLock) { Text("Lock now") }
            }
            vault.hide_enabled -> {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                Text("Private items hidden", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(start = 8.dp))
                TextButton(onClick = onReveal) { Text("Reveal") }
            }
            else -> {
                Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                Text("Private items", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(start = 8.dp))
                TextButton(onClick = onEnableHide) { Text("Hide") }
            }
        }
    }
}

@Composable
private fun Countdown(expiresAt: String?, onExpired: () -> Unit) {
    val expiryMs = remember(expiresAt) {
        expiresAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
    var remaining by remember(expiryMs) { mutableLongStateOf(remainingMs(expiryMs)) }

    LaunchedEffect(expiryMs) {
        while (true) {
            remaining = remainingMs(expiryMs)
            if (remaining <= 0) { onExpired(); break }
            delay(1000)
        }
    }

    val minutes = (remaining / 1000) / 60
    val seconds = (remaining / 1000) % 60
    Text(
        text = String.format(Locale.US, "Locks in %d:%02d", minutes, seconds),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private fun remainingMs(expiryMs: Long?): Long =
    if (expiryMs == null) 0 else (expiryMs - System.currentTimeMillis()).coerceAtLeast(0)

/** Compact "Private visible" chip for top bars while the vault is unlocked. */
@Composable
fun PrivateVisibleChip(onLock: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .padding(end = 4.dp)
            .background(ReverieTheme.extendedColors.infoContainer, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.LockOpen,
            contentDescription = "Private items visible",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(14.dp),
        )
        Text(
            "  Private visible",
            style = MaterialTheme.typography.labelMedium,
            color = ReverieTheme.extendedColors.onInfoContainer,
            modifier = Modifier.padding(end = 4.dp),
        )
        TextButton(onClick = onLock, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp)) {
            Text("Lock", style = MaterialTheme.typography.labelMedium)
        }
    }
}
