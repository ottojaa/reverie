package com.reverie.app.data.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** The server says how long to wait in a header, which has to reach whoever gets the error. */
class RetryAfterTest {
    private fun refusal(body: String, retryAfter: String?) = runBlocking {
        val headers = retryAfter?.let { headersOf(HttpHeaders.RetryAfter, it) } ?: headersOf()
        val client = HttpClient(MockEngine { respond(body, HttpStatusCode.TooManyRequests, headers) }) { expectSuccess = false }
        runCatching { client.get("http://localhost/upload").decode<String>() }.exceptionOrNull() as ReverieApiException.Http
    }

    @Test fun `the server's refusal carries its Retry-After`() {
        val error = refusal("""{"statusCode":429,"error":"TOO_MANY_REQUESTS","message":"Rate limit exceeded"}""", "900")

        assertEquals(429, error.statusCode)
        assertEquals(900L, error.retryAfterSeconds)
    }

    @Test fun `a refusal that isn't the server's own JSON carries it too`() {
        assertEquals(30L, refusal("<html>slow down</html>", "30").retryAfterSeconds)
    }

    @Test fun `no header, or one that isn't a number of seconds, is no time`() {
        assertEquals(null, refusal("{}", null).retryAfterSeconds)
        assertEquals(null, refusal("{}", "Wed, 21 Oct 2026 07:28:00 GMT").retryAfterSeconds)
    }
}
