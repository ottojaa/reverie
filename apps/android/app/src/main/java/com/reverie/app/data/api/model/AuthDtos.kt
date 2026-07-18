package com.reverie.app.data.api.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
)

/** refresh_token is delivered as a Set-Cookie header, not in this body. */
@Serializable
data class LoginResponse(
    val user: UserDto,
    val access_token: String,
    val expires_in: Long,
)

@Serializable
data class RefreshTokenRequest(
    val refresh_token: String,
)

@Serializable
data class RefreshTokenResponse(
    val access_token: String,
    val expires_in: Long,
)

@Serializable
data class ChangePasswordRequest(
    val current_password: String,
    val new_password: String,
)

@Serializable
data class CurrentUserResponse(
    val user: UserDto,
)

/** Domain-specific auth error envelope: `{ error, message }`. */
@Serializable
data class AuthErrorDto(
    val error: AuthErrorCode,
    val message: String,
)

@Serializable
enum class AuthErrorCode(val wire: String) {
    @SerialName("invalid_credentials") INVALID_CREDENTIALS("invalid_credentials"),
    @SerialName("account_disabled") ACCOUNT_DISABLED("account_disabled"),
    @SerialName("token_expired") TOKEN_EXPIRED("token_expired"),
    @SerialName("token_invalid") TOKEN_INVALID("token_invalid"),
    @SerialName("google_account_not_linked") GOOGLE_ACCOUNT_NOT_LINKED("google_account_not_linked"),
    @SerialName("password_mismatch") PASSWORD_MISMATCH("password_mismatch"),
}
