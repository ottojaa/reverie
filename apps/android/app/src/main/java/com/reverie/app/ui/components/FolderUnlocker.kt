package com.reverie.app.ui.components

import com.reverie.app.data.repository.UnlockOutcome
import com.reverie.app.data.repository.VaultRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A pending request to open one folder's lock. [folderName] is only used to title the sheet. */
data class FolderUnlockPrompt(
    val folderId: String,
    val folderName: String? = null,
    val isBusy: Boolean = false,
    val error: String? = null,
)

/**
 * Drives the per-folder password prompt for a screen's ViewModel: [request] opens it (from a tap
 * on a locked row, or a 403 FOLDER_LOCKED answer), [submit] tries the account password, and a
 * successful unlock runs [onUnlocked] so the screen can retry whatever was refused.
 *
 * Unlocking one folder never opens another: the server tracks each lock separately.
 */
class FolderUnlocker(
    private val vault: VaultRepository,
    private val scope: CoroutineScope,
    private val onUnlocked: suspend (folderId: String) -> Unit,
) {
    private val _prompt = MutableStateFlow<FolderUnlockPrompt?>(null)
    val prompt: StateFlow<FolderUnlockPrompt?> = _prompt.asStateFlow()

    fun request(folderId: String, folderName: String? = null) {
        _prompt.value = FolderUnlockPrompt(folderId, folderName)
    }

    fun dismiss() {
        _prompt.value = null
    }

    fun submit(password: String) {
        val current = _prompt.value ?: return
        if (current.isBusy) return
        _prompt.value = current.copy(isBusy = true, error = null)
        scope.launch {
            val outcome = vault.unlock(current.folderId, password)
            val error = outcome.toPromptError()
            if (error != null) {
                _prompt.value = current.copy(isBusy = false, error = error)
                return@launch
            }
            _prompt.value = null
            onUnlocked(current.folderId)
        }
    }
}

/**
 * The message to show under the password field, or null when the folder is open: either just
 * unlocked, or it was not private (anymore), so there is nothing left to unlock.
 */
fun UnlockOutcome.toPromptError(): String? = when (this) {
    UnlockOutcome.Unlocked, UnlockOutcome.NotPrivate -> null
    UnlockOutcome.WrongPassword -> "Incorrect password."
    UnlockOutcome.NoPassword -> "Your account has no password yet. Set one in Settings on the web app."
    is UnlockOutcome.Failed -> message
}
