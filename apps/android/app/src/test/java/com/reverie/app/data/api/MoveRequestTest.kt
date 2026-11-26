package com.reverie.app.data.api

import com.reverie.app.data.api.model.ConflictStrategy
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** A move to the top level is a null the server has to receive, though other nulls are left out of requests. */
class MoveRequestTest {

    private val sent = mutableListOf<String>()

    private val client = HttpClient(MockEngine { request ->
        sent += request.body.toByteArray().decodeToString()
        respond(FOLDER, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    @Test fun `moving a folder to the top level sends a null parent`() = runBlocking {
        FoldersApi(client).move("f", parentId = null)
        FoldersApi(client).move("f", parentId = "p")

        assertEquals(listOf("""{"parent_id":null}""", """{"parent_id":"p"}"""), sent)
    }

    @Test fun `moving documents to the top level sends a null folder`() = runBlocking {
        DocumentsApi(client).move(listOf("d"), folderId = null, conflict = null)
        DocumentsApi(client).move(listOf("d"), folderId = "p", conflict = ConflictStrategy.REPLACE)

        assertEquals(
            listOf(
                """{"document_ids":["d"],"folder_id":null}""",
                """{"document_ids":["d"],"folder_id":"p","conflict_strategy":"replace"}""",
            ),
            sent,
        )
    }

    private companion object {
        const val FOLDER = """{"id":"f","parent_id":null,"name":"f","path":"/f","description":null,"emoji":null,
            "sort_order":0,"is_private":false,"created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}"""
    }
}
