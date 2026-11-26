package com.reverie.app.ui.navigation

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.room.Room
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.AuthApi
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.SearchApi
import com.reverie.app.data.api.SessionCookieStorage
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.api.model.SearchResponse
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.auth.TokenBundle
import com.reverie.app.data.auth.TokenStore
import com.reverie.app.data.backup.BackupMedia
import com.reverie.app.data.backup.BackupMediaSource
import com.reverie.app.data.backup.BackupScheduler
import com.reverie.app.data.backup.BackupSettingsRepository
import com.reverie.app.data.backup.BackupStatusSource
import com.reverie.app.data.local.FileCacheManager
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.ui.screens.browse.FolderScreen
import com.reverie.app.ui.screens.browse.FolderViewModel
import com.reverie.app.ui.screens.browse.FeedScreen
import com.reverie.app.ui.screens.browse.FeedViewModel
import com.reverie.app.ui.screens.browse.browseDeps
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.favourites.FavouritesScreen
import com.reverie.app.ui.screens.favourites.FavouritesViewModel
import com.reverie.app.ui.screens.library.LibraryLinks
import com.reverie.app.ui.screens.library.LibraryScreen
import com.reverie.app.ui.screens.library.LibraryViewModel
import com.reverie.app.ui.screens.search.SearchScreen
import com.reverie.app.ui.screens.search.SearchViewModel
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.builtins.ListSerializer

/**
 * The app's list screens, view models and viewer model over [world]'s server, in a graph that opens the
 * viewer the way the app does. Only the viewer's pages are a stand-in: [viewer] is what its pager drives.
 */
internal class ReturnScrollApp(private val context: Context, private val world: FavouriteWorld) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).allowMainThreadQueries().build()
    private val deps = browseDeps(context, database, scope, world)

    /** What a search answers with. */
    var hits: List<DocumentSearchResult> = emptyList()

    /** The ready-made searches the server offers. */
    var quickFilters: List<QuickFilter> = emptyList()

    lateinit var nav: NavHostController
    lateinit var viewer: DocumentViewModel
    lateinit var search: SearchViewModel

    private val client = HttpClient(MockEngine { request ->
        val body = when (request.url.encodedPath) {
            "/search" -> ApiJson.encodeToString(SearchResponse.serializer(), SearchResponse(hits.size, hits, timing_ms = 1.0))
            "/search/quick-filters" -> ApiJson.encodeToString(ListSerializer(QuickFilter.serializer()), quickFilters)
            else -> return@MockEngine respondError(HttpStatusCode.NotFound)
        }
        respond(body, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    private val session = AuthSessionManager({ client }, SignedOut, SessionCookieStorage(), scope)
    private val auth = AuthRepository(AuthApi(client), session)
    private val realtime = RealtimeManager(deps.serverUrl, session, scope)
    private val files = FileCacheManager(
        context, client, deps.serverUrl, DocumentsApi(client), database.cachedFileDao(), deps.settings, Dispatchers.Unconfined,
    )

    /** Backup is never switched on here, so the phone's photos are never asked for. */
    private val backup = BackupStatusSource(
        BackupSettingsRepository(context), BackupScheduler(context), database.backupDao(), NoPhotos, context,
        Dispatchers.Unconfined,
    )

    fun close() {
        scope.cancel()
        database.close()
    }

    @Composable
    fun Content() {
        nav = rememberNavController()
        ReverieTheme { Graph() }
    }

    @Composable
    private fun Graph() {
        NavHost(nav, startDestination = Routes.LIBRARY) {
            reverieComposable(Routes.LIBRARY) { Library(it) }
            reverieComposable(Routes.FAVOURITES) { Favourites(it) }
            reverieComposable(Routes.SEARCH, Routes.searchArguments) { Search(it) }
            reverieComposable(Routes.FOLDER, Routes.folderArguments) { Folder(it) }
            reverieComposable(Routes.PHOTOS, Routes.photosArguments) { Feed(it) }
            reverieComposable(Routes.FEED, Routes.feedArguments) { Feed(it) }
            reverieComposable(Routes.DOCUMENT, Routes.documentArguments) { Viewer(it) }
        }
    }

    @Composable
    private fun uploads(): UploadViewModel = viewModel {
        UploadViewModel(context, deps.uploads, MediaStorePhotoSource(context, Dispatchers.Unconfined), world.folders, world.vault)
    }

    @Composable
    private fun Library(entry: NavBackStackEntry) {
        LibraryScreen(
            links = LibraryLinks(
                onOpenFolder = { nav.showFolder(it) },
                onOpenList = { nav.navigate(Routes.feed(it)) },
                onOpenFavourites = { nav.navigate(Routes.FAVOURITES) },
                onSearch = {},
                onOpenTrash = {},
            ),
            onDocumentClick = { id, aspect, section -> nav.openDocument(entry, id, aspect, section) },
            account = {},
            viewModel = viewModel { LibraryViewModel(deps, searchRepository(), backup) },
            uploadViewModel = uploads(),
        )
    }

    private fun searchRepository() = SearchRepository(SearchApi(client), database.searchHistoryDao(), Dispatchers.Unconfined)

    @Composable
    private fun Favourites(entry: NavBackStackEntry) {
        FavouritesScreen(
            onBack = { nav.popBackStack() },
            onOpenFolder = { nav.showFolder(it) },
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            viewModel = viewModel { FavouritesViewModel(world.deps) },
        )
    }

    @Composable
    private fun Folder(entry: NavBackStackEntry) {
        FolderScreen(
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            onBack = { nav.popBackStack() },
            onOpenFolder = { nav.showFolder(it) },
            onOpenCrumb = { nav.openCrumb(it) },
            onSearch = { nav.navigate(Routes.search(it)) },
            viewModel = viewModel { FolderViewModel(createSavedStateHandle(), deps) },
            uploadViewModel = uploads(),
        )
    }

    @Composable
    private fun Feed(entry: NavBackStackEntry) {
        FeedScreen(
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            onBack = { nav.popBackStack() },
            onSearch = { nav.navigate(Routes.search(it)) },
            viewModel = viewModel { FeedViewModel(createSavedStateHandle(), deps) },
            uploadViewModel = uploads(),
        )
    }

    @Composable
    private fun Search(entry: NavBackStackEntry) {
        search = viewModel {
            SearchViewModel(searchRepository(), world.deps, deps.connectivity, createSavedStateHandle())
        }
        SearchScreen(
            onBack = { nav.popBackStack() },
            onDocumentClick = { nav.openDocument(entry, it) },
            onOpenFolder = { nav.showFolder(it) },
            viewModel = search,
        )
    }

    @Composable
    private fun Viewer(entry: NavBackStackEntry) {
        val model = viewModel {
            DocumentViewModel(
                createSavedStateHandle(), world.documents, world.vault, files, realtime, deps.serverUrl,
                world.sequences, auth, deps.settings, world.deps,
            )
        }
        viewer = model
        LaunchedEffect(model) { model.onPageSettled(entry.arguments?.getString("id").orEmpty()) }
        Box(Modifier.fillMaxSize())
    }

    private object NoPhotos : BackupMediaSource {
        override suspend fun queryMedia(): List<BackupMedia> = emptyList()
    }

    private object SignedOut : TokenStore {
        override suspend fun load(): TokenBundle? = null
        override suspend fun save(bundle: TokenBundle) = Unit
        override suspend fun clear() = Unit
    }
}
