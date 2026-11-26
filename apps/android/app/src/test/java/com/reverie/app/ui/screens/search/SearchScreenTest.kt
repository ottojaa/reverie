package com.reverie.app.ui.screens.search

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.requestFocus
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.SearchApi
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.SearchResponse
import com.reverie.app.data.connectivity.ConnectivityMonitor
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.repository.SearchRepository
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.headersOf
import io.ktor.http.takeFrom
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
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
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

/** The search screen over its real view model: what it asks the server for, and what it remembers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class SearchScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).allowMainThreadQueries().build()
    private val world = FavouriteWorld()
    private val requests = CopyOnWriteArrayList<Url>()
    private val calls = mutableListOf<String>()
    private lateinit var viewModel: SearchViewModel

    private val hit = DocumentSearchResult(
        document_id = "tram", display_name = "Tram 28 in Lisbon", filename = "tram.pdf",
        uploaded_at = "2026-11-21T10:00:00.000Z", mime_type = "application/pdf", format = "pdf",
        has_text = false, size_bytes = 1,
    )

    private val client = HttpClient(MockEngine { request ->
        requests += request.url
        val body = when (request.url.encodedPath) {
            "/search" -> ApiJson.encodeToString(SearchResponse.serializer(), SearchResponse(1, listOf(hit), timing_ms = 1.0))
            "/search/facets" -> """{"facets":{}}"""
            else -> return@MockEngine respondError(HttpStatusCode.NotFound)
        }
        respond(body, headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }) {
        expectSuccess = false
        install(ContentNegotiation) { json(ApiJson) }
        defaultRequest { url.takeFrom("http://localhost/") }
    }

    private val searches = SearchRepository(SearchApi(client), database.searchHistoryDao(), Dispatchers.Unconfined)

    /** A phone with a connection, without which a search without a query only says it needs one. */
    private fun connect() {
        val network = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = ShadowNetworkCapabilities.newInstance()
        shadowOf(capabilities).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(network).setNetworkCapabilities(network.activeNetwork, capabilities)
    }

    @Before fun setUp() {
        connect()
        world.tree = listOf(node("Portugal – 2025"))
        runBlocking { world.folders.refresh() }
    }

    @After fun tearDown() {
        viewModel.viewModelScope.cancel()
        scope.cancel()
        database.close()
    }

    private fun open(vararg arguments: Pair<String, Any?>) {
        viewModel = SearchViewModel(
            searches, world.folders, ConnectivityMonitor(context, scope), world.sequences,
            SavedStateHandle(mapOf(*arguments)),
        )
        compose.setContent {
            ReverieTheme {
                SearchScreen(
                    onBack = { calls += "back" },
                    onDocumentClick = { calls += "document:$it" },
                    onOpenFolder = { calls += "folder:$it" },
                    viewModel = viewModel,
                )
            }
        }
    }

    private fun openFolderSearch() = open("folder" to "Portugal – 2025")

    /** The view model's work, and its pause before searching, run on the main looper, which a test drives. */
    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun type(text: String) = compose.onNode(hasSetTextAction()).performTextInput(text)

    private val searched: List<Url> get() = requests.filter { it.encodedPath == "/search" }

    private fun recents(): List<String> = runBlocking { searches.observeRecent().first() }

    private fun search(query: String) {
        type(query)
        await { searched.lastOrNull()?.parameters?.get("q") == query }
        awaitText(hit.display_name)
    }

    @Test fun `a folder's search keeps to the folder until its chip is removed`() {
        openFolderSearch()
        awaitText("In Portugal – 2025")
        compose.onNodeWithText("In Portugal – 2025").assertIsDisplayed()
        compose.onNodeWithText("Search Portugal – 2025").assertIsDisplayed()

        search("lisbon")
        assertEquals("Portugal – 2025", searched.last().parameters["folder_id"])
        await { requests.any { it.encodedPath == "/search/facets" } }
        assertEquals("Portugal – 2025", requests.last { it.encodedPath == "/search/facets" }.parameters["folder_id"])

        compose.onNodeWithText("In Portugal – 2025").performClick()
        await { searched.size == 2 }

        assertNull(searched.last().parameters["folder_id"])
        assertEquals("lisbon", searched.last().parameters["q"])
        compose.onNodeWithText("In Portugal – 2025").assertDoesNotExist()
    }

    @Test fun `the photos search asks for photos and videos only`() {
        open("media" to true)
        awaitText("Photos and videos")

        type("lisbon")
        await { searched.size == 1 }
        assertEquals("true", searched.last().parameters["media"])

        val icon = compose.onNodeWithContentDescription("Search the whole library instead", useUnmergedTree = true)
        icon.assertIsDisplayed()
        icon.performClick()
        await { searched.size == 2 }
        assertNull(searched.last().parameters["media"])
    }

    @Test fun `the row under the results looks for the same words in the whole library`() {
        openFolderSearch()
        search("lisbon")

        compose.onNodeWithText("Search “lisbon” in the whole library").performClick()
        await { searched.size == 2 }

        assertNull(searched.last().parameters["folder_id"])
        compose.onNodeWithText("Search “lisbon” in the whole library").assertDoesNotExist()
        assertEquals(emptyList<String>(), recents())
    }

    @Test fun `typing alone records nothing, and submitting records the search`() {
        open()
        search("lisbon")
        assertEquals(emptyList<String>(), recents())

        compose.onNode(hasSetTextAction()).performImeAction()

        await { recents() == listOf("lisbon") }
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `a keyboard's Enter submits`() {
        open()
        search("lisbon")

        compose.onNode(hasSetTextAction()).requestFocus().performKeyInput { pressKey(Key.Enter) }

        await { recents() == listOf("lisbon") }
    }

    @Test fun `opening a result records the search`() {
        open()
        search("lisbon")

        compose.onNodeWithText(hit.display_name).performClick()

        await { recents() == listOf("lisbon") }
        assertEquals(listOf("document:tram"), calls)
    }

    @Test fun `a recent search brings back exactly what was searched`() {
        runBlocking { searches.recordSearch("category:receipt lisbon") }
        open()
        awaitText("category:receipt lisbon")

        compose.onNodeWithText("category:receipt lisbon").performClick()
        await { searched.isNotEmpty() }

        assertEquals("category:receipt lisbon", searched.last().parameters["q"])
        compose.onNode(hasSetTextAction()).assertTextContains("lisbon")
    }

    @Test fun `a space typed between two words stays`() {
        open()

        listOf("lisbon", " ", "beach").forEach(::type)

        compose.onNode(hasSetTextAction()).assertTextContains("lisbon beach")
        await { searched.lastOrNull()?.parameters?.get("q") == "lisbon beach" }
    }

    @Test fun `the back button leaves the search`() {
        open()

        compose.onNodeWithContentDescription("Close search").performClick()

        assertEquals(listOf("back"), calls)
    }
}
