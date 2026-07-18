package com.reverie.app.data.image

import com.reverie.app.data.auth.AuthSessionManager
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/** Attaches the current bearer token to thumbnail requests (Coil's OkHttp client). */
class AuthImageInterceptor(
    private val authSessionManager: AuthSessionManager,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = authSessionManager.currentAccessToken()
        val request = if (token != null) {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        return chain.proceed(request)
    }
}

/** On a 401, refreshes once (shared single-flight) and retries the thumbnail request. */
class AuthImageAuthenticator(
    private val authSessionManager: AuthSessionManager,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        val failedToken = response.request.header("Authorization")?.removePrefix("Bearer ")
        val refreshed = runBlocking { authSessionManager.refresh(failedToken) }
        if (!refreshed) return null
        val newToken = authSessionManager.currentAccessToken() ?: return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer $newToken")
            .build()
    }
}
