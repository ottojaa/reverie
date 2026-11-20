package com.reverie.app.data.repository

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.VaultApi
import com.reverie.app.data.api.model.AuthErrorCode
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Result of trying to open one private folder lock with the account password. */
sealed interface UnlockOutcome {
    data object Unlocked : UnlockOutcome
    data object WrongPassword : UnlockOutcome

    /** The account has no password, so there is nothing to unlock with (and nothing locks). */
    data object NoPassword : UnlockOutcome

    /** The folder is not private (any more), so there is no lock to open. */
    data object NotPrivate : UnlockOutcome

    /** Network or server trouble; [message] is user-facing. */
    data class Failed(val message: String) : UnlockOutcome
}

@Singleton
class VaultRepository @Inject constructor(
    private val vaultApi: VaultApi,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /**
     * Open the lock around [folderId] (a private folder, or a private collection covering its
     * folders). The server remembers it in the session cookie; callers refetch the tree/list after.
     */
    suspend fun unlock(folderId: String, password: String): UnlockOutcome = withContext(io) {
        try {
            vaultApi.unlock(folderId, password)
            UnlockOutcome.Unlocked
        } catch (e: ReverieApiException) {
            e.toUnlockOutcome()
        }
    }

    /** Whether the account has a password. Null when it can't be determined (offline). */
    suspend fun hasPassword(): Boolean? = withContext(io) {
        runCatching { vaultApi.status().has_password }.getOrNull()
    }
}

/**
 * Map an unlock failure to an outcome. A wrong password arrives as either error envelope: the
 * auth shape (`INVALID_CREDENTIALS`, no statusCode) or the generic one (`401 invalid_credentials`).
 */
fun ReverieApiException.toUnlockOutcome(): UnlockOutcome = when {
    this is ReverieApiException.Auth && code == AuthErrorCode.INVALID_CREDENTIALS -> UnlockOutcome.WrongPassword
    this !is ReverieApiException.Http -> UnlockOutcome.Failed(userMessage())
    statusCode == 401 && code == "invalid_credentials" -> UnlockOutcome.WrongPassword
    statusCode == 400 && code == "no_password" -> UnlockOutcome.NoPassword
    statusCode == 404 -> UnlockOutcome.NotPrivate
    else -> UnlockOutcome.Failed(userMessage())
}
