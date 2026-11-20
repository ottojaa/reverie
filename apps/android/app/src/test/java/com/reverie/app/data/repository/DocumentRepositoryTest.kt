package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.PrivateDocumentStore
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
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        override suspend fun existingIds(ids: List<String>): List<String> =
            rows.value.map { it.id }.filter { it in ids }
        override suspend fun idsOutsideFolders(publicFolderIds: List<String>): List<String> =
            rows.value.filter { it.folderId != null && it.folderId !in publicFolderIds }.map { it.id }
        override suspend fun touchLastAccessed(id: String, timestamp: Long) {}
        override suspend fun clear() { rows.value = emptyList() }
    }

    /** Records what the repository asked to purge, and drops those cached rows like the real one. */
    private class FakePurger(private val dao: FakeDocumentDao) : PrivateDataPurger {
        val purged = mutableListOf<String>()
        override suspend fun purgeCachedCopies(ids: Collection<String>) {
            purged += ids
            dao.deleteByIds(ids.toList())
        }
        override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) {}
        override suspend fun forgetMoved(ids: Collection<String>) { purged += ids }
        override suspend fun clearSession() {}
    }

    private fun docJson(id: String, folder: String, name: String, isPrivate: Boolean = false) = """
        {"id":"$id","folder_id":"$folder","file_path":"p","file_hash":"h","original_filename":"$name",
         "mime_type":"image/jpeg","size_bytes":1,"width":null,"height":null,"thumbnail_blurhash":null,
         "thumbnail_paths":null,"document_category":"photo","extracted_date":null,"ocr_status":"complete",
         "thumbnail_status":"complete","llm_status":"complete","llm_summary":null,"llm_metadata":null,
         "llm_processed_at":null,"llm_token_count":null,"is_private":$isPrivate,
         "created_at":"2024-01-0${id.last()}T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z",
         "file_url":null,"thumbnail_urls":null}
    """.trimIndent()

    // The dispatcher shares runTest's scheduler: the merged folder flow runs on it.
    private fun TestScope.repo(
        dao: FakeDocumentDao,
        store: PrivateDocumentStore = PrivateDocumentStore(),
        purger: FakePurger = FakePurger(dao),
        pageBody: () -> String,
    ): DocumentRepository {
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
        return DocumentRepository(dao, DocumentsApi(client), store, purger, UnconfinedTestDispatcher(testScheduler))
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

    @Test fun `private documents are served from memory and never reach Room`() = runTest {
        val dao = FakeDocumentDao()
        val store = PrivateDocumentStore()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)},${docJson("d2", "f1", "b.jpg")}],"total":2,"limit":30,"offset":0}"""
        val repository = repo(dao, store) { page }

        repository.refresh(folderId = "f1", limit = 30, offset = 0)

        assertEquals(listOf("d2"), dao.rows.value.map { it.id })
        assertEquals(setOf("d1"), store.documents.value.keys)
        // The folder view shows both; a private doc is flagged read-only from its folder.
        val shown = repository.observeDocuments("f1").first()
        assertEquals(setOf("d1", "d2"), shown.map { it.id }.toSet())
        assertTrue(shown.first { it.id == "d1" }.is_private)
    }

    @Test fun `a document that turns private has its cached copy purged`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(listOf(stubEntity("d1", "f1")))
        val purger = FakePurger(dao)
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao, purger = purger) { page }

        repository.refresh(folderId = "f1", limit = 30, offset = 0)

        assertEquals(listOf("d1"), purger.purged)
        assertTrue(dao.rows.value.isEmpty())
    }

    @Test fun `all documents never include private ones`() = runTest {
        val dao = FakeDocumentDao()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)},${docJson("d2", "f2", "b.jpg")}],"total":2,"limit":30,"offset":0}"""
        val repository = repo(dao) { page }

        repository.refresh(folderId = null, limit = 30, offset = 0)

        assertEquals(listOf("d2"), repository.observeDocuments(null).first().map { it.id })
    }

    private fun stubEntity(id: String, folder: String) = DocumentEntity(
        id = id, folderId = folder, originalFilename = "$id.jpg", mimeType = "image/jpeg", sizeBytes = 1,
        width = null, height = null, durationSeconds = null, thumbnailBlurhash = null, documentCategory = "photo", extractedDate = null,
        ocrStatus = "COMPLETE", thumbnailStatus = "COMPLETE", llmStatus = "COMPLETE", llmSummary = null,
        llmMetadataJson = null, llmProcessedAt = null, llmTokenCount = null, photoMetadataJson = null,
        createdAt = "2024-01-01T00:00:00.000Z", updatedAt = "2024-01-01T00:00:00.000Z",
        cachedAt = 0, lastAccessedAt = 0,
    )
}
