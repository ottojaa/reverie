package com.reverie.app.ui.screens.privatefolders

import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.ui.components.PIN_LENGTH

private val PASSWORD_LENGTHS = 4..128

/** What the lock settings sheet holds. A null [choice] is the account password: no PIN or lock password. */
data class LockDraft(
    val choice: LockSecretKind?,
    val secret: String = "",
    val repeat: String = "",
    val accountPassword: String = "",
) {
    /** Whether there is a change to save over the [current] secret, and the account password to prove it with. */
    fun canSave(current: LockSecretKind?): Boolean = accountPassword.isNotEmpty() && (choice != null || current != null)

    /** What keeps the draft from being saved, as a line to show; null when nothing does. */
    fun toProblem(): String? = when {
        choice == null -> null
        choice == LockSecretKind.PIN && secret.length != PIN_LENGTH -> "A PIN is exactly four digits."
        choice == LockSecretKind.PASSWORD && secret.length !in PASSWORD_LENGTHS -> "A lock password is 4 to 128 characters."
        secret == repeat -> null
        choice == LockSecretKind.PIN -> "The PINs do not match."
        else -> "The passwords do not match."
    }

    /** The secret to save; null removes the one there is. */
    fun toSecret(): LockSecret? = choice?.let { LockSecret(it, secret) }
}
