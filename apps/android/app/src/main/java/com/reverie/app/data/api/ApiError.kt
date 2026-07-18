package com.reverie.app.data.api

import com.reverie.app.data.api.model.AuthErrorCode
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Every failure the API layer surfaces. Parses both server error envelopes:
 * the generic `{ statusCode, error, message, details? }` and the auth-specific
 * `{ error(enum), message }`.
 */
sealed class ReverieApiException(message: String, cause: Throwable? = null) : Exception(message, cause) {

    class Http(
        val statusCode: Int,
        val code: String,
        override val message: String,
        val details: JsonObject? = null,
    ) : ReverieApiException(message)

    class Auth(
        val code: AuthErrorCode,
        override val message: String,
    ) : ReverieApiException(message)

    class Network(cause: Throwable) : ReverieApiException("Network error", cause)

    class Serialization(cause: Throwable) : ReverieApiException("Malformed response", cause)

    /** A short, user-facing message. Prefers the server's text, with friendly auth copy. */
    fun userMessage(): String = when (this) {
        is Auth -> when (code) {
            AuthErrorCode.INVALID_CREDENTIALS -> "Invalid email or password."
            AuthErrorCode.ACCOUNT_DISABLED -> "This account has been disabled."
            AuthErrorCode.TOKEN_EXPIRED, AuthErrorCode.TOKEN_INVALID -> "Your session expired. Please sign in again."
            AuthErrorCode.GOOGLE_ACCOUNT_NOT_LINKED -> "No account is linked to that Google account. Contact an administrator."
            AuthErrorCode.PASSWORD_MISMATCH -> "Your current password is incorrect."
        }
        is Http -> message.ifBlank { "Request failed ($statusCode)." }
        is Network -> "Couldn't reach the server. Check your connection and try again."
        is Serialization -> "The server sent an unexpected response."
    }

    companion object {
        /** True when the failure is an authentication/authorization problem (401/403). */
        fun isAuthFailure(e: ReverieApiException): Boolean = when (e) {
            is Auth -> e.code == AuthErrorCode.TOKEN_EXPIRED || e.code == AuthErrorCode.TOKEN_INVALID
            is Http -> e.statusCode == 401 || e.statusCode == 403
            else -> false
        }

        /** Parse an error response body into the appropriate exception. */
        fun parse(status: Int, body: String): ReverieApiException {
            val obj = runCatching { ApiJson.parseToJsonElement(body) as? JsonObject }.getOrNull()
                ?: return Http(status, "unknown", body.take(200).ifBlank { "Request failed ($status)." })

            val errorField = obj["error"]?.jsonPrimitive?.contentOrNull
            val hasStatusCode = obj["statusCode"]?.jsonPrimitive?.intOrNull != null
            val message = obj["message"]?.jsonPrimitive?.contentOrNull

            // Auth envelope: `error` is a known auth code and there's no HTTP statusCode field.
            val authCode = errorField?.let { code -> AuthErrorCode.entries.firstOrNull { it.wire == code } }
            if (authCode != null && !hasStatusCode) {
                return Auth(authCode, message ?: authCode.wire)
            }

            return Http(
                statusCode = obj["statusCode"]?.jsonPrimitive?.intOrNull ?: status,
                code = errorField ?: "error",
                message = message ?: body.take(200).ifBlank { "Request failed ($status)." },
                details = obj["details"] as? JsonObject,
            )
        }
    }
}
