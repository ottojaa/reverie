package com.reverie.app.data.auth

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.LoginResponse
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.data.api.model.UserRole
import com.reverie.app.domain.model.AuthState
import dagger.Lazy
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class AuthSessionManagerTest {

    private class FakeTokenStore : TokenStore {
        var saved: TokenBundle? = null
        var cleared = false
        override suspend fun load(): TokenBundle? = saved
        override suspend fun save(bundle: TokenBundle) { saved = bundle }
        override suspend fun clear() { saved = null; cleared = true }
    }

    private val user = UserDto(
        id = "u1", email = "a@b.com", display_name = "A",
        storage_quota_bytes = 1000, storage_used_bytes = 10,
        is_active = true, role = UserRole.USER, created_at = "2024-01-01T00:00:00.000Z",
    )

    private fun client(
        refreshCount: AtomicInteger,
        fail: Boolean,
        failStatus: HttpStatusCode = HttpStatusCode.Unauthorized,
    ): HttpClient {
        val engine = MockEngine { request ->
            if (request.url.encodedPath.endsWith("/auth/refresh")) {
                refreshCount.incrementAndGet()
                if (fail) {
                    respond(
                        content = """{"error":"token_invalid","message":"expired"}""",
                        status = failStatus,
                        headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
                    )
                } else {
                    respond(
                        content = """{"access_token":"new-access","expires_in":900}""",
                        status = HttpStatusCode.OK,
                        headers = Headers.build {
                            append(HttpHeaders.ContentType, "application/json")
                            append(HttpHeaders.SetCookie, "refresh_token=rotated-refresh; Path=/auth; HttpOnly")
                        },
                    )
                }
            } else {
                respond("{}", HttpStatusCode.NotFound)
            }
        }
        return HttpClient(engine) {
            expectSuccess = false
            install(ContentNegotiation) { json(ApiJson) }
            defaultRequest { url.takeFrom("http://localhost/") }
        }
    }

    private fun manager(client: HttpClient, store: TokenStore): AuthSessionManager {
        val scope = CoroutineScope(UnconfinedTestDispatcher())
        return AuthSessionManager(Lazy { client }, store, scope)
    }

    private suspend fun AuthSessionManager.seed() {
        onLoginSuccess(LoginResponse(user, access_token = "acc", expires_in = 900), "refresh-1")
    }

    @Test fun `refresh rotates the access token and persists the rotated refresh cookie`() = runTest {
        val count = AtomicInteger()
        val store = FakeTokenStore()
        val session = manager(client(count, fail = false), store)
        session.seed()

        val ok = session.refresh("acc")

        assertTrue(ok)
        assertEquals("new-access", session.currentAccessToken())
        assertEquals("rotated-refresh", store.saved?.refreshToken)
        assertEquals(1, count.get())
    }

    @Test fun `concurrent refreshes collapse into a single network call`() = runTest {
        val count = AtomicInteger()
        val session = manager(client(count, fail = false), FakeTokenStore())
        session.seed()

        val a = async { session.refresh("acc") }
        val b = async { session.refresh("acc") }

        assertTrue(a.await())
        assertTrue(b.await())
        assertEquals(1, count.get())
    }

    @Test fun `a stale failed-token short-circuits without a network call`() = runTest {
        val count = AtomicInteger()
        val session = manager(client(count, fail = false), FakeTokenStore())
        session.seed()

        assertTrue(session.refresh("acc")) // rotates to new-access, count = 1
        assertTrue(session.refresh("acc")) // stale token → no-op success
        assertEquals(1, count.get())
    }

    @Test fun `a 401 refresh logs the user out`() = runTest {
        val count = AtomicInteger()
        val store = FakeTokenStore()
        val session = manager(client(count, fail = true, failStatus = HttpStatusCode.Unauthorized), store)
        session.seed()

        val ok = session.refresh("acc")

        assertFalse(ok)
        assertTrue(session.authState.value is AuthState.LoggedOut)
        assertTrue(store.cleared)
    }

    @Test fun `a 503 refresh keeps the session (transient, not a rejection)`() = runTest {
        val count = AtomicInteger()
        val store = FakeTokenStore()
        val session = manager(client(count, fail = true, failStatus = HttpStatusCode.ServiceUnavailable), store)
        session.seed()

        val ok = session.refresh("acc")

        assertFalse(ok)
        assertTrue(session.authState.value is AuthState.Authenticated)
        assertFalse(store.cleared)
    }

    @Test fun `a 429 rate-limited refresh keeps the session`() = runTest {
        val count = AtomicInteger()
        val store = FakeTokenStore()
        val session = manager(client(count, fail = true, failStatus = HttpStatusCode.TooManyRequests), store)
        session.seed()

        val ok = session.refresh("acc")

        assertFalse(ok)
        assertTrue(session.authState.value is AuthState.Authenticated)
        assertFalse(store.cleared)
    }
}
