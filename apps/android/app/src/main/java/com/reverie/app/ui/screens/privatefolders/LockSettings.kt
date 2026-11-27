package com.reverie.app.ui.screens.privatefolders

import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.repository.SaveSecretOutcome
import com.reverie.app.data.repository.VaultRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The lock settings beside what is known of the lock itself ([VaultRepository.status]). */
data class LockSettingsState(
    /** The last read of the status got no answer. */
    val hasFailed: Boolean = false,
    val isSheetOpen: Boolean = false,
    val isSaving: Boolean = false,
    /** Why the last save did not happen. */
    val error: String? = null,
)

/** Sets, changes and removes the PIN or lock password that opens private folders. */
class LockSettings(
    private val vault: VaultRepository,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(LockSettingsState())
    val state: StateFlow<LockSettingsState> = _state.asStateFlow()

    private val confirmations = Channel<String>(Channel.BUFFERED)

    /** What to say once a save has gone through. */
    val messages: Flow<String> = confirmations.receiveAsFlow()

    /** Reads how locks open now: it may have been changed or stopped from another device. */
    fun refresh() {
        scope.launch {
            _state.update { it.copy(hasFailed = false) }
            val status = vault.fetchStatus()
            _state.update { it.copy(hasFailed = status == null) }
        }
    }

    /** Does nothing until the account is known to have a password: without one, nothing locks. */
    fun open() {
        if (vault.status.value?.has_password != true) return
        _state.update { it.copy(isSheetOpen = true, error = null) }
        refresh()
    }

    fun close() {
        _state.update { it.copy(isSheetOpen = false, error = null) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    /** A null [secret] goes back to the account password. */
    fun save(accountPassword: String, secret: LockSecret?) {
        if (_state.value.isSaving) return
        _state.update { it.copy(isSaving = true, error = null) }
        scope.launch {
            val outcome = vault.saveSecret(accountPassword, secret)
            if (outcome !is SaveSecretOutcome.Saved) {
                _state.update { it.copy(isSaving = false, error = outcome.toError()) }
                return@launch
            }
            _state.update { it.copy(isSaving = false, isSheetOpen = false) }
            confirmations.send(toConfirmation(outcome.status.secret_kind))
        }
    }
}

private fun SaveSecretOutcome.toError(): String? = when (this) {
    is SaveSecretOutcome.Saved -> null
    SaveSecretOutcome.WrongAccountPassword -> "Incorrect account password."
    SaveSecretOutcome.NoPassword -> "Your account has no password yet."
    is SaveSecretOutcome.Failed -> message
}

private fun toConfirmation(kind: LockSecretKind?): String {
    val name = when (kind) {
        LockSecretKind.PIN -> "PIN"
        LockSecretKind.PASSWORD -> "lock password"
        null -> "account password"
    }

    return "Private folders now open with your $name"
}
