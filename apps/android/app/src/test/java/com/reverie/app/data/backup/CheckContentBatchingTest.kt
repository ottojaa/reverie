package com.reverie.app.data.backup

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentRequest
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.repository.checkContentInBatches
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** The server accepts at most 500 files per check-content call; more must be split, in order. */
class CheckContentBatchingTest {

    private val requestSizes = mutableListOf<Int>()
    private val requests = mutableListOf<CheckContentRequest>()

    /** Answers every file in the request with a result named after it, so order can be checked. */
    private fun api(): DocumentsApi {
        val engine = MockEngine { request ->
            val body = ApiJson.decodeFromString(CheckContentRequest.serializer(), request.body.toByteArray().decodeToString())
            requestSizes += body.files.size
            requests += body
            val results = body.files.joinToString(",") { """{"name":"${it.name}","sha256":"${it.sha256}"}""" }
            respond(
                content = """{"results":[$results]}""",
                status = HttpStatusCode.OK,
                headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
            )
        }
        val client = HttpClient(engine) {
            install(ContentNegotiation) { json(ApiJson) }
            defaultRequest { url.takeFrom("http://localhost/") }
        }
        return DocumentsApi(client)
    }

    private fun files(count: Int) = List(count) { CheckContentFile("f$it.jpg", "hash$it") }

    @Test fun `exactly 500 files go in one call`() = runTest {
        val results = api().checkContentInBatches(DocumentScope.All, files(500))

        assertEquals(listOf(500), requestSizes)
        assertEquals(500, results.size)
    }

    @Test fun `501 files are split into two calls and answered in order`() = runTest {
        val results = api().checkContentInBatches(DocumentScope.All, files(501))

        assertEquals(listOf(500, 1), requestSizes)
        assertEquals(List(501) { "f$it.jpg" }, results.map { it.name })
    }

    @Test fun `each call says where the files are headed`() = runTest {
        val api = api()

        api.checkContentInBatches(DocumentScope.All, files(1))
        api.checkContentInBatches(DocumentScope.TopLevel, files(1))
        api.checkContentInBatches(DocumentScope.Folder("f1"), files(1))

        assertEquals(listOf(null, null, "f1"), requests.map { it.folder_id })
        assertEquals(listOf(null, true, null), requests.map { it.top_level })
    }

    @Test fun `no files make no call`() = runTest {
        val results = api().checkContentInBatches(DocumentScope.All, emptyList())

        assertEquals(emptyList<Int>(), requestSizes)
        assertEquals(0, results.size)
    }
}
