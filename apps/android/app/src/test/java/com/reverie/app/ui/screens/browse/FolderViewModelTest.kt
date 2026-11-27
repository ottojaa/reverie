package com.reverie.app.ui.screens.browse

import android.content.Context
import android.os.Looper
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.local.toCacheableEntities
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.manage.ManageDialog
import com.reverie.app.ui.screens.manage.pickFrom
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

/** A folder's real view model: what its page's tiles and rows do through to the server. */
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
    private lateinit var deps: BrowseDeps
    private lateinit var viewModel: FolderViewModel

    @Before fun setUp() {
        world.served = documents
        runBlocking { world.documentDao.upsertAll(documents.toCacheableEntities(now = 0)) }
        deps = browseDeps(context, database, scope, world)
        viewModel = open("f1")
    }

    /** A visit to the folder's page: a view model of its own, with the page's state being watched. */
    private fun open(folderId: String): FolderViewModel {
        val visit = FolderViewModel(SavedStateHandle(mapOf("folderId" to folderId)), deps)
        opened += visit
        scope.launch { visit.state.collect {} }
        return visit
    }

    @After fun tearDown() {
        opened.forEach { it.viewModelScope.cancel() }
        scope.cancel()
        database.close()
    }

    private fun show() = compose.setContent {
        val state by viewModel.state.collectAsStateWithLifecycle()
        ReverieTheme {
            FolderBody(
                state = state,
                name = "Receipts",
                description = null,
                links = FolderLinks(emptyMap(), starredIds = emptySet(), onOpen = {}, onOpenCrumb = {}),
                layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 25), ZoneOffset.UTC),
                actions = documentRowActions(viewModel, state.selectedIds, starredIds = emptySet(), openDocument = {}),
                focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null,
                onSort = viewModel::sortBy, onShowAs = viewModel::showAs,
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onTopDate = {}, onUpload = {}),
            )
        }
    }

    private val shownIds: List<String> get() = viewModel.state.value.documents.documents.map { it.id }

    /** The view model's work resumes on the main looper, which Robolectric runs only when told to. */
    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    /** Long press the first of two documents and tap the second. */
    private fun selectOneAndTwo() {
        await { shownIds.size == 3 }
        compose.onNodeWithText("one.pdf").performTouchInput { longClick() }
        await { viewModel.state.value.selectedIds == setOf("one") }
        compose.onNodeWithText("two.pdf").performClick()
        await { viewModel.state.value.selectedIds == setOf("one", "two") }
    }

    private fun picked() = pickFrom(viewModel.selection.ids.value, viewModel.state.value.documents.documents)

    @Test fun `deleting a selection of rows deletes those documents`() {
        show()
        selectOneAndTwo()

        viewModel.manage.askToTrash(picked(), viewModel.selection::remove)
        viewModel.manage.trash(viewModel.manage.dialog.value as ManageDialog.ConfirmTrash)

        await { shownIds == listOf("three") }
        compose.onNodeWithText("one.pdf").assertDoesNotExist()
        val delete = world.requests.single { it.startsWith("DELETE documents") }
        assertEquals(true, "\"one\"" in delete && "\"two\"" in delete && "\"three\"" !in delete)
        await { viewModel.state.value.selectedIds.isEmpty() }
    }

    @Test fun `downloading a selection of rows hands over those files`() {
        show()
        selectOneAndTwo()
        var targets = emptyList<DownloadTarget>()

        viewModel.download(picked().documents.map { it.id }) { targets = it }

        await { targets.isNotEmpty() }
        assertEquals(listOf("one.pdf", "two.pdf"), targets.map { it.filename }.sorted())
        assertEquals(true, targets.all { it.url.endsWith("/files/" + it.filename.removeSuffix(".pdf")) })
    }

    // The settings outlive a test within one process, so these folders are no other test's.
    @Test fun `the view and the order chosen on a folder's page are how it is shown on the next visit`() {
        val stored = listOf("kept", "other").map { doc("$it-file", "application/pdf").copy(folder_id = it) }
        runBlocking { world.documentDao.upsertAll(stored.toCacheableEntities(now = 0)) }
        world.listed = stored
        viewModel = open("kept")
        show()
        await { viewModel.state.value.view == FolderView.LIST }

        try {
            compose.onNodeWithContentDescription("Show as grid").performClick()
            await { viewModel.state.value.view == FolderView.GRID }
            compose.onNodeWithText("Newest first").performClick()
            compose.onNodeWithText("Size").performClick()
            await { viewModel.state.value.sort == DocumentSort.SIZE }

            val again = open("kept")
            await { again.state.value.view != null }
            assertEquals(FolderView.GRID to DocumentSort.SIZE, again.state.value.let { it.view to it.sort })
            // Another folder keeps the view its contents call for; the order is one choice for all of them.
            val other = open("other")
            await { other.state.value.view != null }
            assertEquals(FolderView.LIST to DocumentSort.SIZE, other.state.value.let { it.view to it.sort })
        } finally {
            runBlocking { deps.settings.setFolderSort(DocumentSort.NEWEST) }
        }
    }
}
