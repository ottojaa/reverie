package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

/** Unlock one private folder (or private collection) with the account password. */
@Serializable
data class VaultUnlockRequest(
    val password: String,
    val folder_id: String,
)

/**
 * Response of `GET /vault/status` and `POST /vault/unlock`. `unlocked` is only a coarse "some lock is open" signal and is not used
 * for UI; `has_password` says whether the account has a password (without one nothing can lock).
 */
@Serializable
data class VaultStatus(
    val unlocked: Boolean,
    val has_password: Boolean,
)
