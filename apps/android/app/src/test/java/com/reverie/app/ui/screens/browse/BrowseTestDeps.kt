package com.reverie.app.ui.screens.browse

import android.content.Context
import androidx.work.Configuration
import androidx.work.WorkManager
import coil.ImageLoader
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobEventDto
import com.reverie.app.data.api.model.Paginated
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.processing.ProcessingTracker
import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.repository.ProcessingDocuments
import com.reverie.app.data.repository.UploadRepository
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.data.upload.ContentHasher
import com.reverie.app.data.upload.UploadEnqueuer
import com.reverie.app.data.upload.UploadStager
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondOk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf

/** What a Browse screen reads from, for a test: [world]'s server and repositories, with no job events. */
internal fun browseDeps(context: Context, database: ReverieDatabase, scope: CoroutineScope, world: FavouriteWorld): BrowseDeps {
    // One per process: a test class that ran earlier in it may have set it up already.
    runCatching { WorkManager.initialize(context, Configuration.Builder().build()) }
    val settings = SettingsRepository(context)
    val uploadsApi = DocumentsApi(HttpClient(MockEngine { respondOk() }))
    // Opened here, on the test's thread, before anything queries it. A query that opens it from a background
    // thread can wait for the main thread while holding the lock close() takes: a test closing the database
    // just then never finishes.
    database.openHelper.writableDatabase
    val uploadDao = database.uploadDao()
    return BrowseDeps(
        documents = world.documents,
        folders = world.folders,
        vault = world.vault,
        processing = ProcessingTracker(NothingProcessing, NoJobEvents, flowOf(false), scope),
        connectivity = ConnectivityMonitor(context, scope),
        serverUrl = ServerUrlProvider(settings, scope),
        sequenceHolder = world.sequences,
        imageLoader = ImageLoader(context),
        uploads = UploadRepository(
            uploadDao,
            uploadsApi,
            UploadStager(context, Dispatchers.Unconfined),
            ContentHasher(context, Dispatchers.Unconfined),
            UploadEnqueuer(context, uploadDao),
            Dispatchers.Unconfined,
        ),
        settings = settings,
        favouriteDeps = world.deps,
        appContext = context,
    )
}

private object NothingProcessing : ProcessingDocuments {
    override suspend fun fetchProcessing(limit: Int, offset: Int): Paginated<DocumentDto> = awaitCancellation()
    override suspend fun fetchDocument(id: String): DocumentDto = awaitCancellation()
}

private object NoJobEvents : DocumentJobEvents {
    override val events = MutableSharedFlow<JobEventDto>()
    override val connected = MutableStateFlow(false)
    override val foregrounded = MutableStateFlow(false)
    override suspend fun subscribeDocument(documentId: String): AutoCloseable = awaitCancellation()
}
