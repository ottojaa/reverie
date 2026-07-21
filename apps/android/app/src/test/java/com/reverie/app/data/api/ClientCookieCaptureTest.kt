package com.reverie.app.data.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.post
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.takeFrom
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Guards the rotating-refresh-token capture against the "HttpCookies swallows Set-Cookie" theory.
 *
 * The prod client installs `HttpCookies { storage = AcceptAllCookiesStorage() }`, and the app
 * captures the rotated refresh token from the response's `Set-Cookie` header ([cookieValue]). This
 * reproduces that exact config to prove the plugin does NOT strip the header — both the raw-header
 * read and the plugin's cookie jar see the rotated value. If a Ktor upgrade ever changes that, this
 * test fails and the [storedCookieValue] jar fallback in AuthSessionManager becomes the real path.
 */
class ClientCookieCaptureTest {

    private fun prodLikeClient(): HttpClient {
        val engine = MockEngine {
            respond(
                content = """{"access_token":"new-access","expires_in":900}""",
                status = HttpStatusCode.OK,
                headers = Headers.build {
                    append(HttpHeaders.ContentType, "application/json")
                    append(HttpHeaders.SetCookie, "refresh_token=rotated-refresh; Path=/auth; HttpOnly; Secure; SameSite=Lax")
                },
            )
        }
        return HttpClient(engine) {
            expectSuccess = false
            install(HttpCookies) { storage = AcceptAllCookiesStorage() }
            defaultRequest { url.takeFrom("https://api.example.test/") }
        }
    }

    @Test fun `cookieValue reads Set-Cookie even with HttpCookies installed`() = runTest {
        val response = prodLikeClient().post("auth/refresh")
        assertEquals("rotated-refresh", response.cookieValue("refresh_token"))
    }

    @Test fun `HttpCookies jar also captures the rotated cookie`() = runTest {
        val client = prodLikeClient()
        client.post("auth/refresh")
        assertEquals(
            "rotated-refresh",
            client.storedCookieValue(Url("https://api.example.test/auth/refresh"), "refresh_token"),
        )
    }
}
