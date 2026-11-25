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
import com.reverie.app.data.api.model.SearchResponse
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.auth.TokenBundle
import com.reverie.app.data.auth.TokenStore
import com.reverie.app.data.local.FileCacheManager
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.data.upload.MediaStorePhotoSource
import com.reverie.app.ui.screens.browse.BrowseScreen
import com.reverie.app.ui.screens.browse.BrowseViewModel
import com.reverie.app.ui.screens.browse.FolderScreen
import com.reverie.app.ui.screens.browse.FolderViewModel
import com.reverie.app.ui.screens.browse.KindScreen
import com.reverie.app.ui.screens.browse.KindViewModel
import com.reverie.app.ui.screens.browse.browseDeps
import com.reverie.app.ui.screens.browse.routeOf
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.favourites.FavouritesScreen
import com.reverie.app.ui.screens.favourites.FavouritesViewModel
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

    lateinit var nav: NavHostController
    lateinit var viewer: DocumentViewModel
    lateinit var search: SearchViewModel

    private val client = HttpClient(MockEngine { request ->
        if (request.url.encodedPath != "/search") return@MockEngine respondError(HttpStatusCode.NotFound)
        val body = ApiJson.encodeToString(SearchResponse.serializer(), SearchResponse(hits.size, hits, timing_ms = 1.0))
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
            reverieComposable(Routes.LIBRARY) { Browse(it) }
            reverieComposable(Routes.FAVOURITES) {
                FavouritesScreen(
                    onBack = { nav.popBackStack() },
                    onGo = { nav.openFavourite(it) },
                    viewModel = viewModel { FavouritesViewModel(world.deps) },
                )
            }
            reverieComposable(Routes.SEARCH, Routes.searchArguments) { Search(it) }
            reverieComposable(Routes.FOLDER, Routes.folderArguments) { Folder(it) }
            reverieComposable(Routes.KIND, Routes.kindArguments) { Kind(it) }
            reverieComposable(Routes.DOCUMENT, Routes.documentArguments) { Viewer(it) }
        }
    }

    @Composable
    private fun uploads(): UploadViewModel = viewModel {
        UploadViewModel(context, deps.uploads, MediaStorePhotoSource(context, Dispatchers.Unconfined), world.folders, world.vault)
    }

    @Composable
    private fun Browse(entry: NavBackStackEntry) {
        BrowseScreen(
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            onOpenKind = { nav.navigate(Routes.kind(routeOf(it))) },
            onFavourite = { nav.openFavourite(it) },
            viewModel = viewModel { BrowseViewModel(deps) },
            uploadViewModel = uploads(),
        )
    }

    @Composable
    private fun Folder(entry: NavBackStackEntry) {
        FolderScreen(
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            onBack = { nav.popBackStack() },
            onFavourite = { nav.openFavourite(it) },
            viewModel = viewModel { FolderViewModel(createSavedStateHandle(), deps) },
            uploadViewModel = uploads(),
        )
    }

    @Composable
    private fun Kind(entry: NavBackStackEntry) {
        KindScreen(
            onDocumentClick = { id, aspect -> nav.openDocument(entry, id, aspect) },
            onBack = { nav.popBackStack() },
            onFavourite = { nav.openFavourite(it) },
            viewModel = viewModel { KindViewModel(createSavedStateHandle(), deps) },
            uploadViewModel = uploads(),
        )
    }

    @Composable
    private fun Search(entry: NavBackStackEntry) {
        search = viewModel {
            val repository = SearchRepository(SearchApi(client), database.searchHistoryDao(), Dispatchers.Unconfined)
            SearchViewModel(repository, deps.connectivity, world.sequences, createSavedStateHandle())
        }
        SearchScreen(onDocumentClick = { nav.openDocument(entry, it) }, viewModel = search)
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

    private object SignedOut : TokenStore {
        override suspend fun load(): TokenBundle? = null
        override suspend fun save(bundle: TokenBundle) = Unit
        override suspend fun clear() = Unit
    }
}
