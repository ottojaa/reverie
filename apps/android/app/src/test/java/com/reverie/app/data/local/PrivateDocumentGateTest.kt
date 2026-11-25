package com.reverie.app.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import coil.ImageLoader
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.image.ThumbnailCachePurger
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.toPublicFolderIds
import com.reverie.app.data.settings.SettingsRepository
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What may be written to disk, with folders nested three levels deep. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PrivateDocumentGateTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).build()
    private val store = PrivateDocumentStore()

    /** What the server answers the next tree request with. */
    private var tree: List<FolderWithChildren> = emptyList()

    private val client = HttpClient(MockEngine {
        val body = ApiJson.encodeToString(ListSerializer(FolderWithChildren.serializer()), tree)
        respond(body, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    private val folders by lazy {
        val settings = SettingsRepository(context)
        val serverUrl = ServerUrlProvider(settings, scope)
        val files = FileCacheManager(
            context, client, serverUrl, DocumentsApi(client), database.cachedFileDao(), settings, Dispatchers.Unconfined,
        )
        val thumbnails = ThumbnailCachePurger({ ImageLoader(context) }, serverUrl)
        val purger = DiskPrivateDataPurger(database.documentDao(), store, files, thumbnails, Dispatchers.Unconfined)
        FolderRepository(database.folderDao(), FoldersApi(client), purger, Dispatchers.Unconfined)
    }

    @After fun tearDown() {
        scope.cancel()
        database.close()
    }

    private fun doc(id: String, folderId: String? = null, isPrivate: Boolean = false) = DocumentDto(
        id = id, folder_id = folderId, file_path = "/$id", file_hash = id, original_filename = "$id.jpg",
        mime_type = "image/jpeg", size_bytes = 1, ocr_status = JobStatus.COMPLETE,
        thumbnail_status = JobStatus.COMPLETE, llm_status = JobStatus.COMPLETE, is_private = isPrivate,
        created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
    )

    private fun folder(
        id: String,
        parent: String? = null,
        isPrivate: Boolean = false,
        lockId: String? = id.takeIf { isPrivate },
        locked: Boolean = false,
        children: List<FolderWithChildren> = emptyList(),
    ) = FolderWithChildren(
        id = id, parent_id = parent, name = id, path = "/$id", description = null, emoji = null, sort_order = 0,
        is_private = isPrivate, lock_id = lockId, locked = locked,
        created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z", children = children,
    )

    /** `top > middle > bottom`, the middle one private (and with it the bottom one) when [private]. */
    private fun chain(private: Boolean): List<FolderWithChildren> {
        val lock = "middle".takeIf { private }
        val bottom = folder("bottom", parent = "middle", lockId = lock)
        val middle = folder("middle", parent = "top", isPrivate = private, children = listOf(bottom))
        return listOf(folder("top", children = listOf(middle)))
    }

    private suspend fun cache(vararg documents: DocumentDto) =
        database.documentDao().upsertAll(documents.toList().toCacheableEntities(now = 1))

    private suspend fun cachedIds() = database.documentDao().allMimeTypes().map { it.id }.sorted()

    @Test fun `a private document never becomes a Room row`() {
        assertNull(doc("p", isPrivate = true).toEntityOrNull(now = 1))
        assertNotNull(doc("a").toEntityOrNull(now = 1))
    }

    @Test fun `only public documents of a page are cacheable`() {
        val page = listOf(doc("a"), doc("p1", isPrivate = true), doc("b"), doc("p2", isPrivate = true))

        assertEquals(listOf("a", "b"), page.toCacheableEntities(now = 1).map { it.id })
    }

    @Test fun `the document read back from Room is never private`() {
        val entity = doc("a").toEntityOrNull(now = 1)!!
        assertEquals(false, entity.toDto().is_private)
    }

    @Test fun `a folder is public unless it, or any folder above it, is private`() {
        val deep = folder("deep", parent = "inside", lockId = "secret")
        val inside = folder("inside", parent = "secret", lockId = "secret", children = listOf(deep))
        val secret = folder("secret", parent = "open", isPrivate = true, children = listOf(inside))
        val plain = folder("plain", parent = "open")
        val rows = listOf(folder("open", children = listOf(plain, secret))).flattenToEntities(now = 1)

        assertEquals(listOf("open", "plain"), rows.toPublicFolderIds())
    }

    @Test fun `folder rows keep the lock flags the tree needs`() {
        val node = folder("f", isPrivate = true, locked = true)

        val row = listOf(node).flattenToEntities(now = 1).single()

        assertEquals(true, row.isPrivate)
        assertEquals(true, row.locked)
        assertEquals("f", row.lockId)
    }

    @Test fun `a folder going private purges what was cached anywhere beneath it`() = runBlocking {
        tree = chain(private = false)
        folders.refresh()
        cache(doc("loose"), doc("high", "top"), doc("mid", "middle"), doc("low", "bottom"))

        tree = chain(private = true)
        folders.refresh()

        assertEquals(listOf("high", "loose"), cachedIds())
    }

    @Test fun `a folder that locks, and so lists no children, takes their cached documents with it`() = runBlocking {
        tree = chain(private = false)
        folders.refresh()
        cache(doc("high", "top"), doc("low", "bottom"))

        tree = listOf(folder("top", children = listOf(folder("middle", parent = "top", isPrivate = true, locked = true))))
        folders.refresh()

        assertEquals(listOf("high"), cachedIds())
    }

    @Test fun `trashing a folder drops it and everything beneath it from the device`() = runBlocking {
        tree = chain(private = false)
        folders.refresh()
        cache(doc("loose"), doc("high", "top"), doc("mid", "middle"), doc("low", "bottom"))
        store.putAll(listOf(doc("held", "bottom", isPrivate = true)))

        tree = listOf(folder("top"))
        folders.delete("middle")

        assertEquals(listOf("high", "loose"), cachedIds())
        assertEquals(emptySet<String>(), store.documents.value.keys)
    }
}
