package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.local.entity.FolderEntity
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
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderRepositoryCoversTest {

    private fun node(id: String, name: String, isPrivate: Boolean, parent: String?, cover: String, children: String = "[]") = """
        {"id":"$id","parent_id":${parent?.let { "\"$it\"" }},"name":"$name","path":"/$name","description":null,"emoji":null,
         "sort_order":0,"is_private":$isPrivate,"locked":false,"created_at":"2024-01-01T00:00:00.000Z",
         "updated_at":"2024-01-01T00:00:00.000Z","children":$children,"cover":$cover}
    """.trimIndent()

    private fun cover(docId: String, filename: String) = """
        {"tiles":[{"document_id":"$docId","mime_type":"application/pdf","original_filename":"$filename","thumbnail_blurhash":"LEHV6nWB2yk8pyo0adR*.7kCMdnj"}],
         "summary":{"image":{"count":0,"bytes":0},"video":{"count":0,"bytes":0},"file":{"count":1,"bytes":10,"top_types":[{"ext":"pdf","count":1}]}}}
    """.trimIndent()

    private val publicFolder = node("f-open", "Receipts", false, "c1", cover("doc-open", "receipt.pdf"))
    private val privateFolder = node("f-secret", "Taxes", true, "c1", cover("doc-secret", "secret-tax-return.pdf"))
    private val finance = node("c1", "Finance", false, null, "null", "[$publicFolder,$privateFolder]")

    private fun TestScope.repo(dao: FakeFolderDao, status: () -> HttpStatusCode, body: () -> String): FolderRepository {
        val engine = MockEngine {
            respond(
                content = body(),
                status = status(),
                headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
            )
        }
        val client = HttpClient(engine) {
            expectSuccess = false
            install(ContentNegotiation) { json(ApiJson) }
            defaultRequest { url.takeFrom("http://localhost/") }
        }
        return FolderRepository(dao, FoldersApi(client), NoopPurger, UnconfinedTestDispatcher(testScheduler))
    }

    @Test fun `a refresh keeps each folder's cover in memory, none for a folder sent without one`() = runTest {
        val repository = repo(FakeFolderDao(), { HttpStatusCode.OK }) { "[$finance]" }

        repository.refresh()

        assertEquals(setOf("f-open", "f-secret"), repository.covers.value.keys)
        assertEquals("doc-open", repository.covers.value.getValue("f-open").tiles.single().document_id)
        assertNull(repository.covers.value["c1"])
    }

    @Test fun `a private folder's cover never reaches Room`() = runTest {
        val dao = FakeFolderDao()
        val repository = repo(dao, { HttpStatusCode.OK }) { "[$finance]" }

        repository.refresh()

        // The private folder's row is cached (so offline the tree still lists it) ...
        assertNotNull(dao.rows.value.firstOrNull { it.id == "f-secret" })
        // ... but nothing about its documents is: no filename, document id or blurhash in any row.
        val persisted = dao.rows.value.joinToString { it.toString() }
        listOf("secret-tax-return.pdf", "doc-secret", "doc-open", "LEHV6nWB2yk8pyo0adR").forEach {
            assertFalse("Room row mentions $it", persisted.contains(it))
        }
        assertTrue(FolderEntity::class.java.declaredFields.none { it.name.contains("cover", ignoreCase = true) })
    }

    @Test fun `a failed refresh keeps the last covers so offline still shows them`() = runTest {
        var online = true
        val repository = repo(FakeFolderDao(), { if (online) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable }) { if (online) "[$finance]" else "{}" }
        repository.refresh()

        online = false
        runCatching { repository.refresh() }

        assertEquals(setOf("f-open", "f-secret"), repository.covers.value.keys)
    }

    @Test fun `a refresh replaces the covers, so a folder that locked or went private drops out`() = runTest {
        var tree = "[$finance]"
        val repository = repo(FakeFolderDao(), { HttpStatusCode.OK }) { tree }
        repository.refresh()

        val lockedFinance = node("c1", "Finance", true, null, "null", "[]")
        tree = "[$lockedFinance]"
        repository.refresh()

        assertTrue(repository.covers.value.isEmpty())
    }

    @Test fun `logout clears the covers`() = runTest {
        val repository = repo(FakeFolderDao(), { HttpStatusCode.OK }) { "[$finance]" }
        repository.refresh()

        repository.clearCovers()

        assertTrue(repository.covers.value.isEmpty())
    }

    @Test fun `a tree from a server without covers still loads`() {
        val old = """{"id":"f","parent_id":null,"name":"f","path":"/f","description":null,"emoji":null,"sort_order":0,
            "is_private":false,"created_at":"2024-01-01T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z","children":[]}"""

        val parsed = ApiJson.decodeFromString(com.reverie.app.data.api.model.FolderWithChildren.serializer(), old)

        assertNull(parsed.cover)
    }
}
