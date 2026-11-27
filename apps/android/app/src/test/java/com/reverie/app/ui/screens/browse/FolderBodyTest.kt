package com.reverie.app.ui.screens.browse

import android.view.KeyEvent
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.settings.FolderView
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.manage.RowSelection
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

/** What a folder page lists, what its rows do when touched, and what it shows with nothing to list. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderBodyTest {
    @get:Rule
    val compose = createComposeRule()

    private val files: List<DocumentDto> = (1..40).map { doc("f$it", "application/pdf", name = "file-$it.pdf") }
    private var documents by mutableStateOf(files)
    private var view by mutableStateOf<FolderView?>(FolderView.LIST)
    private var sort by mutableStateOf(DocumentSort.NEWEST)
    private var folders by mutableStateOf(emptyList<FolderWithChildren>())
    private var isRoot = false
    private var hasMore by mutableStateOf(false)
    private var pagesAsked = 0
    private var selected by mutableStateOf(emptySet<String>())
    private var focusedId by mutableStateOf<String?>(null)
    private val calls = mutableListOf<String>()
    private var topDate: TopDate? = null

    private fun show() = compose.setContent {
        val trips = node("trips")
        val shown = node("Portugal", parent = "trips", children = folders)
        ReverieTheme {
            FolderBody(
                state = FolderState(
                    node = shown.takeUnless { isRoot },
                    path = if (isRoot) emptyList() else listOf(trips, shown),
                    isRoot = isRoot,
                    children = folders,
                    documents = FeedDocuments(documents, total = documents.size, hasMore = hasMore, fetched = view != null),
                    view = view,
                    sort = sort,
                    selectedIds = selected,
                ),
                name = if (isRoot) "My files" else "Portugal",
                description = "The August trip".takeUnless { isRoot },
                links = FolderLinks(
                    emptyMap(),
                    starredIds = emptySet(),
                    onOpen = { calls += "folder:$it" },
                    onOpenCrumb = { calls += "crumb:$it" },
                    selection = RowSelection(selected) { calls += "select folder:$it" },
                ),
                layout = FeedLayout(GridLayoutMode.UNIFORM, 3, LocalDate.of(2026, 11, 25), ZoneOffset.UTC),
                actions = RowActions(
                    selected = { it.id in selected },
                    onClick = { calls += "open:${it.id}" },
                    onLongClick = { calls += "hold:${it.id}" },
                ),
                focusedId = focusedId, onFocusConsumed = { focusedId = null }, onLoadMore = { pagesAsked++ }, error = null,
                onSort = { calls += "sort:$it" }, onShowAs = { calls += "show:$it" },
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onTopDate = { topDate = it }, onUpload = { calls += "upload" }),
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

    @Test fun `a long press selects a folder row`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        show()

        compose.onNodeWithText("Lisbon").performTouchInput { longClick() }

        assertEquals(listOf("select folder:Lisbon"), calls)
    }

    @Test fun `while something is selected a tap on a folder selects it instead of opening it`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        selected = setOf("f2")
        show()

        compose.onNodeWithText("Lisbon").performClick()

        assertEquals(listOf("select folder:Lisbon"), calls)
    }

    @Test fun `the root lists its folders above its files, with no breadcrumb to anywhere`() {
        isRoot = true
        folders = listOf(node("Lisbon").copy(kind_counts = KindCountsDto(image = 12)))
        documents = files.take(2)
        show()

        // Once, as the page's name: a breadcrumb would say it a second time.
        compose.onAllNodesWithText("My files").assertCountEquals(1)
        compose.onNodeWithText("file-1.pdf").assertExists()
        compose.onNodeWithText("Lisbon").performClick()

        assertEquals(listOf("folder:Lisbon"), calls)
    }

    @Test fun `a root holding only folders is not called empty`() {
        isRoot = true
        folders = listOf(node("Lisbon"))
        documents = emptyList()
        show()

        compose.onNodeWithText("Lisbon").assertIsDisplayed()
        compose.onNodeWithText("This folder is empty").assertDoesNotExist()
    }

    @Test fun `every breadcrumb step leads somewhere, the root included, even from a folder one level down`() {
        show()

        compose.onNodeWithText("trips").performClick()
        compose.onNodeWithText("My files").performClick()

        assertEquals(listOf("crumb:trips", "crumb:null"), calls)
    }

    private val photoDays = listOf("2026-11-25", "2026-11-24", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02")
        .flatMap { day -> (1..3).map { doc("$day-$it", created = "${day}T1$it:00:00.000Z") } }

    @Config(qualifiers = "w400dp-h500dp")
    @Test fun `the date chip is told the day of the photos at the top, and nothing above the first of them`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        documents = photoDays
        view = FolderView.GRID
        show()
        compose.waitForIdle()
        assertNull(topDate)

        // The head and one line of folders, then a line of three photos per day.
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(3)
        compose.waitForIdle()

        assertEquals("Yesterday", topDate?.title)
        assertEquals(true, topDate?.isOverPhotos)
    }

    @Config(qualifiers = "w400dp-h500dp")
    @Test fun `a grid sorted by anything but newest has no date chip`() {
        documents = photoDays
        view = FolderView.GRID
        sort = DocumentSort.NAME
        show()

        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(3)
        compose.waitForIdle()

        assertNull(topDate)
    }

    @Config(qualifiers = "w400dp-h900dp")
    @Test fun `a list shows its folders and then its documents, with no heading among them`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        documents = listOf(
            doc("p1", name = "beach.jpg", created = "2026-07-14T10:00:00Z"),
            doc("f1", "application/pdf", created = "2025-12-17T10:00:00Z", name = "report.pdf", bytes = 86_016),
        )
        show()

        fun top(text: String) = compose.onNodeWithText(text).getUnclippedBoundsInRoot().top
        assertEquals(true, top("Lisbon") < top("beach.jpg") && top("beach.jpg") < top("report.pdf"))
        compose.onNodeWithText("Photo · 14 Jul").assertIsDisplayed()
        compose.onNodeWithText("PDF · 84 KB · 17 Dec 2025").assertIsDisplayed()
        listOf("Photos and videos", "Files", "14 July", "17 December 2025").forEach {
            compose.onNodeWithText(it).assertDoesNotExist()
        }
    }

    @Config(qualifiers = "w400dp-h900dp")
    @Test fun `a grid draws its folders as tiles above photos without names, videos and files among them`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        documents = listOf(
            doc("p1", name = "beach.jpg").copy(thumbnail_blurhash = "L6PZfSi_.AyE_3t7t7R**0o#DgR4"),
            doc("v1", "video/mp4", name = "tram.mp4").copy(thumbnail_blurhash = "L6PZfSi_.AyE_3t7t7R**0o#DgR4", duration_seconds = 42.0),
            doc("a1", "application/vnd.android.package-archive", name = "reverie.apk"),
        )
        view = FolderView.GRID
        show()

        compose.onNodeWithText("beach.jpg").assertDoesNotExist()
        compose.onNodeWithText("0:42", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("reverie.apk", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("file-tile:APK", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Lisbon").performClick()

        assertEquals(listOf("folder:Lisbon"), calls)
    }

    @Test fun `a folder tile is held to select it`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        view = FolderView.GRID
        show()

        compose.onNodeWithText("Lisbon").performTouchInput { longClick() }

        assertEquals(listOf("select folder:Lisbon"), calls)
    }

    @Test fun `the button above the content asks for the other view`() {
        show()
        compose.onNodeWithContentDescription("Show as grid").performClick()
        view = FolderView.GRID
        compose.onNodeWithContentDescription("Show as list").performClick()

        assertEquals(listOf("show:GRID", "show:LIST"), calls)
    }

    @Test fun `the sort menu names the order in use and offers the three`() {
        show()

        compose.onNodeWithText("Newest first").performClick()
        compose.onNodeWithText("Size").assertIsDisplayed()
        compose.onNodeWithText("Name").performClick()

        assertEquals(listOf("sort:NAME"), calls)
        compose.onNodeWithText("Size").assertDoesNotExist()
    }

    @Test fun `a page still deciding its view draws neither content nor controls`() {
        folders = listOf(node("Lisbon", parent = "Portugal"))
        documents = emptyList()
        view = null
        show()

        compose.onNodeWithText("Portugal").assertIsDisplayed()
        compose.onNodeWithText("Lisbon").assertDoesNotExist()
        compose.onNodeWithText("Newest first").assertDoesNotExist()
        compose.onNodeWithText("This folder is empty").assertDoesNotExist()
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

    @Config(qualifiers = "w400dp-h500dp")
    @Test fun `coming back from the viewer scrolls a grid to its document, past the lines of folder tiles`() {
        // Enough lines of tiles that forgetting them would leave the document below the screen.
        folders = (1..15).map { node("sub-$it", parent = "Portugal") }
        val photos = (1..90).map { doc("p$it", created = "2026-07-14T10:00:00Z") }
        val apk = doc("a1", "application/vnd.android.package-archive", name = "reverie.apk", created = "2026-07-14T10:00:00Z")
        documents = photos.take(45) + apk + photos.drop(45)
        view = FolderView.GRID
        show()
        compose.waitForIdle()
        compose.onNodeWithText("reverie.apk", useUnmergedTree = true).assertDoesNotExist()

        focusedId = "a1"
        compose.waitForIdle()

        compose.onNodeWithText("reverie.apk", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(null, focusedId)
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `enter works the view button, and opens the sort menu to choose from`() {
        show()

        compose.onNodeWithContentDescription("Show as grid").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithContentDescription("Show as grid").performKeyInput { pressKey(Key.Enter) }
        compose.onNodeWithText("Newest first").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Newest first").performKeyInput { pressKey(Key.Enter) }
        compose.onNodeWithText("Size").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("Size").performKeyInput { pressKey(Key.Enter) }

        assertEquals(listOf("show:GRID", "sort:SIZE"), calls)
    }

    @Test fun `escape closes the sort menu without choosing`() {
        show()
        compose.onNodeWithText("Newest first").performClick()
        compose.onNodeWithText("Size").assertIsDisplayed()

        // The menu is a window of its own, which is where a keyboard's key goes while it is open.
        val root = compose.onNodeWithText("Size").fetchSemanticsNode().root as ViewRootForTest
        compose.runOnUiThread {
            listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP).forEach {
                root.view.rootView.dispatchKeyEvent(KeyEvent(it, KeyEvent.KEYCODE_ESCAPE))
            }
        }

        compose.onNodeWithText("Size").assertDoesNotExist()
        assertEquals(emptyList<String>(), calls)
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

        // The head comes before the files.
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
        // With nothing to order or lay out, there are no controls.
        compose.onNodeWithText("Newest first").assertDoesNotExist()
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

    @Test fun `each folder inside wears the folder badge, a locked one with its lock`() {
        folders = listOf(node("Lisbon", parent = "Portugal"), node("Vault", parent = "Portugal", isPrivate = true, locked = true))
        show()

        compose.onAllNodesWithContentDescription("Folder", useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithContentDescription("Locked folder", useUnmergedTree = true).assertCountEquals(1)
    }
}
