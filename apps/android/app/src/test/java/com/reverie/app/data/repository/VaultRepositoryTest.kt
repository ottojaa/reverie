package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.VaultApi
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecret
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.api.model.VaultStatus
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * What the lock calls send and what each answer means. The status, request and refusal bodies named here are the
 * contract fixtures the server's own tests answer with.
 */
class VaultRepositoryTest {

    private class Request(val line: String, val body: String)

    private val requests = mutableListOf<Request>()

    /** What the next request is answered with; null drops the connection. */
    private var answer: Pair<HttpStatusCode, String>? = HttpStatusCode.OK to fixture("vault-status.json")

    private val client = HttpClient(
        MockEngine { request ->
            requests += Request("${request.method.value} ${request.url.encodedPath}", (request.body as? TextContent)?.text.orEmpty())
            val (status, body) = answer ?: throw IOException("offline")
            respond(body, status, Headers.build { append(HttpHeaders.ContentType, "application/json") })
        },
    ) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    private val repo = VaultRepository(VaultApi(client), UnconfinedTestDispatcher())

    private fun fixture(name: String): String =
        checkNotNull(javaClass.classLoader?.getResource(name)) { "Missing fixture: $name" }.readText()

    private fun answers(body: String, status: HttpStatusCode = HttpStatusCode.OK) {
        answer = status to body
    }

    private fun refuses(code: String, status: HttpStatusCode, details: String? = null) = answers(
        """{"statusCode":${status.value},"error":"$code","message":"Server says $code"${details?.let { ""","details":$it""" }.orEmpty()}}""",
        status,
    )

    private fun status(hasPassword: Boolean, kind: String?, ask: String?) =
        """{"unlocked":false,"has_password":$hasPassword,"secret_kind":${kind?.let { "\"$it\"" }},"ask":${ask?.let { "\"$it\"" }}}"""

    private fun assertSent(line: String, body: String) {
        val sent = requests.single()
        assertEquals(line, sent.line)
        assertEquals(ApiJson.parseToJsonElement(body), ApiJson.parseToJsonElement(sent.body))
    }

    @Test fun `the status says which secret is set and what to ask for`() = runTest {
        assertEquals(VaultStatus(true, true, LockSecretKind.PIN, LockAsk.PIN), repo.fetchStatus())
        assertEquals("GET /vault/status", requests.single().line)
    }

    @Test fun `each other status is read as it stands`() = runTest {
        val cases = mapOf(
            status(true, "password", "password") to VaultStatus(false, true, LockSecretKind.PASSWORD, LockAsk.PASSWORD),
            status(true, "pin", "account_password") to VaultStatus(false, true, LockSecretKind.PIN, LockAsk.ACCOUNT_PASSWORD),
            status(true, null, "account_password") to VaultStatus(false, true, null, LockAsk.ACCOUNT_PASSWORD),
            status(false, null, null) to VaultStatus(false, false, null, null),
        )

        cases.forEach { (body, expected) ->
            answers(body)
            assertEquals(body, expected, repo.fetchStatus())
            assertEquals(body, expected, repo.status.value)
        }
    }

    @Test fun `a status that cannot be read is null and what was heard last stays`() = runTest {
        val heard = repo.fetchStatus()

        refuses("INTERNAL", HttpStatusCode.InternalServerError)
        assertNull(repo.fetchStatus())
        answer = null
        assertNull(repo.fetchStatus())

        assertEquals(heard, repo.status.value)
    }

    @Test fun `signing out forgets what the lock asked for`() = runTest {
        repo.fetchStatus()

        repo.forgetStatus()

        assertNull(repo.status.value)
    }

    @Test fun `an unlock sends what was typed and the folder, and reports success`() = runTest {
        val outcome = repo.unlock("10000000-0000-4000-8000-000000000006", "4821")

        assertEquals(UnlockOutcome.Unlocked, outcome)
        assertSent("POST /vault/unlock", fixture("vault-unlock-request.json"))
        assertEquals(LockAsk.PIN, repo.status.value?.ask)
    }

    @Test fun `a wrong try says how many are left`() = runTest {
        answers(fixture("vault-refusal-tries-left.json"), HttpStatusCode.Forbidden)

        assertEquals(UnlockOutcome.WrongSecret(LockSecretKind.PIN, 7), repo.unlock("f", "0000"))
    }

    @Test fun `a wrong lock password says so too`() = runTest {
        refuses("invalid_credentials", HttpStatusCode.Forbidden, """{"ask":"password","tries_left":1}""")

        assertEquals(UnlockOutcome.WrongSecret(LockSecretKind.PASSWORD, 1), repo.unlock("f", "nope"))
    }

    @Test fun `the try that uses them up stops the secret, and the app then asks for the account password`() = runTest {
        repo.fetchStatus()
        answers(fixture("vault-refusal-stopped.json"), HttpStatusCode.Forbidden)

        assertEquals(UnlockOutcome.Stopped, repo.unlock("f", "0000"))

        assertEquals(LockSecretKind.PIN, repo.status.value?.secret_kind)
        assertEquals(LockAsk.ACCOUNT_PASSWORD, repo.status.value?.ask)
    }

    @Test fun `a refusal changes what the app asks for`() = runTest {
        repo.fetchStatus()
        refuses("invalid_credentials", HttpStatusCode.Forbidden, """{"ask":"password","tries_left":9}""")

        repo.unlock("f", "4821")

        assertEquals(VaultStatus(true, true, LockSecretKind.PASSWORD, LockAsk.PASSWORD), repo.status.value)
    }

    @Test fun `a 403 refusal the app cannot read is a failure with the server's words`() = runTest {
        refuses("invalid_credentials", HttpStatusCode.Forbidden, """{"ask":"pin","tries_left":null}""")

        assertEquals(UnlockOutcome.Failed("Server says invalid_credentials"), repo.unlock("f", "0000"))
    }

    @Test fun `with no secret set a wrong account password is a 401, in either error envelope`() = runTest {
        answers("""{"error":"invalid_credentials","message":"Nope"}""", HttpStatusCode.Unauthorized)
        assertEquals(UnlockOutcome.WrongPassword, repo.unlock("f", "bad"))

        refuses("invalid_credentials", HttpStatusCode.Unauthorized)
        assertEquals(UnlockOutcome.WrongPassword, repo.unlock("f", "bad"))
    }

    @Test fun `an account without a password is NoPassword`() = runTest {
        refuses("no_password", HttpStatusCode.BadRequest)

        assertEquals(UnlockOutcome.NoPassword, repo.unlock("f", "x"))
    }

    @Test fun `a folder that is not private is NotPrivate`() = runTest {
        refuses("NOT_FOUND", HttpStatusCode.NotFound)

        assertEquals(UnlockOutcome.NotPrivate, repo.unlock("f", "x"))
    }

    @Test fun `too many requests, server trouble and no network are failures with a message`() = runTest {
        refuses("RATE_LIMITED", HttpStatusCode.TooManyRequests)
        assertEquals(UnlockOutcome.Failed("Server says RATE_LIMITED"), repo.unlock("f", "x"))

        refuses("INTERNAL", HttpStatusCode.InternalServerError)
        assertEquals(UnlockOutcome.Failed("Server says INTERNAL"), repo.unlock("f", "x"))

        answer = null
        assertTrue(repo.unlock("f", "x") is UnlockOutcome.Failed)
    }

    @Test fun `saving a PIN sends it with the account password and returns the new status`() = runTest {
        val outcome = repo.saveSecret("hunter2", LockSecret(LockSecretKind.PIN, "4821"))

        assertSent("PUT /vault/secret", """{"account_password":"hunter2","secret":{"kind":"pin","value":"4821"}}""")
        val saved = VaultStatus(true, true, LockSecretKind.PIN, LockAsk.PIN)
        assertEquals(SaveSecretOutcome.Saved(saved), outcome)
        assertEquals(saved, repo.status.value)
    }

    @Test fun `saving a lock password sends it as one`() = runTest {
        repo.saveSecret("hunter2", LockSecret(LockSecretKind.PASSWORD, "open sesame"))

        assertSent("PUT /vault/secret", """{"account_password":"hunter2","secret":{"kind":"password","value":"open sesame"}}""")
    }

    @Test fun `going back to the account password sends a null secret`() = runTest {
        answers(status(true, null, "account_password"))

        repo.saveSecret("hunter2", null)

        assertEquals("""{"account_password":"hunter2","secret":null}""", requests.single().body)
        assertEquals(LockAsk.ACCOUNT_PASSWORD, repo.status.value?.ask)
    }

    @Test fun `a save with a wrong account password changes nothing`() = runTest {
        val heard = repo.fetchStatus()
        refuses("invalid_credentials", HttpStatusCode.Forbidden, """{"ask":"account_password","tries_left":null}""")

        assertEquals(SaveSecretOutcome.WrongAccountPassword, repo.saveSecret("bad", null))
        assertEquals(heard, repo.status.value)
    }

    @Test fun `a save on an account without a password is NoPassword`() = runTest {
        refuses("no_password", HttpStatusCode.BadRequest)

        assertEquals(SaveSecretOutcome.NoPassword, repo.saveSecret("x", null))
    }

    @Test fun `a save that fails otherwise says why`() = runTest {
        refuses("RATE_LIMITED", HttpStatusCode.TooManyRequests)
        assertEquals(SaveSecretOutcome.Failed("Server says RATE_LIMITED"), repo.saveSecret("x", null))

        answer = null
        assertEquals(
            SaveSecretOutcome.Failed("Couldn't reach the server. Check your connection and try again."),
            repo.saveSecret("x", null),
        )
    }
}
