package com.reverie.app.data.auth

import com.reverie.app.data.api.cookieValue
import com.reverie.app.data.api.decode
import com.reverie.app.data.api.model.CurrentUserResponse
import com.reverie.app.data.api.model.LoginResponse
import com.reverie.app.data.api.model.RefreshTokenRequest
import com.reverie.app.data.api.model.RefreshTokenResponse
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.di.ApplicationScope
import com.reverie.app.domain.model.AuthState
import dagger.Lazy
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The single authority over the session's tokens, shared by every HTTP consumer.
 *
 * Refresh is guarded by a [Mutex] so concurrent 401s (API + Coil + upload worker) collapse
 * into one network refresh. Because the server rotates refresh tokens one-time, a second
 * refresh with a stale token would hard-log-out the user — the failed-token comparison
 * short-circuits that. The rotated refresh token only ever arrives via `Set-Cookie`, so it
 * is captured from the response headers and persisted (with the new access token) before use.
 */
@Singleton
class AuthSessionManager @Inject constructor(
    private val lazyClient: Lazy<HttpClient>,
    private val tokenStore: TokenStore,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val client: HttpClient get() = lazyClient.get()
    private val refreshMutex = Mutex()

    @Volatile private var accessToken: String? = null
    @Volatile private var refreshToken: String? = null
    @Volatile private var expiresAtEpochMs: Long = 0
    @Volatile private var currentUser: UserDto? = null

    private val _authState = MutableStateFlow<AuthState>(AuthState.Unknown)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    fun currentAccessToken(): String? = accessToken

    /** Load persisted tokens, show the cached user immediately, then validate in the background. */
    suspend fun bootstrap() {
        val bundle = tokenStore.load()
        if (bundle == null) {
            _authState.value = AuthState.LoggedOut
            return
        }
        accessToken = bundle.accessToken
        refreshToken = bundle.refreshToken
        expiresAtEpochMs = bundle.expiresAtEpochMs
        currentUser = bundle.user
        _authState.value = AuthState.Authenticated(bundle.user)
        scope.launch { validateSession() }
    }

    /**
     * Confirm the persisted session is still valid via GET /auth/me. A hard auth failure is
     * already handled by the refresh path (which logs out); we only refresh the cached user
     * on success and ignore transient/offline errors so an offline start stays signed in.
     */
    private suspend fun validateSession() {
        runCatching {
            val response = client.get("auth/me")
            response.decode<CurrentUserResponse>()
        }.onSuccess { updateUser(it.user) }
    }

    suspend fun onLoginSuccess(login: LoginResponse, refreshTokenValue: String) {
        currentUser = login.user
        updateTokens(login.access_token, refreshTokenValue, login.expires_in)
        _authState.value = AuthState.Authenticated(login.user)
    }

    /** Update the in-memory + persisted user (e.g. after /auth/me), keeping tokens intact. */
    suspend fun updateUser(user: UserDto) {
        currentUser = user
        persist()
        if (_authState.value is AuthState.Authenticated) {
            _authState.value = AuthState.Authenticated(user)
        }
    }

    /**
     * Refresh the access token. Returns true when a valid token is available afterwards.
     * Single-flight: if another caller already rotated the token past [failedToken], succeed
     * immediately without a network call.
     */
    suspend fun refresh(failedToken: String?): Boolean = refreshMutex.withLock {
        val current = accessToken
        if (failedToken != null && current != null && current != failedToken) return true

        val refresh = refreshToken
        if (refresh == null) {
            logout()
            return false
        }

        val response = runCatching {
            client.post("auth/refresh") {
                contentType(ContentType.Application.Json)
                setBody(RefreshTokenRequest(refresh))
            }
        }.getOrElse {
            // Transient/offline failure — keep the session, let the caller fail this attempt.
            return false
        }

        if (!response.status.isSuccess()) {
            // The refresh token was rejected (rotation consumed / expired): hard logout.
            logout()
            return false
        }

        val body = response.body<RefreshTokenResponse>()
        val rotated = response.cookieValue(REFRESH_COOKIE) ?: refresh
        updateTokens(body.access_token, rotated, body.expires_in)
        return true
    }

    suspend fun logout() {
        accessToken = null
        refreshToken = null
        expiresAtEpochMs = 0
        currentUser = null
        tokenStore.clear()
        _authState.value = AuthState.LoggedOut
    }

    private suspend fun updateTokens(access: String, refresh: String, expiresInSeconds: Long) {
        accessToken = access
        refreshToken = refresh
        expiresAtEpochMs = nowMs() + expiresInSeconds * 1000
        persist()
    }

    private suspend fun persist() {
        val user = currentUser ?: return
        val access = accessToken ?: return
        val refresh = refreshToken ?: return
        tokenStore.save(TokenBundle(access, refresh, expiresAtEpochMs, user))
    }

    private fun nowMs(): Long = System.currentTimeMillis()

    private companion object {
        const val REFRESH_COOKIE = "refresh_token"
    }
}
