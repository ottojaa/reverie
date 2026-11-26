package com.reverie.app.data.repository

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.model.FolderWithChildren
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Many screens ask for the tree at once: a rename or an upload tells every open folder page. */
class FolderRepositoryRefreshTest {

    private val requests = AtomicInteger()
    private val firstAnswer = CompletableDeferred<Unit>()

    /** The folder's name on the server when a request arrives. */
    @Volatile private var name = "Before"
    @Volatile private var firstStatus = HttpStatusCode.OK

    private val client = HttpClient(MockEngine {
        val number = requests.incrementAndGet()
        // Taken on arrival: a slow answer carries what the server knew when it was asked.
        val body = tree(name)
        if (number == 1) firstAnswer.await()
        val status = if (number == 1) firstStatus else HttpStatusCode.OK
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    private val dao = FakeFolderDao()
    private val repository = FolderRepository(dao, FoldersApi(client), NoopPurger, Dispatchers.Unconfined)

    private fun tree(name: String) = ApiJson.encodeToString(
        ListSerializer(FolderWithChildren.serializer()),
        listOf(
            FolderWithChildren(
                id = "f", parent_id = null, name = name, path = "/$name", description = null, emoji = null, sort_order = 0,
                is_private = false, created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
            ),
        ),
    )

    private suspend fun awaitFirstRequest() {
        while (requests.get() < 1) delay(5)
    }

    @Test fun `calls made while the tree is being fetched share one more fetch`() = runBlocking {
        val first = launch(start = CoroutineStart.UNDISPATCHED) { repository.refresh() }
        awaitFirstRequest()
        val later = List(4) { launch(start = CoroutineStart.UNDISPATCHED) { repository.refresh() } }

        firstAnswer.complete(Unit)
        (later + first).joinAll()

        assertEquals(2, requests.get())
    }

    @Test fun `a slow older answer never replaces a newer tree`() = runBlocking {
        val first = launch(start = CoroutineStart.UNDISPATCHED) { repository.refresh() }
        awaitFirstRequest()
        name = "After"
        val second = launch(start = CoroutineStart.UNDISPATCHED) { repository.refresh() }
        withTimeoutOrNull(500) { second.join() }

        firstAnswer.complete(Unit)
        joinAll(first, second)

        assertEquals("After", dao.rows.value.single().name)
    }

    @Test fun `a call waiting behind a fetch that fails still gets the tree`() = runBlocking {
        firstStatus = HttpStatusCode.ServiceUnavailable
        val first = launch(start = CoroutineStart.UNDISPATCHED) { runCatching { repository.refresh() } }
        awaitFirstRequest()
        val second = launch(start = CoroutineStart.UNDISPATCHED) { repository.refresh() }

        firstAnswer.complete(Unit)
        joinAll(first, second)

        assertEquals("Before", dao.rows.value.single().name)
    }
}
