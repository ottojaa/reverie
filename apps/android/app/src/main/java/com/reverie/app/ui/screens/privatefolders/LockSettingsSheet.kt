package com.reverie.app.ui.screens.privatefolders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.ui.components.SecretField

private val CHOICES = listOf(
    LockSecretKind.PIN to "PIN",
    LockSecretKind.PASSWORD to "Password",
    null to "Account password",
)

data class LockFormState(
    /** The secret set now; null while private folders open with the account password. */
    val current: LockSecretKind?,
    val isSaving: Boolean = false,
    /** Why the last save did not happen. */
    val error: String? = null,
)

data class LockFormActions(
    val onSave: (accountPassword: String, secret: LockSecret?) -> Unit,
    /** Something was typed or chosen: the last save's answer no longer applies. */
    val onEdit: () -> Unit,
)

/** The lock settings sheet while it is open, and the word once a save has gone through. */
@Composable
fun LockSettingsHost(settings: LockSettings, status: VaultStatus?, state: LockSettingsState, snackbarHostState: SnackbarHostState) {
    LaunchedEffect(settings, snackbarHostState) {
        settings.messages.collect { snackbarHostState.showSnackbar(it) }
    }
    if (!state.isSheetOpen || status == null) return
    val actions = LockFormActions(onSave = settings::save, onEdit = settings::clearError)
    LockSettingsSheet(LockFormState(status.secret_kind, state.isSaving, state.error), actions, settings::close)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LockSettingsSheet(state: LockFormState, actions: LockFormActions, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        LockForm(state, actions, Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()))
    }
}

/** The sheet's contents: choose a PIN, a password or the account password, and prove it with the last. */
@Composable
fun LockForm(state: LockFormState, actions: LockFormActions, modifier: Modifier = Modifier) {
    // Held here only, never saved: what is typed must not outlive the sheet or reach saved instance state.
    // Starts over if the secret set turns out to be another than the sheet opened with.
    var draft by remember(state.current) { mutableStateOf(LockDraft(state.current)) }
    var problem by remember(state.current) { mutableStateOf<String?>(null) }
    fun edit(next: LockDraft) {
        draft = next
        problem = null
        actions.onEdit()
    }
    fun save() {
        if (state.isSaving || !draft.canSave(state.current)) return
        problem = draft.toProblem()
        if (problem == null) actions.onSave(draft.accountPassword, draft.toSecret())
    }

    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Private folders open with", style = MaterialTheme.typography.titleMedium)
        Choices(draft.choice, enabled = !state.isSaving) { edit(draft.copy(choice = it, secret = "", repeat = "")) }
        draft.choice?.let { NewSecretFields(it, draft, enabled = !state.isSaving, onChange = ::edit) }
        SecretField(
            label = "Account password",
            value = draft.accountPassword,
            onValueChange = { edit(draft.copy(accountPassword = it)) },
            enabled = !state.isSaving,
            isError = state.error != null,
            onDone = ::save,
        )
        (problem ?: state.error)?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Footer(toHint(draft.choice, state.current), isEnabled = !state.isSaving && draft.canSave(state.current), onSave = ::save)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Choices(chosen: LockSecretKind?, enabled: Boolean, onChoose: (LockSecretKind?) -> Unit) {
    FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        CHOICES.forEach { (kind, label) ->
            Row(
                Modifier.selectable(kind == chosen, enabled = enabled, role = Role.RadioButton) { onChoose(kind) }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RadioButton(selected = kind == chosen, onClick = null, enabled = enabled)
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** The new PIN or lock password, typed twice. */
@Composable
private fun NewSecretFields(kind: LockSecretKind, draft: LockDraft, enabled: Boolean, onChange: (LockDraft) -> Unit) {
    val isPin = kind == LockSecretKind.PIN
    val name = if (isPin) "PIN" else "lock password"
    SecretField(
        label = "New $name",
        value = draft.secret,
        onValueChange = { onChange(draft.copy(secret = it)) },
        digits = isPin,
        enabled = enabled,
        imeAction = ImeAction.Next,
    )
    SecretField(
        label = "Repeat $name",
        value = draft.repeat,
        onValueChange = { onChange(draft.copy(repeat = it)) },
        digits = isPin,
        enabled = enabled,
        imeAction = ImeAction.Next,
    )
}

private fun toHint(choice: LockSecretKind?, current: LockSecretKind?): String? = when {
    choice == LockSecretKind.PIN -> "Don't reuse a PIN that guards something else."
    choice == LockSecretKind.PASSWORD -> "Don't reuse a password that guards something else."
    current == LockSecretKind.PIN -> "Saving removes your PIN."
    current == LockSecretKind.PASSWORD -> "Saving removes your lock password."
    else -> null
}

@Composable
private fun Footer(hint: String?, isEnabled: Boolean, onSave: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            hint.orEmpty(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Button(onClick = onSave, enabled = isEnabled) { Text("Save") }
    }
}
