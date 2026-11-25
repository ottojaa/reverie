package com.reverie.app.ui.components

import android.content.Context
import android.graphics.drawable.ColorDrawable
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import coil.Coil
import coil.ImageLoader
import coil.decode.DataSource
import coil.intercept.Interceptor
import coil.request.ErrorResult
import coil.request.ImageResult
import coil.request.SuccessResult
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.api.model.JobEventType
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.api.model.isStillProcessing
import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.PrivateDocumentStore
import com.reverie.app.data.processing.ProcessingTracker
import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.FakeDocumentDao
import com.reverie.app.ui.screens.browse.BrowseFeedModel
import com.reverie.app.ui.screens.browse.RecentActions
import com.reverie.app.ui.screens.browse.RecentEntry
import com.reverie.app.ui.screens.browse.RecentEntryView
import com.reverie.app.ui.screens.browse.RecentRow
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.collections.CoverMosaic
import com.reverie.app.ui.theme.ReverieTheme
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
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.builtins.serializer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.time.Duration

/**
 * A new image upload already has its blurhash while its thumbnail is still being made. Whatever shows
 * it must load the thumbnail once the job finishes, through the same tracker and cache the app uses,
 * without anything asking a list to refresh.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ThumbnailArrivalTest {
    @get:Rule
    val compose = createComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val server = Server()
    private val thumbnails = ThumbnailEndpoint()
    private val events = JobEvents()
    private val repository = server.repository()

    @Before fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        Coil.setImageLoader(ImageLoader.Builder(context).components { add(thumbnails) }.build())
    }

    @After fun tearDown() {
        scope.cancel()
        Coil.reset()
    }

    @Test fun `a new upload's row loads its thumbnail once it is ready, with no refresh`() {
        val feed = BrowseFeedModel(
            scope = scope,
            kind = null,
            cache = repository.observeDocuments(null),
            fetchPage = { offset -> repository.refresh(folderId = null, limit = 30, offset = offset) },
            computation = Dispatchers.Unconfined,
            sharing = SharingStarted.Eagerly,
        )
        val actions = RecentActions(emptySet(), {}, {}, {}, {})

        assertThumbnailArrives {
            val state by feed.state.collectAsState()
            Column {
                state.documents.documents.forEach {
                    RecentEntryView(RecentEntry.Row(RecentRow.Single(it)), actions, LocalDate.of(2026, 11, 25), ZoneOffset.UTC)
                }
            }
        }

        assertEquals("the list itself was read only when it opened", 1, server.listReads)
    }

    /** A cover tile comes from the folder tree and carries no job status of its own. */
    @Test fun `a folder cover loads a new upload's thumbnail once it is ready`() {
        val tile = FolderCoverTileDto("new", "image/jpeg", "new.jpg", thumbnail_blurhash = BLURHASH)

        assertThumbnailArrives { CoverMosaic(FolderCoverDto(tiles = listOf(tile))) }

        assertEquals("no list was read", 0, server.listReads)
    }

    /** Shows [content] as the app does, then finishes the upload's thumbnail job. */
    private fun assertThumbnailArrives(content: @Composable () -> Unit) {
        ProcessingTracker(repository, events, flowOf(true), scope, refreshWindow = Duration.ZERO)
        val awaiting = repository.observeAwaitingThumbnail().stateIn(scope, SharingStarted.Eagerly, emptySet())
        compose.setContent {
            val ids by awaiting.collectAsState()
            CompositionLocalProvider(LocalAwaitingThumbnails provides ids) { ReverieTheme(content = content) }
        }
        compose.waitUntil(TIMEOUT) { thumbnails.served.isNotEmpty() && "new" in events.joined }
        assertEquals("only the blurhash can be shown so far", false, thumbnails.served.last())

        thumbnails.rendered = true
        server.document = server.document.copy(thumbnail_status = JobStatus.COMPLETE)
        events.complete("new")

        compose.waitUntil(TIMEOUT) { "new" !in awaiting.value }
        compose.waitForIdle()
        assertTrue("the thumbnail was loaded: ${thumbnails.served}", thumbnails.served.last())
    }

    /** The documents API over one fresh image upload: blurhash known, thumbnail pending. */
    private class Server {
        @Volatile var document: DocumentDto = doc("new").copy(
            thumbnail_status = JobStatus.PENDING,
            thumbnail_blurhash = BLURHASH,
        )

        /** How often the list was read, apart from the tracker asking what is processing. */
        @Volatile var listReads = 0

        fun repository(): DocumentRepository {
            val engine = MockEngine { request ->
                val path = request.url.encodedPath
                val body = if (path.endsWith("/documents/new")) {
                    ApiJson.encodeToString(DocumentDto.serializer(), document)
                } else {
                    val processing = request.url.parameters["processing"] == "true"
                    if (!processing) listReads++
                    val items = listOf(document).filter { !processing || it.isStillProcessing }
                    ApiJson.encodeToString(
                        Paginated.serializer(DocumentDto.serializer()),
                        Paginated(items, items.size, limit = 60, offset = 0),
                    )
                }
                respond(body, headers = headersOf(HttpHeaders.ContentType, "application/json"))
            }
            val client = HttpClient(engine) {
                expectSuccess = false
                install(ContentNegotiation) { json(ApiJson) }
                defaultRequest { url.takeFrom("http://localhost/") }
            }
            return DocumentRepository(FakeDocumentDao(), DocumentsApi(client), PrivateDocumentStore(), NoPurge, Dispatchers.Unconfined)
        }
    }

    /** The thumbnail endpoint: fails until the job has rendered one, like the server. */
    private class ThumbnailEndpoint : Interceptor {
        @Volatile var rendered = false

        /** One entry per image load: whether it got a picture. */
        val served = CopyOnWriteArrayList<Boolean>()

        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val found = rendered
            served += found
            if (!found) return ErrorResult(null, chain.request, IOException("Thumbnail not available"))
            return SuccessResult(ColorDrawable(android.graphics.Color.RED), chain.request, DataSource.NETWORK)
        }
    }

    private class JobEvents : DocumentJobEvents {
        override val events = MutableSharedFlow<JobEventDto>(extraBufferCapacity = 8)
        override val connected = MutableStateFlow(true)
        override val foregrounded = MutableStateFlow(true)
        val joined = CopyOnWriteArrayList<String>()

        override suspend fun subscribeDocument(documentId: String): AutoCloseable {
            joined += documentId
            return AutoCloseable { joined -= documentId }
        }

        fun complete(documentId: String) {
            events.tryEmit(
                JobEventDto(
                    type = JobEventType.COMPLETE, job_id = "j", document_id = documentId,
                    status = JobStatus.COMPLETE, timestamp = "2026-11-25T10:00:00Z",
                ),
            )
        }
    }

    private object NoPurge : PrivateDataPurger {
        override suspend fun purgeCachedCopies(ids: Collection<String>) {}
        override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) {}
        override suspend fun forgetMoved(ids: Collection<String>) {}
        override suspend fun clearSession() {}
    }

    private companion object {
        const val TIMEOUT = 10_000L
        const val BLURHASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
    }
}
