package com.reverie.app.data.api.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The secret of its own that private folders can open with, in place of the account password. */
@Serializable
enum class LockSecretKind {
    @SerialName("pin")
    PIN,

    @SerialName("password")
    PASSWORD,
}

/** What a lock takes now: the secret that is set, or the account password. */
@Serializable
enum class LockAsk {
    @SerialName("pin")
    PIN,

    @SerialName("password")
    PASSWORD,

    @SerialName("account_password")
    ACCOUNT_PASSWORD,
}

fun LockSecretKind.toAsk(): LockAsk = when (this) {
    LockSecretKind.PIN -> LockAsk.PIN
    LockSecretKind.PASSWORD -> LockAsk.PASSWORD
}

/** The secret [this] asks for; null when it asks for the account password. */
fun LockAsk.toSecretKind(): LockSecretKind? = when (this) {
    LockAsk.PIN -> LockSecretKind.PIN
    LockAsk.PASSWORD -> LockSecretKind.PASSWORD
    LockAsk.ACCOUNT_PASSWORD -> null
}

/** Unlock one private folder. [password] is what was typed: whichever the status's `ask` names. */
@Serializable
data class VaultUnlockRequest(
    val password: String,
    val folder_id: String,
)

/** A new PIN (four digits) or lock password (4 to 128 characters). */
@Serializable
data class LockSecret(
    val kind: LockSecretKind,
    val value: String,
)

/**
 * Response of `GET /vault/status`, `POST /vault/unlock` and `PUT /vault/secret`. `unlocked` is only a coarse "some
 * lock is open" signal and is not used for UI; `has_password` says whether the account has a password (without one
 * nothing can lock, and `ask` is null). `secret_kind` is the secret that is set, if any; `ask` differs from it once
 * too many wrong tries have stopped it.
 */
@Serializable
data class VaultStatus(
    val unlocked: Boolean,
    val has_password: Boolean,
    val secret_kind: LockSecretKind? = null,
    val ask: LockAsk? = null,
)

/** The `details` of a 403 refused try or save: what to ask for now, and the tries left at it, if they are counted. */
@Serializable
data class VaultRefusalDetails(
    val ask: LockAsk,
    val tries_left: Int? = null,
)
