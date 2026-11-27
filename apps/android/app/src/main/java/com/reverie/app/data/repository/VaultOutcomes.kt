package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.AuthErrorCode
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultRefusalDetails
import com.reverie.app.data.api.model.VaultStatus
import com.reverie.app.data.api.model.toAsk
import com.reverie.app.data.api.model.toSecretKind
import kotlinx.serialization.json.decodeFromJsonElement

/** Result of one try at a private folder's lock. */
sealed interface UnlockOutcome {
    data object Unlocked : UnlockOutcome

    /** A wrong PIN or lock password, with [triesLeft] before the server stops taking it. */
    data class WrongSecret(val kind: LockSecretKind, val triesLeft: Int) : UnlockOutcome

    /** The tries ran out: refused, and only the account password is taken now. */
    data object Stopped : UnlockOutcome

    /** A wrong account password, where no PIN or lock password is set. */
    data object WrongPassword : UnlockOutcome

    /** The account has no password, so there is nothing to unlock with (and nothing locks). */
    data object NoPassword : UnlockOutcome

    /** The folder is not private (any more), so there is no lock to open. */
    data object NotPrivate : UnlockOutcome

    /** Network or server trouble; [message] is user-facing. */
    data class Failed(val message: String) : UnlockOutcome
}

/** Result of setting, changing or removing the lock secret. */
sealed interface SaveSecretOutcome {
    data class Saved(val status: VaultStatus) : SaveSecretOutcome

    data object WrongAccountPassword : SaveSecretOutcome

    data object NoPassword : SaveSecretOutcome

    /** Network or server trouble; [message] is user-facing. */
    data class Failed(val message: String) : SaveSecretOutcome
}

/** What the lock asks for once a try was refused as [outcome] says. */
fun VaultStatus.afterRefusal(outcome: UnlockOutcome): VaultStatus = when (outcome) {
    is UnlockOutcome.WrongSecret -> copy(secret_kind = outcome.kind, ask = outcome.kind.toAsk())
    UnlockOutcome.Stopped -> copy(ask = LockAsk.ACCOUNT_PASSWORD)
    UnlockOutcome.WrongPassword -> copy(secret_kind = null, ask = LockAsk.ACCOUNT_PASSWORD)
    else -> this
}

/**
 * Map an unlock failure to an outcome. With a secret set, a refused try is a 403 saying what to ask for. Without one,
 * a wrong password is a 401, in either error envelope: the auth shape (`INVALID_CREDENTIALS`, no statusCode) or the
 * generic one (`401 invalid_credentials`).
 */
fun ReverieApiException.toUnlockOutcome(): UnlockOutcome {
    if (this is ReverieApiException.Auth && code == AuthErrorCode.INVALID_CREDENTIALS) return UnlockOutcome.WrongPassword
    if (this !is ReverieApiException.Http) return UnlockOutcome.Failed(userMessage())

    return when {
        statusCode == 401 && isInvalidCredentials() -> UnlockOutcome.WrongPassword
        statusCode == 400 && code == NO_PASSWORD_CODE -> UnlockOutcome.NoPassword
        statusCode == 404 -> UnlockOutcome.NotPrivate
        else -> toRefusal()?.toUnlockOutcome() ?: UnlockOutcome.Failed(userMessage())
    }
}

fun ReverieApiException.toSaveSecretOutcome(): SaveSecretOutcome {
    if (this !is ReverieApiException.Http) return SaveSecretOutcome.Failed(userMessage())
    if (toRefusal() != null) return SaveSecretOutcome.WrongAccountPassword
    if (statusCode == 400 && code == NO_PASSWORD_CODE) return SaveSecretOutcome.NoPassword

    return SaveSecretOutcome.Failed(userMessage())
}

private const val NO_PASSWORD_CODE = "no_password"

private fun ReverieApiException.Http.isInvalidCredentials(): Boolean = code == AuthErrorCode.INVALID_CREDENTIALS.wire

private fun ReverieApiException.Http.toRefusal(): VaultRefusalDetails? {
    if (statusCode != 403 || !isInvalidCredentials()) return null
    val json = details ?: return null

    return runCatching { ApiJson.decodeFromJsonElement<VaultRefusalDetails>(json) }.getOrNull()
}

/** Null for a refusal that names a secret but no count: not an answer this app knows. */
private fun VaultRefusalDetails.toUnlockOutcome(): UnlockOutcome? {
    val kind = ask.toSecretKind() ?: return UnlockOutcome.Stopped
    val left = tries_left ?: return null

    return UnlockOutcome.WrongSecret(kind, left)
}
