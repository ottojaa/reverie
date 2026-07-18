package com.reverie.app.data.api

import com.reverie.app.data.api.model.ChangePasswordRequest
import com.reverie.app.data.api.model.CurrentUserResponse
import com.reverie.app.data.api.model.LoginRequest
import com.reverie.app.data.api.model.LoginResponse
import com.reverie.app.data.api.model.UserDto
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton

/** The rotating refresh token is only returned via Set-Cookie, so it rides alongside the body. */
data class LoginResult(val response: LoginResponse, val refreshToken: String?)

@Singleton
class AuthApi @Inject constructor(
    private val client: HttpClient,
) {
    suspend fun login(email: String, password: String): LoginResult {
        val response = client.post("auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }
        val body = response.decode<LoginResponse>()
        return LoginResult(body, response.cookieValue(REFRESH_COOKIE))
    }

    suspend fun me(): UserDto = client.get("auth/me").decode<CurrentUserResponse>().user

    suspend fun logout() {
        runCatching { client.post("auth/logout") }
    }

    suspend fun changePassword(currentPassword: String, newPassword: String) {
        client.post("auth/change-password") {
            contentType(ContentType.Application.Json)
            setBody(ChangePasswordRequest(currentPassword, newPassword))
        }.throwIfError()
    }

    private companion object {
        const val REFRESH_COOKIE = "refresh_token"
    }
}
