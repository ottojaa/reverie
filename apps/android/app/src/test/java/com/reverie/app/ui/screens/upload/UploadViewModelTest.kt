package com.reverie.app.ui.screens.upload

import android.content.Context
import android.net.Uri
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkManager
import com.reverie.app.FinishWhenUploadCloses
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.upload.ContentHasher
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.data.upload.UploadEnqueuer
import com.reverie.app.data.upload.UploadStager
import com.reverie.app.domain.upload.UploadProgress
import com.reverie.app.ui.screens.destination.Destination
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.CoroutineContext

/** The upload screen's view model, over a real database: where files go, and what closes the screen. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class UploadViewModelTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).build()
    private val world = FavouriteWorld().apply { tree = listOf(node("Photos")) }
    private val io = HoldableDispatcher()
    private val checks = CopyOnWriteArrayList<String>()

    /** What the content check answers with. */
    private var results = """{"results":[{"name":"notes.txt","content":null,"name_conflict":false}]}"""

    private val client = HttpClient(MockEngine { request ->
        checks += (request.body as? TextContent)?.text.orEmpty()
        respond(results, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }
    private lateinit var viewModel: UploadViewModel
    private lateinit var uri: Uri

    @Before fun setUp() {
        runCatching { WorkManager.initialize(context, Configuration.Builder().build()) }
        val dao = database.uploadDao()
        val repository = UploadRepository(
            dao, DocumentsApi(client), UploadStager(context, io), ContentHasher(context, io),
            UploadEnqueuer(context, dao), io,
        )
        viewModel = UploadViewModel(
            context, repository, MediaStorePhotoSource(context, Dispatchers.Unconfined), world.folders, world.vault,
        )
        uri = Uri.fromFile(File(context.cacheDir, "notes.txt").apply { writeText("notes") })
        scope.launch { viewModel.review.collect {} }
        runBlocking { world.folders.refresh() }
    }

    @After fun tearDown() {
        viewModel.viewModelScope.cancel()
        scope.cancel()
        database.close()
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun begin(folderId: String? = null) {
        viewModel.beginReview(listOf(uri), folderId)
        await { viewModel.review.value != null }
    }

    private fun uploadedTo(): List<String?> = runBlocking {
        database.uploadDao().observeAllItems().first().map { database.uploadDao().getTask(it.sessionId)?.folderId }
    }

    @Test fun `from the Library an upload goes outside every folder, with no folder needed`() {
        begin()
        assertEquals("Library", viewModel.review.value?.folderName)

        viewModel.upload()
        await { viewModel.review.value == null }

        assertEquals(listOf<String?>(null), uploadedTo())
        assertEquals(true, "\"top_level\":true" in checks.single())
    }

    @Test fun `from a folder an upload defaults to that folder`() {
        begin("Photos")
        await { viewModel.review.value?.folderName == "Photos" }

        viewModel.upload()
        await { viewModel.review.value == null }

        assertEquals(listOf<String?>("Photos"), uploadedTo())
    }

    @Test fun `picking another place drops what was found about the old one`() {
        results = """{"results":[{"name":"notes.txt","content":null,"name_conflict":true}]}"""
        begin()
        viewModel.upload()
        await { viewModel.review.value?.findings?.size == 1 }

        viewModel.setLocation(Destination("Photos", "Photos"))

        await { viewModel.review.value?.folderId == "Photos" }
        assertEquals(emptyList<Any>(), viewModel.review.value?.findings)
    }

    /** The share target closes with the upload screen, so closing it too early would lose the upload. */
    @Test fun `the screen cannot be closed while the files are being copied aside`() {
        results = """{"results":[{"name":"notes.txt","content":null,"name_conflict":true}]}"""
        begin()
        viewModel.upload()
        await { viewModel.review.value?.findings?.size == 1 }
        io.hold()
        viewModel.upload()
        await { viewModel.review.value?.isStarting == true }

        viewModel.dismiss()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(true, viewModel.review.value?.isStarting)
        io.release()

        await { viewModel.review.value == null }
        assertEquals(1, uploadedTo().size)
    }

    @Test fun `closing before that uploads nothing`() {
        begin()

        viewModel.dismiss()

        await { viewModel.review.value == null }
        assertEquals(emptyList<String?>(), uploadedTo())
    }

    @Test fun `the progress bar reports the upload until it is cleared`() {
        scope.launch { viewModel.progress.collect {} }
        begin()
        viewModel.upload()
        await { viewModel.progress.value is UploadProgress.Running }
        runBlocking {
            val item = database.uploadDao().observeAllItems().first().single()
            viewModel.clearFinished()
            assertEquals(1, database.uploadDao().observeAllItems().first().size)
            database.uploadDao().updateTaskStatus(item.sessionId, "complete")
            database.uploadDao().updateItemResult(item.id, "complete", null, "doc")
        }
        await { viewModel.progress.value == UploadProgress.Finished(uploaded = 1, failed = 0) }

        viewModel.clearFinished()

        await { viewModel.progress.value == null }
        assertNull(viewModel.progress.value)
    }

    @Test fun `the share target ends once its upload screen has closed, not before it opened`() {
        var finished = 0
        var isOpen by mutableStateOf(false)
        compose.setContent { FinishWhenUploadCloses(isOpen) { finished++ } }
        compose.waitForIdle()
        assertEquals(0, finished)

        isOpen = true
        compose.waitForIdle()
        isOpen = false
        compose.waitForIdle()

        assertEquals(1, finished)
    }
}

/** Runs work where it is dispatched from, except between [hold] and [release]. */
private class HoldableDispatcher : CoroutineDispatcher() {
    private val held = ArrayDeque<Runnable>()
    private var isHeld = false

    override fun dispatch(context: CoroutineContext, block: Runnable) {
        if (isHeld) held.addLast(block) else block.run()
    }

    fun hold() {
        isHeld = true
    }

    fun release() {
        isHeld = false
        while (held.isNotEmpty()) held.removeFirst().run()
    }
}
