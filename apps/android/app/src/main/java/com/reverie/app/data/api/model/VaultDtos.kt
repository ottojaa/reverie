package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

@Serializable
data class VaultUnlockRequest(val password: String)

@Serializable
data class VaultSettingsRequest(val hide_private: Boolean)

@Serializable
data class VaultStatus(
    val hide_enabled: Boolean,
    val unlocked: Boolean,
    val expires_at: String? = null,
    val has_password: Boolean,
)
