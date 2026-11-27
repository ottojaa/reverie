package com.reverie.app.ui.screens.document

import android.content.Context
import android.os.Looper
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.AuthApi
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.SessionCookieStorage
import com.reverie.app.data.auth.AuthSessionManager
import com.reverie.app.data.auth.TokenBundle
import com.reverie.app.data.auth.TokenStore
import com.reverie.app.data.local.FileCacheManager
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.AuthRepository
import com.reverie.app.ui.screens.browse.browseDeps
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.viewer.DocumentViewModel
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondOk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The viewer on a document the server refuses for a closed lock: it asks, and unlocking loads the document. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class LockedDocumentTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val world = FavouriteWorld().apply {
        served = listOf(FavouriteFixtures.document("d-secret", "ledger.zip", "application/zip", 2_048))
        lockedFolder = "f-taxes"
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).allowMainThreadQueries().build()
    private val deps = browseDeps(context, database, scope, world)
    private val client = HttpClient(MockEngine { respondOk() })
    private lateinit var viewModel: DocumentViewModel

    @After fun tearDown() {
        viewModel.viewModelScope.cancel()
        scope.cancel()
        database.close()
    }

    private fun open() {
        val session = AuthSessionManager({ client }, SignedOut, SessionCookieStorage(), scope)
        val files = FileCacheManager(
            context, client, deps.serverUrl, DocumentsApi(client), database.cachedFileDao(), deps.settings, Dispatchers.Unconfined,
        )
        viewModel = DocumentViewModel(
            SavedStateHandle(mapOf("id" to "d-secret", "from" to "test")), world.documents, world.vault, files,
            RealtimeManager(deps.serverUrl, session, scope), deps.serverUrl, world.sequences,
            AuthRepository(AuthApi(client), session), deps.settings, world.deps,
        )
        compose.setContent {
            ReverieTheme { DocumentScreen("d-secret", onBackClick = {}, viewModel = viewModel) }
        }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun fetches() = world.requests.count { it == "GET documents/d-secret" }

    @Test fun `it asks for the folder's lock, and unlocking loads the document`() {
        open()
        awaitText("Enter your account password to open this private folder. It stays open until you sign out or the app closes.")
        assertEquals(setOf("d-secret"), viewModel.lockedDocuments.value.keys)
        val refused = fetches()

        compose.onNode(hasSetTextAction()).performTextInput("hunter2")
        compose.onNode(hasSetTextAction()).performImeAction()

        await { fetches() > refused && viewModel.lockedDocuments.value.isEmpty() }
        awaitText("ledger.zip")
        assertEquals(
            listOf("""POST vault/unlock {"password":"hunter2","folder_id":"f-taxes"}"""),
            world.requests.filter { it.startsWith("POST vault/unlock") },
        )
    }

    private object SignedOut : TokenStore {
        override suspend fun load(): TokenBundle? = null
        override suspend fun save(bundle: TokenBundle) = Unit
        override suspend fun clear() = Unit
    }
}
