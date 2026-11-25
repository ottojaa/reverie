package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/** When the dashboard draws the favourites strip, what it asks for, and that the list still behaves under it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FavouritesStripTest {
    @get:Rule
    val compose = createComposeRule()

    private val files: List<DocumentDto> = (1..40).map { doc("f$it", "application/pdf", "2026-10-%02dT10:00:00Z".format(1 + it % 28), name = "file-$it.pdf") }

    private var favourites by mutableStateOf(emptyList<FavouriteDto>())
    private var focusedId by mutableStateOf<String?>(null)
    private var list: LazyListState? = null
    private val calls = mutableListOf<String>()

    private fun show(documents: List<DocumentDto> = files) = compose.setContent {
        val listState = rememberLazyListState()
        list = listState
        ReverieTheme {
            DashboardBody(
                // The cards the strip sits above: a library with files always has one.
                state = DashboardState(
                    cachedKinds = if (documents.isEmpty()) emptySet() else setOf(DocumentKind.FILE),
                    recent = FeedState(FeedDocuments(documents, total = documents.size, hasMore = false, fetched = true)),
                ),
                listState = listState, contentPadding = PaddingValues(bottom = 24.dp), today = LocalDate.of(2026, 11, 25), zone = ZoneOffset.UTC,
                actions = DashboardActions(
                    onOpenKind = {},
                    recent = RecentActions(emptySet(), {}, {}, {}, {}),
                    onOpenFavourite = { calls += "open:${it.id}" },
                    onSeeAllFavourites = { calls += "all" },
                ),
                focusedId = focusedId, onFocusConsumed = { focusedId = null }, onLoadMore = {}, error = null,
                onUpload = {}, favourites = favourites,
            )
        }
    }

    @Test fun `no favourites, no strip`() {
        show()

        compose.onNodeWithText("Favourites").assertDoesNotExist()
    }

    @Test fun `the strip arrives on top of a list already shown, and opens what is tapped`() {
        show()
        compose.waitForIdle()
        favourites = FavouriteFixtures.all

        compose.onNodeWithText("Favourites").assertIsDisplayed()
        compose.onNodeWithText("Portugal - 2025").performClick()
        compose.onNodeWithText("See all 7").performClick()
        assertEquals(listOf("open:f-portugal", "all"), calls)
    }

    @Test fun `an empty library still shows the strip`() {
        favourites = listOf(FavouriteFixtures.portugal)
        show(documents = emptyList())

        compose.onNodeWithText("Favourites").assertIsDisplayed()
        compose.onNodeWithText("No documents yet").assertIsDisplayed()
    }

    @Test fun `coming back from the viewer still scrolls to its document`() {
        favourites = FavouriteFixtures.all
        show()
        compose.waitForIdle()
        val last = DashboardState(recent = FeedState(FeedDocuments(files, 40, false, fetched = true))).entries.last()

        focusedId = (last as RecentEntry.Row).row.docIds().first()
        compose.waitForIdle()

        val state = list!!
        assertEquals(null, focusedId)
        assertTrue(compose.runOnUiThread { state.layoutInfo.visibleItemsInfo.any { it.key == "row:${last.key}" } })
    }
}
