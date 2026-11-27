package com.reverie.app.ui.components

import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.repository.UnlockOutcome
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.repository.afterRefusal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Whether a prompt knows yet what its lock takes. */
sealed interface LockCheck {
    data object Checking : LockCheck

    data object Failed : LockCheck

    data class Known(val status: VaultStatus) : LockCheck
}

/** A pending request to open one folder's lock. [folderName] is only used to title the sheet. */
data class FolderUnlockPrompt(
    val folderId: String,
    val folderName: String? = null,
    /** Tells this prompt from an earlier one, so a late answer cannot change or revive it. */
    val id: Int = 0,
    val lock: LockCheck = LockCheck.Checking,
    val isBusy: Boolean = false,
    val error: String? = null,
    /** Counts the entries asked for: what is typed starts empty each time this moves on. */
    val entry: Int = 0,
)

/**
 * Drives the unlock prompt for a screen's ViewModel: [request] opens it (from a tap on a locked row,
 * or a 403 FOLDER_LOCKED answer) and reads what the lock takes now, [submit] tries what was typed,
 * and a successful unlock runs [onUnlocked] so the screen can retry whatever was refused.
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

    private var opened = 0

    /** A prompt already open for [folderId] is kept, so asking again does not wipe what is being typed. */
    fun request(folderId: String, folderName: String? = null) {
        if (_prompt.value?.folderId == folderId) return
        val next = FolderUnlockPrompt(folderId, folderName, id = ++opened)
        _prompt.value = next
        check(next.id)
    }

    fun dismiss() {
        _prompt.value = null
    }

    /** Reads what the lock takes again, after a read that failed. */
    fun retry() {
        val current = _prompt.value ?: return
        if (current.lock != LockCheck.Failed) return
        _prompt.value = current.copy(lock = LockCheck.Checking)
        check(current.id)
    }

    fun submit(typed: String) {
        val current = _prompt.value ?: return
        if (current.isBusy || current.lock !is LockCheck.Known) return
        _prompt.value = current.copy(isBusy = true, error = null)
        scope.launch {
            when (val outcome = vault.unlock(current.folderId, typed)) {
                UnlockOutcome.Unlocked, UnlockOutcome.NotPrivate -> open(current)
                else -> change(current.id) { it.afterRefusedTry(outcome) }
            }
        }
    }

    private suspend fun open(prompt: FolderUnlockPrompt) {
        change(prompt.id) { null }
        onUnlocked(prompt.folderId)
    }

    private fun check(promptId: Int) {
        scope.launch {
            val lock = vault.fetchStatus()?.let { LockCheck.Known(it) } ?: LockCheck.Failed
            change(promptId) { it.copy(lock = lock) }
        }
    }

    private fun change(promptId: Int, to: (FolderUnlockPrompt) -> FolderUnlockPrompt?) {
        _prompt.update { if (it?.id == promptId) to(it) else it }
    }
}

/** The prompt after a try the server did not accept, asking for what the answer says the lock takes now. */
private fun FolderUnlockPrompt.afterRefusedTry(outcome: UnlockOutcome): FolderUnlockPrompt {
    val status = (lock as? LockCheck.Known)?.status ?: return this
    // A try that never got an answer keeps a typed password for another go. A PIN is typed again, as it
    // sends itself on its last digit.
    val retypes = outcome !is UnlockOutcome.Failed || status.ask == LockAsk.PIN

    return copy(
        lock = LockCheck.Known(status.afterRefusal(outcome)),
        isBusy = false,
        error = outcome.toPromptError(asked = status.ask),
        entry = if (retypes) entry + 1 else entry,
    )
}

private const val WRONG_ACCOUNT_PASSWORD = "Incorrect password. Try again."

/**
 * The line to show under the field after a try at what was [asked], or null when there is nothing to
 * add: the folder is open, or the form now asks for something else and its own words say why.
 */
fun UnlockOutcome.toPromptError(asked: LockAsk?): String? = when (this) {
    UnlockOutcome.Unlocked, UnlockOutcome.NotPrivate -> null
    is UnlockOutcome.WrongSecret -> "Incorrect ${kind.toWord()}. ${toTriesLeft(triesLeft)} left."
    UnlockOutcome.Stopped, UnlockOutcome.WrongPassword ->
        WRONG_ACCOUNT_PASSWORD.takeIf { asked == LockAsk.ACCOUNT_PASSWORD }
    UnlockOutcome.NoPassword -> "Your account has no password yet."
    is UnlockOutcome.Failed -> message
}

private fun LockSecretKind.toWord(): String = when (this) {
    LockSecretKind.PIN -> "PIN"
    LockSecretKind.PASSWORD -> "password"
}

private fun toTriesLeft(count: Int): String = if (count == 1) "1 try" else "$count tries"
