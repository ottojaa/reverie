package com.reverie.app.ui.navigation

import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.FavouriteDto
import com.reverie.app.data.settings.FolderViewMode
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.DashboardActions
import com.reverie.app.ui.screens.browse.DashboardBody
import com.reverie.app.ui.screens.browse.DashboardState
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedLayout
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.FolderBody
import com.reverie.app.ui.screens.browse.FolderState
import com.reverie.app.ui.screens.browse.KindFeed
import com.reverie.app.ui.screens.browse.RecentActions
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.browse.routeOf
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Hosts the app's destinations, transitions and list bodies in a real shared-transition layout, with a
 * stand-in viewer, and watches whether any document is matched between the two screens of a navigation.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DocumentDiveTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone)

    // One of each kind, a day apart so Recently added gives each its own row.
    private val documents: List<DocumentDto> = listOf(
        doc("image", "image/jpeg", "2026-11-22T10:00:00Z"),
        doc("video", "video/mp4", "2026-11-21T10:00:00Z"),
        doc("file", "application/pdf", "2026-11-20T10:00:00Z"),
    )

    private lateinit var nav: NavHostController
    private lateinit var shared: SharedTransitionScope

    /** The key each route's screen last gave the image. */
    private val imageKeys = mutableMapOf<String, String>()
    private var folderView by mutableStateOf(FolderViewMode.GRID)

    /** The dashboard's strip: the image and the video, which also have rows in Recently added. */
    private val starred = documents.take(2).map { FavouriteFixtures.file(it.copy(original_filename = "starred ${it.id}")) }
    private var favourites by mutableStateOf(emptyList<FavouriteDto>())

    /** The document the viewer has been swiped to; null while it shows the one it opened on. */
    private var swipedTo by mutableStateOf<String?>(null)

    @Composable
    private fun Host() {
        nav = rememberNavController()
        ReverieTheme {
            SharedTransitionLayout {
                shared = this
                CompositionLocalProvider(LocalSharedTransitionScope provides this) { Graph() }
            }
        }
    }

    @Composable
    private fun Graph() {
        NavHost(
            nav,
            startDestination = Routes.LIBRARY,
            enterTransition = { reverieEnter() },
            exitTransition = { reverieExit() },
            popEnterTransition = { reveriePopEnter() },
            popExitTransition = { reveriePopExit() },
        ) {
            reverieComposable(Routes.LIBRARY) { Recorded(Routes.LIBRARY) { Dashboard() } }
            reverieComposable(Routes.FOLDER, Routes.folderArguments) {
                Recorded(Routes.FOLDER) { Folder() }
            }
            reverieComposable(Routes.KIND, Routes.kindArguments) { entry ->
                val route = entry.arguments?.getString("kind")
                Recorded(Routes.KIND) { Kind(DocumentKind.entries.first { routeOf(it) == route }) }
            }
            reverieComposable(Routes.SEARCH, Routes.searchArguments) { Recorded(Routes.SEARCH) { Search() } }
            reverieComposable(Routes.DOCUMENT, Routes.documentArguments) { entry ->
                val id = entry.arguments?.getString("id") ?: ""
                // As in the pager, the page on screen carries the key.
                Recorded(Routes.DOCUMENT) { Box(Modifier.fillMaxSize().documentSharedBounds(swipedTo ?: id)) }
            }
        }
    }

    @Composable
    private fun Recorded(route: String, content: @Composable () -> Unit) {
        imageKeys[route] = documentBoundsKey(LocalDiveOrigin.current!!, "image")
        content()
    }

    @Composable
    private fun Dashboard() {
        DashboardBody(
            state = DashboardState(recent = FeedState(FeedDocuments(documents, total = 3, hasMore = false, fetched = true))),
            listState = rememberLazyListState(), contentPadding = PaddingValues(0.dp), today = today, zone = zone,
            actions = DashboardActions(
                onOpenKind = {},
                recent = RecentActions(emptySet(), {}, {}, {}, {}),
                onOpenFavourite = { nav.openFavourite(FavouriteDestination.Document(it.id, null)) },
            ),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null, onUpload = {}, favourites = favourites,
        )
    }

    @Composable
    private fun Folder() {
        FolderBody(
            state = FolderState(feed = FeedState(FeedDocuments(documents, total = 3, hasMore = false, fetched = true))),
            viewMode = folderView,
            actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            today = today, zone = zone, focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null,
            slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = {}),
        )
    }

    @Composable
    private fun Kind(kind: DocumentKind) {
        KindFeed(
            kind = kind, documents = documents.filter { it.id == kind.name.lowercase() }, hasMore = false,
            listState = rememberLazyListState(), contentPadding = PaddingValues(0.dp), layout = layout,
            actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
        )
    }

    @Composable
    private fun Search() {
        val hit = DocumentSearchResult(
            document_id = "image", display_name = "image", filename = "image.jpg", uploaded_at = "2026-11-22T10:00:00Z",
            mime_type = "image/jpeg", format = "jpg", has_text = false, size_bytes = 1,
        )
        PhotoResultTile(hit, onClick = {}, modifier = Modifier.width(120.dp))
    }

    /** Runs [navigate] frame by frame and says whether a shared element moved between the screens on the way. */
    private fun morphs(navigate: NavHostController.() -> Unit): Boolean =
        morphsAfter { compose.runOnUiThread { nav.navigate() } }

    private fun morphsAfter(act: () -> Unit): Boolean {
        compose.mainClock.autoAdvance = false
        act()
        var moved = false
        repeat(TRANSITION_FRAMES) {
            compose.mainClock.advanceTimeByFrame()
            if (compose.runOnUiThread { shared.isTransitionActive }) moved = true
        }
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        return moved
    }

    private fun currentRoute() = compose.runOnUiThread { nav.currentBackStackEntry?.destination?.route }

    private fun assertSlides(from: String, to: String) {
        assertFalse("documents flew from $from to $to", morphs { navigate(to) })
        assertFalse("documents flew back from $to to $from", morphs { popBackStack() })
    }

    private fun assertDives(documentId: String, aspect: Float? = null) {
        val list = currentRoute()
        assertTrue("no dive from $list", morphs { openDocument(currentBackStackEntry!!, documentId, aspect) })
        assertEquals(Routes.DOCUMENT, currentRoute())
        assertTrue("no shrink back to $list", morphs { popBackStack() })
        assertEquals(list, currentRoute())
    }

    private fun show(route: String) {
        compose.runOnUiThread { nav.navigate(route) }
        compose.waitForIdle()
    }

    @Test fun `no row flies between the dashboard and a kind screen`() {
        compose.setContent { Host() }
        DocumentKind.entries.forEach { assertSlides(Routes.LIBRARY, Routes.kind(routeOf(it))) }
    }

    @Test fun `no row flies between the dashboard and a folder page or search`() {
        compose.setContent { Host() }
        assertSlides(Routes.LIBRARY, Routes.folder("f1"))
        assertSlides(Routes.LIBRARY, Routes.search())
    }

    @Test fun `a document opened from the dashboard dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        assertDives("image", aspect = 1.5f)
        assertDives("video")
        assertDives("file")
    }

    @Test fun `a document opened from a kind screen dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        DocumentKind.entries.forEach {
            show(Routes.kind(routeOf(it)))
            assertDives(it.name.lowercase())
        }
    }

    @Test fun `a document opened from a folder tile dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        show(Routes.folder("f1"))
        assertDives("image", aspect = 1.5f)
        assertDives("video")
        assertDives("file")
    }

    @Test fun `a document opened from a folder list row dives into the viewer and shrinks back`() {
        folderView = FolderViewMode.LIST
        compose.setContent { Host() }
        show(Routes.folder("f1"))
        assertDives("image", aspect = 1.5f)
        assertDives("video")
        assertDives("file")
    }

    @Test fun `a document opened from search dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        show(Routes.search())
        assertDives("image")
    }

    @Test fun `the viewer takes the key of the screen it was opened from`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val dashboardKey = imageKeys.getValue(Routes.LIBRARY)
        assertEquals(dashboardKey, imageKeys[Routes.DOCUMENT])

        compose.runOnUiThread { nav.popBackStack() }
        show(Routes.kind(routeOf(DocumentKind.IMAGE)))
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val kindKey = imageKeys.getValue(Routes.KIND)
        assertEquals(kindKey, imageKeys[Routes.DOCUMENT])
        assertNotEquals(dashboardKey, kindKey)

        compose.runOnUiThread { nav.popBackStack() }
        show(Routes.folder("f1"))
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val folderKey = imageKeys.getValue(Routes.FOLDER)
        assertEquals(folderKey, imageKeys[Routes.DOCUMENT])
        assertNotEquals(dashboardKey, folderKey)
    }

    /** Taps the strip's tile for [documentId], once the same document's row below it is seen to dive. */
    private fun openFromStrip(documentId: String) {
        favourites = starred
        compose.setContent { Host() }
        // Without a row on screen to fly, the assertions that follow would hold for any key.
        assertDives("image")
        assertDives("video")
        val tile = compose.onNodeWithText("starred $documentId")
        assertFalse("a dashboard row flew into the viewer", morphsAfter { tile.performClick() })
        assertEquals(Routes.DOCUMENT, currentRoute())
    }

    @Test fun `a starred document opened from the dashboard strip moves none of the dashboard's rows`() {
        openFromStrip("image")
        assertNotEquals(imageKeys[Routes.LIBRARY], imageKeys[Routes.DOCUMENT])
        assertFalse("the viewer shrank into a dashboard row", morphs { popBackStack() })
        assertEquals(Routes.LIBRARY, currentRoute())
    }

    @Test fun `swiping to another starred document and going back moves none of the dashboard's rows`() {
        openFromStrip("image")
        swipedTo = "video"
        compose.waitForIdle()
        assertFalse("the viewer shrank into a dashboard row", morphs { popBackStack() })
        assertEquals(Routes.LIBRARY, currentRoute())
    }

    private companion object {
        /** About a second of 16ms frames: longer than any navigation transition. */
        const val TRANSITION_FRAMES = 60
    }
}
