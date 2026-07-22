package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

@Serializable
data class VaultUnlockRequest(val password: String)

@Serializable
data class VaultStatus(
    val unlocked: Boolean,
    val has_password: Boolean,
)
