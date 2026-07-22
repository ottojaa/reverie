package com.reverie.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Passcode sheet to unlock private items with the account password. The unlock lasts the whole
 * app session — no timeout — and re-locks on explicit lock, logout, or process death.
 */
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
            Text("Unlock private items", style = MaterialTheme.typography.titleMedium)
            Text(
                "Enter your account password to open private items. They stay unlocked until you lock them or the app closes.",
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
            ) { Text("Unlock") }
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
