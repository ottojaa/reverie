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
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** What the folder page's tiles and rows do when touched, and what its body shows with nothing to list. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderBodyTest {
    @get:Rule
    val compose = createComposeRule()

    private val files: List<DocumentDto> = (1..40).map { doc("f$it", "application/pdf", name = "file-$it.pdf") }
    private var documents by mutableStateOf(files)
    private var viewMode by mutableStateOf(FolderViewMode.GRID)
    private var chip by mutableStateOf<DocumentKind?>(null)
    private var selected by mutableStateOf(emptySet<String>())
    private var focusedId by mutableStateOf<String?>(null)
    private val calls = mutableListOf<String>()

    private fun show() = compose.setContent {
        ReverieTheme {
            FolderBody(
                state = FolderState(
                    selected = chip,
                    feed = FeedState(FeedDocuments(documents, total = documents.size, hasMore = false, fetched = true), selected),
                ),
                viewMode = viewMode,
                actions = RowActions(
                    selected = { it.id in selected },
                    onClick = { calls += "open:${it.id}" },
                    onLongClick = { calls += "hold:${it.id}" },
                ),
                today = LocalDate.of(2026, 11, 25), zone = ZoneOffset.UTC,
                focusedId = focusedId, onFocusConsumed = { focusedId = null }, onLoadMore = {}, error = null,
                slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = { calls += "upload" }),
            )
        }
    }

    private fun assertTouchesReachTheDocument() {
        show()

        compose.onNodeWithText("file-2.pdf").performClick()
        compose.onNodeWithText("file-3.pdf").performTouchInput { longClick() }

        assertEquals(listOf("open:f2", "hold:f3"), calls)
        compose.onAllNodesWithContentDescription("Selected").assertCountEquals(0)
        selected = setOf("f1", "f3")
        compose.onAllNodesWithContentDescription("Selected").assertCountEquals(2)
    }

    @Test fun `a grid tile opens on tap, selects on long press and shows its check`() {
        assertTouchesReachTheDocument()
    }

    @Test fun `a list row opens on tap, selects on long press and shows its check`() {
        viewMode = FolderViewMode.LIST
        assertTouchesReachTheDocument()
    }

    @OptIn(ExperimentalTestApi::class)
    @Test fun `enter opens the focused tile`() {
        show()

        compose.onNodeWithText("file-2.pdf").performSemanticsAction(SemanticsActions.RequestFocus)
        compose.onNodeWithText("file-2.pdf").performKeyInput { pressKey(Key.Enter) }

        assertEquals(listOf("open:f2"), calls)
    }

    @Test fun `each chip keeps its place, and so does a change of view`() {
        show()
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(30)

        chip = DocumentKind.FILE
        compose.onNodeWithText("file-1.pdf").assertIsDisplayed()
        chip = null
        compose.onNodeWithText("file-31.pdf").assertIsDisplayed()
        viewMode = FolderViewMode.LIST

        compose.onNodeWithText("file-31.pdf").assertIsDisplayed()
        compose.onNodeWithText("file-1.pdf").assertDoesNotExist()
    }

    @Test fun `coming back from the viewer scrolls to its document`() {
        show()
        compose.waitForIdle()

        focusedId = "f40"
        compose.waitForIdle()

        compose.onNodeWithText("file-40.pdf").assertIsDisplayed()
        assertEquals(null, focusedId)
    }

    @Test fun `an upload arriving above the first document is on screen`() {
        show()
        compose.waitForIdle()

        documents = listOf(doc("new", "application/pdf", name = "just-uploaded.pdf")) + files
        compose.waitForIdle()

        compose.onNodeWithText("just-uploaded.pdf").assertIsDisplayed()
    }

    @Test fun `an empty folder offers to upload`() {
        documents = emptyList()
        show()

        compose.onNodeWithText("No documents yet").assertIsDisplayed()
        compose.onNodeWithText("Upload").performClick()

        assertEquals(listOf("upload"), calls)
    }
}
