package com.reverie.app.ui.screens.browse

import android.content.Context
import android.os.Looper
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.local.toCacheableEntities
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** A folder's real view model: what its tiles and rows do through to the server, and the saved view choice. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderViewModelTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).build()
    private val world = FavouriteWorld()
    private val documents = listOf("one", "two", "three").map {
        doc(it, "application/pdf", name = "$it.pdf").copy(folder_id = "f1", file_url = "/files/$it")
    }
    private val opened = mutableListOf<FolderViewModel>()
    private lateinit var viewModel: FolderViewModel
    private lateinit var deps: BrowseDeps

    @Before fun setUp() {
        world.served = documents
        runBlocking { world.documentDao.upsertAll(documents.toCacheableEntities(now = 0)) }
        viewModel = open("f1", browseDeps(context, database, scope, world).also { deps = it })
    }

    private fun open(folderId: String, from: BrowseDeps): FolderViewModel =
        FolderViewModel(SavedStateHandle(mapOf("folderId" to folderId)), from).also { opened += it }

    @After fun tearDown() {
        opened.forEach { it.viewModelScope.cancel() }
        scope.cancel()
        database.close()
    }

    private fun show(viewMode: FolderViewMode) = compose.setContent {
        val state by viewModel.state.collectAsStateWithLifecycle()
        ReverieTheme {
            FolderBody(
                state = state,
                viewMode = viewMode,
                actions = folderRowActions(viewModel, state.feed.selectedIds, starredIds = emptySet(), openDocument = {}),
                today = LocalDate.of(2026, 11, 25), zone = ZoneOffset.UTC,
                focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null,
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = {}),
            )
        }
    }

    /** The view model's work resumes on the main looper, which Robolectric runs only when told to. */
    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    /** Long press the first of two documents and tap the second. */
    private fun selectOneAndTwo() {
        await { viewModel.state.value.feed.documents.documents.size == 3 }
        compose.onNodeWithText("one.pdf").performTouchInput { longClick() }
        await { viewModel.state.value.feed.selectedIds == setOf("one") }
        compose.onNodeWithText("two.pdf").performClick()
        await { viewModel.state.value.feed.selectedIds == setOf("one", "two") }
    }

    @Test fun `deleting a selection of tiles deletes those documents`() {
        show(FolderViewMode.GRID)
        selectOneAndTwo()

        viewModel.deleteSelected()

        await { viewModel.state.value.feed.documents.documents.map { it.id } == listOf("three") }
        compose.onNodeWithText("one.pdf").assertDoesNotExist()
        val delete = world.requests.single { it.startsWith("DELETE documents") }
        assertEquals(true, "\"one\"" in delete && "\"two\"" in delete && "\"three\"" !in delete)
        await { viewModel.state.value.feed.selectedIds.isEmpty() }
    }

    @Test fun `downloading a selection of rows hands over those files`() {
        show(FolderViewMode.LIST)
        selectOneAndTwo()
        var targets = emptyList<DownloadTarget>()

        viewModel.downloadSelected { targets = it }

        await { targets.isNotEmpty() }
        assertEquals(listOf("one.pdf", "two.pdf"), targets.map { it.filename }.sorted())
        assertEquals(true, targets.all { it.url.endsWith("/files/" + it.filename.removeSuffix(".pdf")) })
        await { viewModel.state.value.feed.selectedIds.isEmpty() }
    }

    // The only test that writes the choice: the settings store outlives a test, so the default holds until here.
    @Test fun `folders open as cards until list is chosen, and the next folder opens the same way`() {
        scope.launch { viewModel.viewMode.collect {} }
        await { viewModel.viewMode.value == FolderViewMode.GRID }

        viewModel.setViewMode(FolderViewMode.LIST)
        await { viewModel.viewMode.value == FolderViewMode.LIST }

        val nextFolder = open("f2", deps)
        scope.launch { nextFolder.viewMode.collect {} }
        await { nextFolder.viewMode.value == FolderViewMode.LIST }
    }
}
