package com.reverie.app.ui.screens.library

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.backup.BackupStatus
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.manage.RowSelection
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** What the Library page lists, where its buttons and rows lead, and what it shows with nothing to list. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class LibraryBodyTest {
    @get:Rule
    val compose = createComposeRule()

    private val added = listOf(doc("holiday", name = "holiday.jpg"), doc("notes", "text/plain", name = "notes.md"))
    private val loose = (1..5).map { doc("loose$it", "application/pdf", name = "loose-$it.pdf") }

    private var state by mutableStateOf(
        LibraryState(
            summary = DocumentSummaryDto(image = KindTotalsDto(count = 126), video = KindTotalsDto(count = 49)),
            smartViews = listOf(QuickFilter("receipts", "Receipts", "category:receipt", count = 3)),
            folders = listOf(node("Travel").copy(kind_counts = KindCountsDto(image = 12))),
            recent = FeedState(FeedDocuments(added, total = 2, fetched = true)),
            unfiled = FeedDocuments(loose, total = 7, fetched = true),
        ),
    )
    private var focus by mutableStateOf(LibraryFocus())
    private var slotModifier: Modifier = Modifier
    private val calls = mutableListOf<String>()

    private fun rowActions(section: String) = RowActions(
        selected = { it.id in state.selectedIds },
        onClick = { calls += "$section:open:${it.id}" },
        onLongClick = { calls += "$section:hold:${it.id}" },
    )

    private fun show() = compose.setContent {
        ReverieTheme {
            LibraryBody(
                state = state,
                marks = LibraryMarks(starredFolderIds = setOf("Travel"), favouriteCount = 5, backup = BackupStatus.Complete),
                links = LibraryLinks(
                    onOpenFolder = { calls += "folder:$it" },
                    onOpenList = { calls += "list:$it" },
                    onOpenMyFiles = { calls += "my files" },
                    onOpenFavourites = { calls += "favourites" },
                    onSearch = { calls += "search:$it" },
                    onOpenTrash = { calls += "trash" },
                ),
                actions = LibraryActions(
                    recent = rowActions("recent"),
                    unfiled = rowActions("unfiled"),
                    onLoadMore = {},
                    onNewFolder = { calls += "new folder" },
                    onFocusConsumed = { focus = LibraryFocus() },
                    folders = RowSelection(state.selectedIds) { calls += "select folder:$it" },
                ),
                day = LibraryDay(LocalDate.of(2026, 11, 25), ZoneOffset.UTC),
                slot = ChromeSlot(slotModifier, PaddingValues(0.dp), onTopDate = {}, onUpload = { calls += "upload" }),
                focus = focus,
            )
        }
    }

    private fun reveal(text: String) {
        compose.onAllNodes(hasScrollToNodeAction()).onFirst().performScrollToNode(hasText(text))
    }

    private fun top(text: String) = compose.onNodeWithText(text).getUnclippedBoundsInRoot().top

    private fun height(text: String) = compose.onNodeWithText(text).getUnclippedBoundsInRoot().height

    private fun tap(text: String) {
        compose.onNodeWithText(text).performClick()
    }

    @Test fun `the page says how much there is and where backup stands`() {
        show()

        compose.onNodeWithText("Backup complete · 175 files").assertIsDisplayed()
        compose.onNodeWithText("126").assertIsDisplayed()
        compose.onNodeWithText("49").assertIsDisplayed()
        compose.onNodeWithText("12 photos").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Favourite").assertCountEquals(1)
    }

    @Test fun `each kind card opens its list`() {
        show()

        listOf("Photos", "Videos", "Files").forEach(::tap)

        assertEquals(listOf(FeedSource.PHOTOS, FeedSource.VIDEOS, FeedSource.FILES).map { "list:$it" }, calls)
    }

    @Test fun `the chips lead to favourites, a ready-made search and the trash`() {
        show()

        tap("Favourites")
        tap("Receipts")
        compose.onNodeWithText("Trash").performScrollTo().performClick()

        assertEquals(listOf("favourites", "search:category:receipt", "trash"), calls)
    }

    @Test fun `Recently added leads to its list`() {
        show()

        tap("See all")

        assertEquals(listOf("list:${FeedSource.RECENT}"), calls)
    }

    @Test fun `My files lists the folders, then the first few files, then the way to all of it`() {
        show()
        reveal("See all 8 in My files")

        compose.onNodeWithText("My files").assertIsDisplayed()
        compose.onNodeWithText("Folders").assertDoesNotExist()
        compose.onNodeWithText("loose-3.pdf").assertIsDisplayed()
        compose.onNodeWithText("loose-4.pdf").assertDoesNotExist()
        assertTrue(top("My files") < top("Travel"))
        assertTrue(top("Travel") < top("loose-1.pdf"))
        assertTrue(top("loose-3.pdf") < top("See all 8 in My files"))
        tap("See all 8 in My files")

        assertEquals(listOf("my files"), calls)
    }

    @Test fun `a file row in My files is as tall as a folder row`() {
        show()
        reveal("loose-1.pdf")

        assertEquals(height("Travel"), height("loose-1.pdf"))
    }

    @Test fun `the way to My files is there however little it holds`() {
        state = state.copy(unfiled = FeedDocuments(loose.take(2), total = 2, fetched = true))
        show()
        reveal("See all 3 in My files")

        compose.onNodeWithText("See all 3 in My files").assertIsDisplayed()
    }

    @Test fun `with nothing in My files there is its heading and nothing to see all of`() {
        state = state.copy(folders = emptyList(), unfiled = FeedDocuments(fetched = true))
        show()

        compose.onNodeWithText("My files").assertIsDisplayed()
        compose.onNodeWithText("New folder").assertIsDisplayed()
        compose.onNode(hasText("in My files", substring = true)).assertDoesNotExist()
    }

    @Test fun `a folder row opens the folder, and New folder asks for one`() {
        show()

        tap("Travel")
        tap("New folder")

        assertEquals(listOf("folder:Travel", "new folder"), calls)
    }

    @Test fun `a tap opens a document in its own section and a long press selects it`() {
        show()

        tap("holiday.jpg")
        compose.onNodeWithText("notes.md").performTouchInput { longClick() }
        reveal("loose-2.pdf")
        tap("loose-1.pdf")
        compose.onNodeWithText("loose-2.pdf").performTouchInput { longClick() }

        assertEquals(
            listOf("recent:open:holiday", "recent:hold:notes", "unfiled:open:loose1", "unfiled:hold:loose2"),
            calls,
        )
    }

    @Test fun `a long press selects a folder row`() {
        show()

        compose.onNodeWithText("Travel").performTouchInput { longClick() }

        assertEquals(listOf("select folder:Travel"), calls)
    }

    @Test fun `while something is selected a tap on a folder selects it instead of opening it`() {
        state = state.copy(recent = state.recent.copy(selectedIds = setOf("loose1")))
        show()

        compose.onNodeWithText("Travel").performClick()

        assertEquals(listOf("select folder:Travel"), calls)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `Enter opens the focused folder row`() {
        show()

        compose.onNodeWithText("Travel").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Travel").performKeyInput { pressKey(Key.Enter) }

        assertEquals(listOf("folder:Travel"), calls)
    }

    @Test fun `a selected document is marked in whichever section it is`() {
        state = state.copy(recent = state.recent.copy(selectedIds = setOf("holiday", "loose1")))
        show()

        compose.onAllNodesWithContentDescription("Selected").assertCountEquals(2)
    }

    @Test fun `an empty library offers an upload`() {
        state = LibraryState(recent = FeedState(FeedDocuments(fetched = true)))
        show()

        tap("Upload")

        assertEquals(listOf("upload"), calls)
        compose.onNodeWithText("Recently added").assertDoesNotExist()
        compose.onNodeWithText("My files").assertIsDisplayed()
    }

    @Test fun `coming back from the viewer brings its document into view and is then done with`() {
        val many = (1..30).map { doc("r$it", name = "recent-$it.jpg") }
        state = state.copy(recent = FeedState(FeedDocuments(many, total = 30, fetched = true)))
        show()

        focus = LibraryFocus(recent = "r25")

        compose.onNodeWithText("recent-25.jpg").assertIsDisplayed()
        assertNull(focus.recent)
    }

    @Test fun `coming back from a file in My files brings it into view below all the folders`() {
        state = state.copy(folders = (1..20).map { node("Folder $it") })
        slotModifier = Modifier.height(150.dp)
        show()

        focus = LibraryFocus(unfiled = "loose1")

        compose.onNodeWithText("loose-1.pdf").assertIsDisplayed()
        assertNull(focus.unfiled)
    }

    @Test fun `each folder row wears the folder badge`() {
        show()

        compose.onAllNodesWithContentDescription("Folder", useUnmergedTree = true).assertCountEquals(1)
    }
}
