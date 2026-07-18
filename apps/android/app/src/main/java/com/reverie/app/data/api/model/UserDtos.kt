package com.reverie.app.data.api.model

import kotlinx.serialization.Serializable

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val display_name: String,
    val storage_quota_bytes: Long,
    val storage_used_bytes: Long,
    val is_active: Boolean,
    val role: UserRole,
    val created_at: String,
    val last_login_at: String? = null,
)

/** UserSchema + formatted storage strings (settings/profile). */
@Serializable
data class UserProfileDto(
    val id: String,
    val email: String,
    val display_name: String,
    val storage_quota_bytes: Long,
    val storage_used_bytes: Long,
    val is_active: Boolean,
    val role: UserRole,
    val created_at: String,
    val last_login_at: String? = null,
    val storage_quota_formatted: String,
    val storage_used_formatted: String,
    val storage_used_percentage: Double,
)
