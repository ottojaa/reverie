package com.reverie.app.ui.screens.trash

import android.os.Looper
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.model.ThumbnailUrls
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.theme.ReverieTheme
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The trash screen over its view model and a fake server: what it lists, and restoring and deleting for good. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class TrashScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
    private val world = FavouriteWorld().apply {
        trash = TrashListDto(
            documents = listOf(trashedFile("receipt")),
            folders = listOf(trashedFolder("Taxes", folders = 2, files = 14), trashedFolder("vault", locked = true)),
            retention_days = 30,
        )
    }
    private val repository = world.trashRepository(ServerUrlProvider(settings, scope))
    private val calls = mutableListOf<String>()
    private lateinit var viewModel: TrashViewModel

    @After fun tearDown() {
        viewModel.viewModelScope.cancel()
        scope.cancel()
    }

    private fun open() {
        viewModel = TrashViewModel(repository, world.vault)
        compose.setContent {
            ReverieTheme { TrashScreen(onBack = { calls += "back" }, viewModel = viewModel) }
        }
    }

    private fun await(condition: () -> Boolean) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun awaitText(text: String) = await { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    /** Robolectric drops some touches on sheet and dialog windows, so their buttons are asked to click. */
    private fun press(text: String) {
        awaitText(text)
        compose.onNodeWithText(text).performSemanticsAction(SemanticsActions.OnClick)
    }

    private fun sent(start: String) = world.requests.filter { it.startsWith(start) }

    private fun refusal(folderId: String) = HttpStatusCode.Forbidden to
        """{"statusCode":403,"error":"FOLDER_LOCKED","message":"Folder is locked","details":{"folder_id":"$folderId"}}"""

    @Test fun `folders and files are listed with what they hold and how long they stay`() {
        open()
        awaitText("Taxes")

        compose.onNodeWithText("Kept for 30 days, then deleted for good").assertExists()
        compose.onNodeWithText("2 folders · 14 files · 27 days left").assertExists()
        compose.onNodeWithText("receipt.pdf").assertExists()
        compose.onNodeWithText("2.3 MB · 27 days left").assertExists()
        compose.onNodeWithText("Locked folder").assertExists()
        compose.onNodeWithText("Locked · 27 days left").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(listOf("back"), calls)
    }

    @Test fun `a tapped file can be restored, and counts as deleted no longer`() {
        runBlocking { world.documents.delete(listOf("receipt")) }
        open()
        awaitText("receipt.pdf")

        compose.onNodeWithText("receipt.pdf").performClick()
        world.trash = TrashListDto(retention_days = 30)
        press("Restore")

        awaitText("Restored")
        awaitText("The trash is empty.")
        assertEquals(listOf("""POST trash/restore {"document_ids":["receipt"]}"""), sent("POST trash/restore"))
        assertEquals(emptySet<String>(), world.documents.deletedIds.value)
        assertTrue(world.requests.contains("GET folders/tree"))
    }

    @Test fun `deleting a held folder for good is confirmed first, and cancelling sends nothing`() {
        open()
        awaitText("Taxes")

        compose.onNodeWithText("Taxes").performTouchInput { longClick() }
        press("Delete forever")
        awaitText("The 2 folders and 14 files in it are deleted with it. This can't be undone.")
        press("Cancel")
        await { viewModel.dialog.value == null }
        assertEquals(emptyList<String>(), sent("POST trash/"))

        compose.onNodeWithText("Taxes").performTouchInput { longClick() }
        press("Delete forever")
        awaitText("Delete “Taxes” forever?")
        press("Delete forever")

        awaitText("Deleted for good")
        assertEquals(listOf("""POST trash/purge {"folder_ids":["Taxes"]}"""), sent("POST trash/"))
    }

    @Config(qualifiers = "w640dp-h360dp")
    @Test fun `on a short screen the menu opens far enough to show its last row`() {
        open()
        awaitText("receipt.pdf")

        compose.onNodeWithText("receipt.pdf").performScrollTo().performSemanticsAction(SemanticsActions.OnLongClick)
        awaitText("Delete forever")

        val bottom = compose.onNodeWithText("Delete forever").getUnclippedBoundsInRoot().bottom
        assertTrue("the last row ends at $bottom", bottom <= 360.dp)
    }

    @Test fun `a locked folder asks for its password and is then named`() {
        open()
        awaitText("Locked folder")

        compose.onNodeWithText("Locked folder").performClick()
        await { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
        world.trash = TrashListDto(folders = listOf(trashedFolder("vault", files = 3, name = "Passports")), retention_days = 30)
        compose.onNode(hasSetTextAction()).performTextInput("password")
        compose.onNode(hasSetTextAction()).performImeAction()

        awaitText("Passports")
        compose.onNodeWithText("3 files · 27 days left").assertExists()
        assertTrue(sent("POST vault/unlock").single().contains(""""folder_id":"vault""""))
        assertEquals(emptyList<String>(), sent("POST trash/"))
    }

    @Test fun `a restore refused by a lock is made again once it is open`() {
        world.writeAnswers += refusal("vault")
        open()
        awaitText("Taxes")

        compose.onNodeWithText("Taxes").performClick()
        press("Restore")
        await { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performTextInput("password")
        compose.onNode(hasSetTextAction()).performImeAction()

        awaitText("Restored")
        assertEquals(2, sent("""POST trash/restore {"folder_ids":["Taxes"]}""").size)
    }

    @Test fun `a refused change says why`() {
        world.writeAnswers += HttpStatusCode.Conflict to
            """{"statusCode":409,"error":"CONFLICT","message":"A folder with that name already exists"}"""
        open()
        awaitText("Taxes")

        compose.onNodeWithText("Taxes").performClick()
        press("Restore")

        awaitText("A folder with that name already exists")
    }

    @Test fun `a trash that cannot be read says so and can be tried again`() {
        world.isOffline = true
        open()
        awaitText("Couldn't load the trash.")

        world.isOffline = false
        compose.onNodeWithText("Try again").performClick()

        awaitText("Taxes")
    }

    @Test fun `thumbnail addresses are completed with the server's`() = runBlocking {
        world.trash = TrashListDto(
            documents = listOf(trashedFile("photo", thumbnails = ThumbnailUrls("/files/sm?s=1", "/files/md", "https://cdn.test/lg"))),
            retention_days = 30,
        )
        open()

        val urls = repository.list().documents.single().thumbnail_urls!!

        assertTrue(urls.sm.startsWith("http") && urls.sm.endsWith("/files/sm?s=1"))
        assertEquals("https://cdn.test/lg", urls.lg)
    }
}
