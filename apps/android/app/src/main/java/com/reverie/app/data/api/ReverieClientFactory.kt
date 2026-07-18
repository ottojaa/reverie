package com.reverie.app.data.api

import com.reverie.app.BuildConfig
import com.reverie.app.data.auth.AuthSessionManager
import dagger.Lazy
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpSend
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.plugins.plugin
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Builds the app's single [HttpClient]. Auth is handled with a manual [HttpSend] interceptor
 * (rather than the Auth plugin) so all three token consumers share one refresh authority and
 * the semantics exactly mirror the web interceptor: attach bearer → on 401 refresh once →
 * retry once → give up. The base URL is read from [ServerUrlProvider] per request so a
 * Settings change re-targets the client live.
 */
@Singleton
class ReverieClientFactory @Inject constructor(
    private val serverUrlProvider: ServerUrlProvider,
    private val authSessionManager: Lazy<AuthSessionManager>,
) {
    fun create(): HttpClient {
        val client = HttpClient(OkHttp) {
            expectSuccess = false

            install(ContentNegotiation) { json(ApiJson) }
            install(HttpCookies) { storage = AcceptAllCookiesStorage() }
            install(HttpTimeout) {
                requestTimeoutMillis = 60_000
                connectTimeoutMillis = 30_000
                socketTimeoutMillis = 60_000
            }
            if (BuildConfig.DEBUG) {
                install(Logging) { level = LogLevel.INFO }
            }
            defaultRequest {
                url.takeFrom(serverUrlProvider.current())
            }
        }

        client.plugin(HttpSend).intercept { request ->
            val path = "/" + request.url.encodedPathSegments.filter { it.isNotEmpty() }.joinToString("/")
            val attach = shouldAttachAuth(path)
            val session = authSessionManager.get()

            if (attach) {
                session.currentAccessToken()?.let {
                    request.headers[HttpHeaders.Authorization] = "Bearer $it"
                }
            }

            var call = execute(request)

            if (attach && call.response.status == HttpStatusCode.Unauthorized) {
                val failedToken = session.currentAccessToken()
                if (session.refresh(failedToken)) {
                    session.currentAccessToken()?.let {
                        request.headers.remove(HttpHeaders.Authorization)
                        request.headers[HttpHeaders.Authorization] = "Bearer $it"
                    }
                    call = execute(request)
                }
            }
            call
        }

        return client
    }

    private fun shouldAttachAuth(path: String): Boolean {
        if (path.startsWith("/files/")) return false // signed URLs carry their own auth
        val publicAuth = path == "/auth/login" ||
            path == "/auth/refresh" ||
            path == "/auth/logout" ||
            path == "/auth/exchange-oauth-code" ||
            path.startsWith("/auth/google")
        return !publicAuth
    }
}
