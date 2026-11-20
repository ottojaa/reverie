package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.VaultApi
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultRepositoryTest {

    private val requests = mutableListOf<String>()

    private fun vaultRepo(status: HttpStatusCode, body: String): VaultRepository {
        val engine = MockEngine { request ->
            requests += "${request.method.value} ${request.url.encodedPath} ${(request.body as? io.ktor.http.content.TextContent)?.text.orEmpty()}"
            respond(
                content = body,
                status = status,
                headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
            )
        }
        val client = HttpClient(engine) {
            expectSuccess = false
            install(ContentNegotiation) { json(ApiJson) }
            defaultRequest { url.takeFrom("http://localhost/") }
        }
        return VaultRepository(VaultApi(client), UnconfinedTestDispatcher())
    }

    @Test fun `unlock posts the folder id and password and reports success`() = runTest {
        val repo = vaultRepo(HttpStatusCode.OK, """{"unlocked":true,"has_password":true}""")

        val outcome = repo.unlock("folder-1", "hunter2")

        assertEquals(UnlockOutcome.Unlocked, outcome)
        assertEquals(1, requests.size)
        assertTrue(requests.single().startsWith("POST /vault/unlock"))
        assertTrue(requests.single().contains(""""folder_id":"folder-1""""))
        assertTrue(requests.single().contains(""""password":"hunter2""""))
    }

    @Test fun `a wrong password in the auth envelope is WrongPassword`() = runTest {
        val repo = vaultRepo(HttpStatusCode.Unauthorized, """{"error":"invalid_credentials","message":"Nope"}""")
        assertEquals(UnlockOutcome.WrongPassword, repo.unlock("f", "bad"))
    }

    @Test fun `a wrong password in the generic envelope is WrongPassword`() = runTest {
        val repo = vaultRepo(HttpStatusCode.Unauthorized, """{"statusCode":401,"error":"invalid_credentials","message":"Nope"}""")
        assertEquals(UnlockOutcome.WrongPassword, repo.unlock("f", "bad"))
    }

    @Test fun `an account without a password is NoPassword`() = runTest {
        val repo = vaultRepo(HttpStatusCode.BadRequest, """{"statusCode":400,"error":"no_password","message":"x"}""")
        assertEquals(UnlockOutcome.NoPassword, repo.unlock("f", "x"))
    }

    @Test fun `a folder that is not private is NotPrivate`() = runTest {
        val repo = vaultRepo(HttpStatusCode.NotFound, """{"statusCode":404,"error":"NOT_FOUND","message":"x"}""")
        assertEquals(UnlockOutcome.NotPrivate, repo.unlock("f", "x"))
    }

    @Test fun `server trouble is Failed with a message`() = runTest {
        val repo = vaultRepo(HttpStatusCode.InternalServerError, """{"statusCode":500,"error":"INTERNAL","message":"boom"}""")
        assertTrue(repo.unlock("f", "x") is UnlockOutcome.Failed)
    }

    @Test fun `hasPassword reads the status and is null when it cannot be read`() = runTest {
        assertEquals(false, vaultRepo(HttpStatusCode.OK, """{"unlocked":false,"has_password":false}""").hasPassword())
        assertEquals(null, vaultRepo(HttpStatusCode.InternalServerError, """{"statusCode":500,"error":"E","message":"x"}""").hasPassword())
    }
}
