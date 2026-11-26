package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.library.LibraryActions
import com.reverie.app.ui.screens.library.LibraryBody
import com.reverie.app.ui.screens.library.LibraryDay
import com.reverie.app.ui.screens.library.LibraryLinks
import com.reverie.app.ui.screens.library.LibraryMarks
import com.reverie.app.ui.screens.library.LibraryState
import com.reverie.app.ui.theme.ReverieTheme
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Hosts a real NavHost with the Library's and a kind screen's stateless bodies, fed fixed state, and
 * checks that back from a kind screen returns to the Library at the scroll it was left at.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BrowseNavigationTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone)

    // Forty folders, so the Library is a long page.
    private val folders = (1..40).map { node("f$it") }
    private val photos: List<DocumentDto> = (1..12).map { doc("p$it", "image/jpeg", "2026-11-%02dT10:00:00Z".format(it)) }

    private var libraryList: LazyListState? = null
    private var kindList: LazyListState? = null
    private lateinit var nav: NavHostController

    @Composable
    private fun Host() {
        nav = rememberNavController()
        ReverieTheme {
            NavHost(nav, startDestination = "library") {
                composable("library") { Library() }
                composable("kind") { Kind() }
            }
        }
    }

    @Composable
    private fun Library() {
        val listState = rememberLazyListState()
        libraryList = listState
        val actions = RowActions(selected = { false }, onClick = {}, onLongClick = {})
        LibraryBody(
            state = LibraryState(folders = folders),
            marks = LibraryMarks(),
            links = LibraryLinks(
                onOpenFolder = {}, onOpenList = { nav.navigate("kind") }, onOpenMyFiles = {}, onOpenFavourites = {}, onSearch = {},
                onOpenTrash = {},
            ),
            actions = LibraryActions(actions, actions, onLoadMore = {}, onNewFolder = {}, onFocusConsumed = {}),
            day = LibraryDay(today, zone),
            slot = ChromeSlot(Modifier, PaddingValues(bottom = 24.dp), onTopDate = {}, onUpload = {}),
            listState = listState,
        )
    }

    @Composable
    private fun Kind() {
        val listState = rememberLazyListState()
        kindList = listState
        FeedList(
            source = FeedSource.PHOTOS, documents = photos, hasMore = false, listState = listState,
            contentPadding = PaddingValues(0.dp), layout = layout, actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {},
        )
    }

    private fun scrollLibraryTo(index: Int) {
        lateinit var scope: kotlinx.coroutines.CoroutineScope
        compose.runOnUiThread { scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main) }
        compose.runOnUiThread { scope.launch { libraryList!!.scrollToItem(index) } }
        compose.waitForIdle()
    }

    @Test fun `back from a kind screen returns to the Library at its scroll`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        scrollLibraryTo(12)
        val before = compose.runOnUiThread { libraryList!!.firstVisibleItemIndex }
        assertEquals(12, before)

        compose.runOnUiThread { nav.navigate("kind") }
        compose.waitForIdle()
        assertEquals("kind", nav.currentBackStackEntry?.destination?.route)

        compose.runOnUiThread { nav.popBackStack() }
        compose.waitForIdle()

        assertEquals("library", nav.currentBackStackEntry?.destination?.route)
        assertEquals("the Library comes back where it was left", 12, compose.runOnUiThread { libraryList!!.firstVisibleItemIndex })
    }

    @Test fun `a kind screen starts at its own top however far the Library was scrolled`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        scrollLibraryTo(12)

        compose.runOnUiThread { nav.navigate("kind") }
        compose.waitForIdle()

        assertEquals(0, compose.runOnUiThread { kindList!!.firstVisibleItemIndex })
        assertTrue(compose.runOnUiThread { nav.previousBackStackEntry?.destination?.route == "library" })
    }
}
