package com.reverie.app.ui.screens.browse

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
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** What a folder page lists, what its rows do when touched, and what it shows with nothing to list. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderBodyTest {
    @get:Rule
    val compose = createComposeRule()

    private val files: List<DocumentDto> = (1..40).map { doc("f$it", "application/pdf", name = "file-$it.pdf") }
    private var documents by mutableStateOf(files)
    private var photos by mutableStateOf(emptyList<DocumentDto>())
    private var folders by mutableStateOf(emptyList<FolderWithChildren>())
    private var hasMore by mutableStateOf(false)
    private var pagesAsked = 0
    private var selected by mutableStateOf(emptySet<String>())
    private var focusedId by mutableStateOf<String?>(null)
    private val calls = mutableListOf<String>()

    private fun show() = compose.setContent {
        val trips = node("trips")
        val shown = node("Portugal", parent = "trips", children = folders)
        ReverieTheme {
            FolderBody(
                state = FolderState(
                    node = shown,
                    path = listOf(trips, shown),
                    media = FeedDocuments(photos, total = photos.size, fetched = true),
                    files = FeedDocuments(documents, total = documents.size, hasMore = hasMore, fetched = true),
                    selectedIds = selected,
                ),
                name = "Portugal",
                description = "The August trip",
                links = FolderLinks(
                    emptyMap(),
                    starredIds = emptySet(),
                    onOpen = { calls += "folder:$it" },
                    onOpenCrumb = { calls += "crumb:$it" },
                    onHold = { calls += "hold folder:${it.id}" },
                ),
                layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 25), ZoneOffset.UTC),
                actions = RowActions(
                    selected = { it.id in selected },
                    onClick = { calls += "open:${it.id}" },
                    onLongClick = { calls += "hold:${it.id}" },
                ),
                focusedId = focusedId, onFocusConsumed = { focusedId = null }, onLoadMore = { pagesAsked++ }, error = null,
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = { calls += "upload" }),
            )
        }
    }

    @Test fun `the page leads with where it is, its name and the folders inside it`() {
        folders = listOf(node("Lisbon", parent = "Portugal").copy(kind_counts = KindCountsDto(image = 12)))
        show()

        compose.onNodeWithText("Portugal").assertIsDisplayed()
        compose.onNodeWithText("1 folder").assertIsDisplayed()
        compose.onNodeWithText("The August trip").assertIsDisplayed()
        compose.onNodeWithText("12 photos").assertIsDisplayed()
        compose.onNodeWithText("Lisbon").performClick()

        assertEquals(listOf("folder:Lisbon"), calls)
    }

    @Test fun `a long press on a folder row asks for its actions`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        show()

        compose.onNodeWithText("Lisbon").performTouchInput { longClick() }

        assertEquals(listOf("hold folder:Lisbon"), calls)
    }

    @Test fun `every breadcrumb step leads somewhere, the Library included, even from a folder one level down`() {
        show()

        compose.onNodeWithText("trips").performClick()
        compose.onNodeWithText("Library").performClick()

        assertEquals(listOf("crumb:trips", "crumb:null"), calls)
    }

    @Config(qualifiers = "w400dp-h900dp")
    @Test fun `photos stand in a grid without names, above the files`() {
        photos = listOf(doc("p1", name = "beach.jpg").copy(thumbnail_blurhash = "L6PZfSi_.AyE_3t7t7R**0o#DgR4"))
        documents = files.take(1)
        show()

        compose.onNodeWithText("Photos and videos").assertIsDisplayed()
        compose.onNodeWithText("Files").assertIsDisplayed()
        compose.onNodeWithText("beach.jpg").assertDoesNotExist()
        compose.onNodeWithText("file-1.pdf").assertIsDisplayed()
    }

    @Test fun `a file row opens on tap, selects on long press and shows its check`() {
        show()

        compose.onNodeWithText("file-2.pdf").performClick()
        compose.onNodeWithText("file-3.pdf").performTouchInput { longClick() }

        assertEquals(listOf("open:f2", "hold:f3"), calls)
        compose.onAllNodesWithContentDescription("Selected").assertCountEquals(0)
        selected = setOf("f1", "f3")
        compose.onAllNodesWithContentDescription("Selected").assertCountEquals(2)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `enter opens the focused row`() {
        show()

        compose.onNodeWithText("file-2.pdf").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("file-2.pdf").performKeyInput { pressKey(Key.Enter) }

        assertEquals(listOf("open:f2"), calls)
    }

    @Test fun `coming back from the viewer scrolls to its document, past the folder rows`() {
        folders = (1..6).map { node("sub-$it", parent = "Portugal") }
        show()
        compose.waitForIdle()

        focusedId = "f40"
        compose.waitForIdle()

        compose.onNodeWithText("file-40.pdf").assertIsDisplayed()
        assertEquals(null, focusedId)
    }

    private fun pdfs(count: Int) = (1..count).map { doc("f$it", "application/pdf", name = "file-$it.pdf") }

    @Test fun `the next page is asked for only when the last rows come into view, and once`() {
        documents = pdfs(90)
        hasMore = true
        show()
        compose.waitForIdle()
        assertEquals(0, pagesAsked)

        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(45)
        compose.waitForIdle()
        assertEquals(0, pagesAsked)

        // The head and the day's heading come before the files.
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(85)
        compose.waitForIdle()
        assertEquals(1, pagesAsked)

        documents = pdfs(120)
        compose.waitForIdle()
        assertEquals(1, pagesAsked)
    }

    @Test fun `pages too short to fill the screen keep being asked for`() {
        documents = pdfs(2)
        hasMore = true
        show()
        compose.waitForIdle()
        assertEquals(1, pagesAsked)

        documents = pdfs(4)
        compose.waitForIdle()
        assertEquals(2, pagesAsked)
    }

    @Test fun `an empty folder offers to upload`() {
        documents = emptyList()
        show()

        compose.onNodeWithText("This folder is empty").assertIsDisplayed()
        compose.onNodeWithText("Upload").performClick()

        assertEquals(listOf("upload"), calls)
    }

    @Test fun `a folder holding only folders does not claim to be empty`() {
        documents = emptyList()
        folders = listOf(node("Lisbon", parent = "Portugal"))
        show()

        compose.onNodeWithText("Lisbon").assertIsDisplayed()
        compose.onNodeWithText("This folder is empty").assertDoesNotExist()
    }
}
