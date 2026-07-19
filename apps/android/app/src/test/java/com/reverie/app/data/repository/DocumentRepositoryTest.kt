package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.entity.DocumentEntity
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class DocumentRepositoryTest {

    private class FakeDocumentDao : DocumentDao {
        val rows = MutableStateFlow<List<DocumentEntity>>(emptyList())
        override fun observeAll(): Flow<List<DocumentEntity>> =
            rows.map { list -> list.sortedByDescending { it.createdAt } }
        override fun observeByFolder(folderId: String): Flow<List<DocumentEntity>> =
            rows.map { list -> list.filter { it.folderId == folderId } }
        override fun observeById(id: String): Flow<DocumentEntity?> =
            rows.map { list -> list.firstOrNull { it.id == id } }
        override suspend fun getById(id: String): DocumentEntity? = rows.value.firstOrNull { it.id == id }
        override suspend fun upsertAll(documents: List<DocumentEntity>) {
            val map = rows.value.associateBy { it.id }.toMutableMap()
            documents.forEach { map[it.id] = it }
            rows.value = map.values.toList()
        }
        override suspend fun deleteByIds(ids: List<String>) { rows.value = rows.value.filterNot { it.id in ids } }
        override suspend fun deleteInFolderNotIn(folderId: String, keepIds: List<String>) {
            rows.value = rows.value.filterNot { it.folderId == folderId && it.id !in keepIds }
        }
        override suspend fun setPrivacy(ids: List<String>, isPrivate: Boolean) {
            rows.value = rows.value.map { if (it.id in ids) it.copy(isPrivate = isPrivate) else it }
        }
        override suspend fun touchLastAccessed(id: String, timestamp: Long) {}
        override suspend fun clear() { rows.value = emptyList() }
    }

    private fun docJson(id: String, folder: String, name: String) = """
        {"id":"$id","folder_id":"$folder","file_path":"p","file_hash":"h","original_filename":"$name",
         "mime_type":"image/jpeg","size_bytes":1,"width":null,"height":null,"thumbnail_blurhash":null,
         "thumbnail_paths":null,"document_category":"photo","extracted_date":null,"ocr_status":"complete",
         "thumbnail_status":"complete","llm_status":"complete","llm_summary":null,"llm_metadata":null,
         "llm_processed_at":null,"llm_token_count":null,"is_private":false,
         "created_at":"2024-01-0${id.last()}T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z",
         "file_url":null,"thumbnail_urls":null}
    """.trimIndent()

    private fun repo(dao: DocumentDao, pageBody: () -> String): DocumentRepository {
        val engine = MockEngine {
            respond(
                content = pageBody(),
                status = HttpStatusCode.OK,
                headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
            )
        }
        val client = HttpClient(engine) {
            expectSuccess = false
            install(ContentNegotiation) { json(ApiJson) }
            defaultRequest { url.takeFrom("http://localhost/") }
        }
        return DocumentRepository(dao, DocumentsApi(client), UnconfinedTestDispatcher())
    }

    @Test fun `refresh caches the page and observe emits it`() = runTest {
        val dao = FakeDocumentDao()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")},${docJson("d2", "f1", "b.jpg")}],"total":2,"limit":30,"offset":0}"""
        val repository = repo(dao) { page }

        val result = repository.refresh(folderId = "f1", limit = 30, offset = 0)

        assertEquals(2, result.total)
        assertEquals(2, result.loaded)
        assertEquals(2, repository.observeDocuments("f1").first().size)
    }

    @Test fun `a full-folder refresh reconciles away stale rows`() = runTest {
        val dao = FakeDocumentDao()
        // Pre-seed two cached docs; the server now only returns one.
        dao.upsertAll(
            listOf(
                stubEntity("d1", "f1"),
                stubEntity("d2", "f1"),
            ),
        )
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao) { page }

        repository.refresh(folderId = "f1", limit = 30, offset = 0)

        val remaining = repository.observeDocuments("f1").first().map { it.id }
        assertEquals(listOf("d1"), remaining)
    }

    private fun stubEntity(id: String, folder: String) = DocumentEntity(
        id = id, folderId = folder, originalFilename = "$id.jpg", mimeType = "image/jpeg", sizeBytes = 1,
        width = null, height = null, durationSeconds = null, thumbnailBlurhash = null, documentCategory = "photo", extractedDate = null,
        ocrStatus = "COMPLETE", thumbnailStatus = "COMPLETE", llmStatus = "COMPLETE", llmSummary = null,
        llmMetadataJson = null, llmProcessedAt = null, llmTokenCount = null, photoMetadataJson = null,
        isPrivate = false, createdAt = "2024-01-01T00:00:00.000Z", updatedAt = "2024-01-01T00:00:00.000Z",
        cachedAt = 0, lastAccessedAt = 0,
    )
}
