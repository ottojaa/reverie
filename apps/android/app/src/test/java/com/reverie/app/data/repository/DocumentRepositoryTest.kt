package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentScope
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentRepositoryTest {

    /** Records what the repository asked to purge, and drops those cached rows like the real one. */
    private class FakePurger(private val dao: FakeDocumentDao) : PrivateDataPurger {
        val purged = mutableListOf<String>()
        override suspend fun purgeCachedCopies(ids: Collection<String>) {
            purged += ids
            dao.deleteByIds(ids.toList())
        }
        override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) {}
        override suspend fun forgetMoved(ids: Collection<String>) { purged += ids }
        override suspend fun forgetInFolders(folderIds: Collection<String>) {}
        override suspend fun clearSession() {}
    }

    private fun docJson(
        id: String,
        folder: String?,
        name: String,
        isPrivate: Boolean = false,
        mime: String = "image/jpeg",
        takenAt: String? = null,
    ) = """
        {"id":"$id","folder_id":${folder?.let { "\"$it\"" }},"file_path":"p","file_hash":"h","original_filename":"$name",
         "mime_type":"$mime","taken_at":${takenAt?.let { "\"$it\"" }},"size_bytes":1,"width":null,"height":null,"thumbnail_blurhash":null,
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
        requested: MutableList<String> = mutableListOf(),
        pageBody: () -> String,
    ): DocumentRepository {
        val engine = MockEngine { request ->
            requested += request.url.toString()
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

        val result = repository.refresh(inF1, limit = 30, offset = 0)

        assertEquals(2, result.total)
        assertEquals(2, result.loaded)
        assertEquals(2, repository.observeDocuments(inF1).first().size)
    }

    @Test fun `fetching processing documents asks the server for processing ones and caches them`() = runTest {
        val dao = FakeDocumentDao()
        val requested = mutableListOf<String>()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":7,"limit":60,"offset":0}"""
        val repository = repo(dao, requested = requested) { page }

        val result = repository.fetchProcessing(limit = 60, offset = 0)

        assertEquals(7, result.total)
        assertTrue("processing=true is sent: $requested", requested.single().contains("processing=true"))
        assertEquals(listOf("d1"), repository.observeDocuments(DocumentScope.All).first().map { it.id })
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

        repository.refresh(inF1, limit = 30, offset = 0)

        val remaining = repository.observeDocuments(inF1).first().map { it.id }
        assertEquals(listOf("d1"), remaining)
    }

    @Test fun `a refresh of one kind asks for that kind`() = runTest {
        val requested = mutableListOf<String>()
        val page = """{"items":[],"total":0,"limit":30,"offset":0}"""
        val repository = repo(FakeDocumentDao(), requested = requested) { page }

        repository.refresh(DocumentScope.All, limit = 30, offset = 0, filter = DocumentFilter.VIDEOS)
        repository.refresh(DocumentScope.All, limit = 30, offset = 0)

        assertTrue("kind=video is sent: ${requested[0]}", requested[0].contains("kind=video"))
        assertTrue("no kind is sent when none is asked for: ${requested[1]}", !requested[1].contains("kind="))
    }

    @Test fun `a full-folder refresh of one kind leaves the cached rows of the other kinds alone`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(
            listOf(
                stubEntity("d1", "f1", mime = "image/jpeg"),
                stubEntity("d2", "f1", mime = "IMAGE/PNG"),
                stubEntity("d3", "f1", mime = "video/mp4"),
                stubEntity("d4", "f1", mime = "application/pdf"),
                stubEntity("d5", "f2", mime = "image/jpeg"),
            ),
        )
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao) { page }

        repository.refresh(inF1, limit = 30, offset = 0, filter = DocumentFilter.IMAGES)

        // d2 is a stale image and goes; the video, the file and the other folder's image stay.
        assertEquals(setOf("d1", "d3", "d4", "d5"), dao.rows.value.map { it.id }.toSet())
    }

    @Test fun `a library-wide drop of one kind removes its unread rows in every folder and leaves the other kinds alone`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(
            listOf(
                stubEntity("d1", "f1", mime = "image/jpeg"),
                stubEntity("d2", "f1", mime = "IMAGE/PNG"),
                stubEntity("d3", "f2", mime = "image/jpeg"),
                stubEntity("d4", "f1", mime = "video/mp4"),
                stubEntity("d5", null, mime = "application/pdf"),
            ),
        )
        val repository = repo(dao) { "{}" }

        repository.dropStale(DocumentScope.All, DocumentFilter.IMAGES, keep = setOf("d1"))

        // d2 and d3 are images the server no longer returns; the video and the file are not this read's to judge.
        assertEquals(setOf("d1", "d4", "d5"), dao.rows.value.map { it.id }.toSet())
    }

    @Test fun `a library-wide drop of every kind keeps exactly what the server returned, and handles more rows than one statement takes`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll((1..1200).map { stubEntity("d$it", null, mime = if (it % 2 == 0) "image/jpeg" else "application/pdf") })
        val repository = repo(dao) { "{}" }

        repository.dropStale(DocumentScope.All, DocumentFilter.ALL, keep = setOf("d1", "d2"))

        assertEquals(setOf("d1", "d2"), dao.rows.value.map { it.id }.toSet())
    }

    @Test fun `a refresh of the top level asks for it and drops only its stale rows`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(listOf(stubEntity("d1", null), stubEntity("d2", null), stubEntity("d3", "f1")))
        val requested = mutableListOf<String>()
        val page = """{"items":[${docJson("d1", null, "a.jpg")}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao, requested = requested) { page }

        repository.refresh(DocumentScope.TopLevel, limit = 30, offset = 0)

        assertTrue("top_level is sent: $requested", requested.single().contains("top_level=true"))
        assertEquals(setOf("d1", "d3"), dao.rows.value.map { it.id }.toSet())
        assertEquals(listOf("d1"), repository.observeDocuments(DocumentScope.TopLevel).first().map { it.id })
    }

    @Test fun `a refresh of photos and videos asks for media and leaves the cached files alone`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(
            listOf(
                stubEntity("d1", "f1"),
                stubEntity("d2", "f1", mime = "video/mp4"),
                stubEntity("d3", "f1", mime = "application/pdf"),
            ),
        )
        val requested = mutableListOf<String>()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao, requested = requested) { page }

        repository.refresh(inF1, limit = 30, offset = 0, filter = DocumentFilter.MEDIA)

        assertTrue("media=true is sent: $requested", requested.single().contains("media=true"))
        assertTrue("no kind goes with media: $requested", !requested.single().contains("kind="))
        assertEquals(setOf("d1", "d3"), dao.rows.value.map { it.id }.toSet())
    }

    @Test fun `a refresh page reports the ids it returned`() = runTest {
        val dao = FakeDocumentDao()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")},${docJson("d2", "f1", "b.jpg")}],"total":9,"limit":2,"offset":0}"""
        val repository = repo(dao) { page }

        val result = repository.refresh(DocumentScope.All, limit = 2, offset = 0)

        assertEquals(listOf("d1", "d2"), result.ids)
    }

    @Test fun `a kind refresh that did not cover the folder drops nothing`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(listOf(stubEntity("d1", "f1"), stubEntity("d2", "f1")))
        val page = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":2,"limit":1,"offset":0}"""
        val repository = repo(dao) { page }

        repository.refresh(inF1, limit = 1, offset = 0, filter = DocumentFilter.IMAGES)

        assertEquals(setOf("d1", "d2"), dao.rows.value.map { it.id }.toSet())
    }

    @Test fun `a kind refresh only drops private documents of its own kind`() = runTest {
        val store = PrivateDocumentStore()
        val dao = FakeDocumentDao()
        val seedPage = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)},${docJson("d2", "f1", "b.mp4", isPrivate = true, mime = "video/mp4")}],"total":2,"limit":30,"offset":0}"""
        repo(dao, store) { seedPage }.refresh(inF1, limit = 30, offset = 0)
        val emptyImages = """{"items":[],"total":0,"limit":30,"offset":0}"""

        repo(dao, store) { emptyImages }.refresh(inF1, limit = 30, offset = 0, filter = DocumentFilter.IMAGES)

        assertEquals(setOf("d2"), store.documents.value.keys)
    }

    @Test fun `the date taken is cached, and survives a response that carries none`() = runTest {
        val dao = FakeDocumentDao()
        val withDate = """{"items":[${docJson("d1", "f1", "a.jpg", takenAt = "2026-11-02T09:00:00.000Z")}],"total":1,"limit":30,"offset":0}"""
        val without = """{"items":[${docJson("d1", "f1", "a.jpg")}],"total":1,"limit":30,"offset":0}"""

        repo(dao) { withDate }.refresh(inF1, limit = 30, offset = 0)
        assertEquals("2026-11-02T09:00:00.000Z", dao.rows.value.single().takenAt)

        repo(dao) { without }.refresh(inF1, limit = 30, offset = 0)
        assertEquals("2026-11-02T09:00:00.000Z", dao.rows.value.single().takenAt)
    }

    @Test fun `private documents are served from memory and never reach Room`() = runTest {
        val dao = FakeDocumentDao()
        val store = PrivateDocumentStore()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)},${docJson("d2", "f1", "b.jpg")}],"total":2,"limit":30,"offset":0}"""
        val repository = repo(dao, store) { page }

        repository.refresh(inF1, limit = 30, offset = 0)

        assertEquals(listOf("d2"), dao.rows.value.map { it.id })
        assertEquals(setOf("d1"), store.documents.value.keys)
        // The folder view shows both; a private doc is flagged read-only from its folder.
        val shown = repository.observeDocuments(inF1).first()
        assertEquals(setOf("d1", "d2"), shown.map { it.id }.toSet())
        assertTrue(shown.first { it.id == "d1" }.is_private)
    }

    @Test fun `a document that turns private has its cached copy purged`() = runTest {
        val dao = FakeDocumentDao()
        dao.upsertAll(listOf(stubEntity("d1", "f1")))
        val purger = FakePurger(dao)
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)}],"total":1,"limit":30,"offset":0}"""
        val repository = repo(dao, purger = purger) { page }

        repository.refresh(inF1, limit = 30, offset = 0)

        assertEquals(listOf("d1"), purger.purged)
        assertTrue(dao.rows.value.isEmpty())
    }

    private val summaryJson =
        """{"image":{"count":38,"bytes":210},"video":{"count":19,"bytes":1400},"file":{"count":191,"bytes":2900,"top_types":[{"ext":"apk","count":120},{"ext":"zip","count":31}]}}"""

    @Test fun `a fetched summary is kept in memory per scope and asked for with its folder`() = runTest {
        val requested = mutableListOf<String>()
        val repository = repo(FakeDocumentDao(), requested = requested) { summaryJson }

        assertEquals(null, repository.summary(inF1).first())
        val fetched = repository.fetchSummary(inF1)

        assertEquals(38, fetched.image.count)
        assertEquals(listOf("apk", "zip"), fetched.file.top_types.map { it.ext })
        assertTrue("folder_id is sent: $requested", requested.single().contains("documents/summary") && requested.single().contains("folder_id=f1"))
        assertEquals(fetched, repository.summary(inF1).first())
        assertEquals("another scope has no summary yet", null, repository.summary(DocumentScope.All).first())
    }

    @Test fun `a failed summary read keeps the last summary and counts no cached rows`() = runTest {
        val dao = FakeDocumentDao()
        var body = summaryJson
        var ok = true
        val repository = repo(dao) { if (!ok) error("offline") else body }
        repository.fetchSummary(DocumentScope.All)
        ok = false

        val failed = runCatching { repository.fetchSummary(DocumentScope.All) }

        assertTrue(failed.isFailure)
        assertEquals(191, repository.summary(DocumentScope.All).first()?.file?.count)
    }

    @Test fun `a delete tells the browse screens that content changed`() = runTest {
        val repository = repo(FakeDocumentDao()) { "{}" }
        val heard = backgroundScope.async(UnconfinedTestDispatcher(testScheduler)) { repository.contentChanges.first() }
        testScheduler.runCurrent()

        val deleted = runCatching { repository.delete(listOf("d1")) }

        assertTrue("delete failed: ${deleted.exceptionOrNull()}", deleted.isSuccess)
        assertEquals(Unit, heard.await())
    }

    @Test fun `all documents never include private ones`() = runTest {
        val dao = FakeDocumentDao()
        val page = """{"items":[${docJson("d1", "f1", "a.jpg", isPrivate = true)},${docJson("d2", "f2", "b.jpg")}],"total":2,"limit":30,"offset":0}"""
        val repository = repo(dao) { page }

        repository.refresh(DocumentScope.All, limit = 30, offset = 0)

        assertEquals(listOf("d2"), repository.observeDocuments(DocumentScope.All).first().map { it.id })
    }

    private val inF1 = DocumentScope.Folder("f1")

    private fun stubEntity(id: String, folder: String?, mime: String = "image/jpeg", takenAt: String? = null) = DocumentEntity(
        id = id, folderId = folder, originalFilename = "$id.jpg", mimeType = mime, sizeBytes = 1,
        width = null, height = null, durationSeconds = null, thumbnailBlurhash = null, documentCategory = "photo", extractedDate = null,
        ocrStatus = "COMPLETE", thumbnailStatus = "COMPLETE", llmStatus = "COMPLETE", llmSummary = null,
        llmMetadataJson = null, llmProcessedAt = null, llmTokenCount = null, photoMetadataJson = null, takenAt = takenAt,
        createdAt = "2024-01-01T00:00:00.000Z", updatedAt = "2024-01-01T00:00:00.000Z",
        cachedAt = 0, lastAccessedAt = 0,
    )
}
