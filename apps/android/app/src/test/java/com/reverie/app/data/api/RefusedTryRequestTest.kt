package com.reverie.app.data.api

import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.LoginResponse
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.data.api.model.UserRole
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.auth.TokenBundle
import com.reverie.app.data.auth.TokenStore
import com.reverie.app.data.repository.SaveSecretOutcome
import com.reverie.app.data.repository.UnlockOutcome
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.data.settings.SettingsRepository
import dagger.Lazy
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The server counts every wrong try at a lock, so one try must reach it once. These run on the app's own client,
 * whose 401 handling renews the login and sends the request again: a refusal is a 403 and has to pass through it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class RefusedTryRequestTest {

    private class MemoryTokenStore : TokenStore {
        private var saved: TokenBundle? = null
        override suspend fun load(): TokenBundle? = saved
        override suspend fun save(bundle: TokenBundle) { saved = bundle }
        override suspend fun clear() { saved = null }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val requests = CopyOnWriteArrayList<String>()

    /** What the lock calls are answered with. */
    private var lockAnswer = HttpStatusCode.Forbidden to
        """{"statusCode":403,"error":"invalid_credentials","message":"No","details":{"ask":"pin","tries_left":7}}"""

    private val engine = MockEngine { request ->
        requests += "${request.method.value} ${request.url.encodedPath}"
        if (request.url.encodedPath != "/auth/refresh") return@MockEngine respond(lockAnswer.second, lockAnswer.first, JSON)
        respond(
            """{"access_token":"new-access","expires_in":900}""",
            HttpStatusCode.OK,
            Headers.build {
                append(HttpHeaders.ContentType, "application/json")
                append(HttpHeaders.SetCookie, "refresh_token=rotated; Path=/auth; HttpOnly")
            },
        )
    }

    @After fun tearDown() = scope.cancel()

    private suspend fun signedInVault(): VaultRepository {
        val cookies = SessionCookieStorage()
        val serverUrl = ServerUrlProvider(SettingsRepository(ApplicationProvider.getApplicationContext()), scope)
        lateinit var client: HttpClient
        val session = AuthSessionManager(Lazy { client }, MemoryTokenStore(), cookies, scope)
        client = ReverieClientFactory(serverUrl, Lazy { session }, cookies).create(engine)
        val user = UserDto(
            id = "u1", email = "a@b.com", display_name = "A",
            storage_quota_bytes = 1000, storage_used_bytes = 10,
            is_active = true, role = UserRole.USER, created_at = "2024-01-01T00:00:00.000Z",
        )
        session.onLoginSuccess(LoginResponse(user, access_token = "acc", expires_in = 900), "refresh-1")
        return VaultRepository(VaultApi(client), Dispatchers.Unconfined)
    }

    @Test fun `a wrong try is one request`() = runBlocking {
        val outcome = signedInVault().unlock("f", "0000")

        assertEquals(UnlockOutcome.WrongSecret(LockSecretKind.PIN, 7), outcome)
        assertEquals(listOf("POST /vault/unlock"), requests.toList())
    }

    @Test fun `a save refused for its account password is one request`() = runBlocking {
        lockAnswer = HttpStatusCode.Forbidden to
            """{"statusCode":403,"error":"invalid_credentials","message":"No","details":{"ask":"account_password","tries_left":null}}"""

        val outcome = signedInVault().saveSecret("bad", null)

        assertEquals(SaveSecretOutcome.WrongAccountPassword, outcome)
        assertEquals(listOf("PUT /vault/secret"), requests.toList())
    }

    @Test fun `a 401 is sent again after renewing the login, which is why a refusal is not one`() = runBlocking {
        lockAnswer = HttpStatusCode.Unauthorized to """{"error":"invalid_credentials","message":"No"}"""

        signedInVault().unlock("f", "0000")

        assertEquals(listOf("POST /vault/unlock", "POST /auth/refresh", "POST /vault/unlock"), requests.toList())
    }

    private companion object {
        val JSON = Headers.build { append(HttpHeaders.ContentType, "application/json") }
    }
}
