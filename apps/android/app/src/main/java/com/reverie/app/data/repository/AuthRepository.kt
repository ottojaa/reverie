package com.reverie.app.data.repository

import com.reverie.app.data.api.AuthApi
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.domain.model.AuthState
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val session: AuthSessionManager,
    private val vaultRepository: VaultRepository,
) {
    val authState: StateFlow<AuthState> = session.authState

    /** Read persisted tokens and validate the session (called once at app start). */
    suspend fun bootstrap() = session.bootstrap()

    suspend fun login(email: String, password: String): Result<Unit> = runCatching {
        val result = authApi.login(email.trim(), password)
        // The backend always sets the refresh cookie on login; guard defensively.
        val refresh = result.refreshToken
            ?: throw ReverieApiException.Http(500, "no_refresh", "Sign-in did not return a refresh token.")
        session.onLoginSuccess(result.response, refresh)
    }

    suspend fun logout() {
        // The backend /auth/logout clears both the refresh and vault_session cookies; also drop
        // the in-memory vault state so the next user starts locked.
        authApi.logout()
        session.logout()
        vaultRepository.reset()
    }

    suspend fun changePassword(currentPassword: String, newPassword: String): Result<Unit> = runCatching {
        authApi.changePassword(currentPassword, newPassword)
    }
}
