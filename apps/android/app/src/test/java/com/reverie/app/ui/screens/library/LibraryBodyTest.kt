package com.reverie.app.ui.screens.library

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
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
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
                ),
                day = LibraryDay(LocalDate.of(2026, 11, 25), ZoneOffset.UTC),
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = { calls += "upload" }),
                focus = focus,
            )
        }
    }

    private fun reveal(text: String) {
        compose.onAllNodes(hasScrollToNodeAction()).onFirst().performScrollToNode(hasText(text))
    }

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

    @Test fun `both sections have a way to the rest of their documents`() {
        show()

        tap("See all")
        reveal("loose-3.pdf")
        tap("See all 7")

        assertEquals(listOf(FeedSource.RECENT, FeedSource.UNFILED).map { "list:$it" }, calls)
        compose.onNodeWithText("loose-4.pdf").assertDoesNotExist()
    }

    @Test fun `three or fewer outside folders need no way to more`() {
        state = state.copy(unfiled = FeedDocuments(loose.take(3), total = 3, fetched = true))
        show()
        reveal("loose-3.pdf")

        compose.onNodeWithText("See all 3").assertDoesNotExist()
        compose.onNodeWithText("Not in a folder").assertIsDisplayed()
    }

    @Test fun `with nothing outside folders the section is not there`() {
        state = state.copy(unfiled = FeedDocuments(fetched = true))
        show()

        compose.onNodeWithText("Not in a folder").assertDoesNotExist()
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
        compose.onNodeWithText("Folders").assertIsDisplayed()
    }

    @Test fun `coming back from the viewer brings its document into view and is then done with`() {
        val many = (1..30).map { doc("r$it", name = "recent-$it.jpg") }
        state = state.copy(recent = FeedState(FeedDocuments(many, total = 30, fetched = true)))
        show()

        focus = LibraryFocus(recent = "r25")

        compose.onNodeWithText("recent-25.jpg").assertIsDisplayed()
        assertNull(focus.recent)
    }
}
