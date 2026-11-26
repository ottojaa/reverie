package com.reverie.app.ui.screens.favourites

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.FavouritesApi
import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.VaultApi
import com.reverie.app.data.api.model.CheckDuplicatesResponse
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.api.model.FavouriteListResponse
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FakeDocumentDao
import com.reverie.app.data.repository.FakeFolderDao
import com.reverie.app.data.repository.FavouritesRepository
import com.reverie.app.data.repository.FolderRepository
import com.reverie.app.data.repository.NoopPurger
import com.reverie.app.data.repository.VaultRepository
import com.reverie.app.domain.FolderTree
import com.reverie.app.ui.screens.viewer.DocumentSequenceHolder
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.content.TextContent
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.serialization.builtins.ListSerializer

/** A server answering the favourites, vault, folder and document calls, with the real repositories on top. */
internal class FavouriteWorld {
    /** What GET /favourites answers. */
    @Volatile var items: List<FavouriteDto> = emptyList()

    @Volatile var tree: List<FolderWithChildren> = emptyList()

    /** What GET /documents/{id} answers with. */
    @Volatile var served: List<DocumentDto> = emptyList()

    /** What the document listing answers with: all of it on one page, narrowed to the folder and kinds asked for. */
    @Volatile var listed: List<DocumentDto> = emptyList()

    /** While set, a PUT waits for it before it is answered. */
    @Volatile var putGate: CompletableDeferred<Unit>? = null

    /** While set, GET /favourites waits for it before it is answered. */
    @Volatile var listGate: CompletableDeferred<Unit>? = null

    @Volatile var isOffline = false

    /** Answers for the next PUTs, in order; after they run out a PUT succeeds. */
    val putFailures = ArrayDeque<Pair<HttpStatusCode, String>>()

    /** Answers for the next folder writes and document moves, in order, null for success; then all succeed. */
    val writeAnswers = ArrayDeque<Pair<HttpStatusCode, String>?>()

    /** The names POST /documents/check-duplicates reports as taken. */
    @Volatile var takenNames: List<String> = emptyList()

    /** What GET /vault/status says about the account. */
    @Volatile var hasPassword = true

    val requests = CopyOnWriteArrayList<String>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val client = HttpClient(MockEngine { answer(it) }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    val documentDao = FakeDocumentDao()
    val folderDao = FakeFolderDao()
    val vault = VaultRepository(VaultApi(client), Dispatchers.Unconfined)
    val documents = DocumentRepository(documentDao, DocumentsApi(client), PrivateDocumentStore(), NoopPurger, Dispatchers.Unconfined)
    val favourites = FavouritesRepository(FavouritesApi(client), vault, documents, scope)
    val sequences = DocumentSequenceHolder()
    val folders = FolderRepository(folderDao, FoldersApi(client), NoopPurger, Dispatchers.Unconfined)
    val deps = FavouriteDeps(favourites, vault, documents, folders, sequences)

    fun controller() = FavouriteController(deps, scope)

    /** Wait until the server has been asked [count] times for [request]. */
    suspend fun awaitRequests(request: String, count: Int) {
        while (requests.count { it == request } < count) delay(5)
    }

    private suspend fun MockRequestHandleScope.answer(request: HttpRequestData): HttpResponseData {
        val path = request.url.encodedPath.removePrefix("/")
        val body = (request.body as? TextContent)?.text.orEmpty()
        requests += "${request.method.value} $path $body".trim()
        if (isOffline) throw IOException("offline")
        val document = served.firstOrNull { path == "documents/${it.id}" && request.method == HttpMethod.Get }
        if (document != null) return reply(ApiJson.encodeToString(DocumentDto.serializer(), document))
        return when {
            path == "documents" && request.method == HttpMethod.Get && listed.isNotEmpty() -> replyListing(request)
            path == "favourites" -> {
                // Taken before the wait: a slow answer carries what the server knew when asked.
                val asked = items
                listGate?.await()
                reply(ApiJson.encodeToString(FavouriteListResponse.serializer(), FavouriteListResponse(asked)))
            }
            path.startsWith("favourites/") -> {
                putGate?.await()
                val failure = putFailures.removeFirstOrNull()
                if (failure == null) reply("", HttpStatusCode.NoContent) else reply(failure.second, failure.first)
            }
            path == "vault/unlock" -> reply("""{"unlocked":true,"has_password":true}""")
            path == "folders" && request.method == HttpMethod.Post -> replyCreated(body)
            path == "folders/tree" -> reply(ApiJson.encodeToString(ListSerializer(FolderWithChildren.serializer()), tree))
            path == "vault/status" -> reply("""{"unlocked":false,"has_password":$hasPassword}""")
            path == "documents/check-duplicates" ->
                reply(ApiJson.encodeToString(CheckDuplicatesResponse.serializer(), CheckDuplicatesResponse(takenNames)))
            path == "documents/move" || path.startsWith("folders/") -> replyWrite(path)
            else -> reply("", HttpStatusCode.NoContent)
        }
    }

    /** The next of [writeAnswers]; a write that succeeds on a folder answers with the folder. */
    private fun MockRequestHandleScope.replyWrite(path: String): HttpResponseData {
        val failure = writeAnswers.removeFirstOrNull()
        if (failure != null) return reply(failure.second, failure.first)
        val id = path.removePrefix("folders/").takeIf { path.startsWith("folders/") }
        val node = id?.let { FolderTree(tree).find(it) } ?: return reply("", HttpStatusCode.NoContent)
        return reply(ApiJson.encodeToString(FolderDto.serializer(), node.toFolder()))
    }

    private fun FolderWithChildren.toFolder() = FolderDto(
        id = id, parent_id = parent_id, name = name, path = path, sort_order = sort_order,
        is_private = is_private, created_at = created_at, updated_at = updated_at,
    )

    /** Adds the asked-for folder to [tree], under its parent, and answers with it. */
    private fun MockRequestHandleScope.replyCreated(body: String): HttpResponseData {
        val asked = ApiJson.decodeFromString(CreateFolderRequest.serializer(), body)
        val node = FolderWithChildren(
            id = "new-${asked.name}", parent_id = asked.parent_id, name = asked.name, path = "/${asked.name}",
            sort_order = 0, is_private = false, created_at = "2026-11-25T00:00:00Z", updated_at = "2026-11-25T00:00:00Z",
        )
        tree = if (asked.parent_id == null) tree + node else tree.map { it.adopting(node) }
        return reply(ApiJson.encodeToString(FolderDto.serializer(), node.toFolder()))
    }

    private fun FolderWithChildren.adopting(node: FolderWithChildren): FolderWithChildren =
        if (id == node.parent_id) copy(children = children + node) else copy(children = children.map { it.adopting(node) })

    private fun MockRequestHandleScope.replyListing(request: HttpRequestData): HttpResponseData {
        val asked = request.url.parameters
        val folderId = asked["folder_id"]
        val isMedia = asked["media"] == "true"
        val kind = asked["kind"]
        val items = listed.filter {
            (folderId == null || it.folder_id == folderId) &&
                (!isMedia || it.kind != DocumentKind.FILE) &&
                (kind == null || it.kind.wire == kind)
        }
        val page = Paginated(items, total = items.size, limit = items.size, offset = 0)
        return reply(ApiJson.encodeToString(Paginated.serializer(DocumentDto.serializer()), page))
    }

    private fun MockRequestHandleScope.reply(content: String, status: HttpStatusCode = HttpStatusCode.OK) = respond(
        content = content,
        status = status,
        headers = Headers.build { append(HttpHeaders.ContentType, "application/json") },
    )
}
