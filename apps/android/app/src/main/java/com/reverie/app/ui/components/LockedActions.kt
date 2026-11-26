package com.reverie.app.ui.components

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.repository.VaultRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Runs actions that a closed folder lock may refuse: the refusal asks for that folder's password, and the
 * action is made again once the lock is open. Any other failure is reported to [onFailure], in the server's
 * words or else as [fallbackMessage].
 */
class LockedActions(
    vault: VaultRepository,
    private val scope: CoroutineScope,
    private val fallbackMessage: String,
    private val folderName: suspend (folderId: String) -> String? = { null },
    private val onFailure: suspend (message: String) -> Unit,
) {
    private var refused: (suspend () -> Unit)? = null

    /** The password prompt; the screen shows it. */
    val unlocker = FolderUnlocker(vault, scope) { refused?.let(::attempt) }

    fun attempt(action: suspend () -> Unit) {
        scope.launch {
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val lockedId = (e as? ReverieApiException)?.lockedFolderId()
                if (lockedId == null) {
                    onFailure((e as? ReverieApiException)?.userMessage() ?: fallbackMessage)
                    return@launch
                }
                refused = action
                unlocker.request(lockedId, folderName(lockedId))
            }
        }
    }

    /** Asks for the password of [folderId] with nothing to make again afterwards. */
    fun unlock(folderId: String) {
        refused = null
        unlocker.request(folderId)
    }
}
