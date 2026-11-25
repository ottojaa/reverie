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
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.screens.browse.DashboardActions
import com.reverie.app.ui.screens.browse.DashboardBody
import com.reverie.app.ui.screens.browse.DashboardState
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedLayout
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.KindFeed
import com.reverie.app.ui.screens.browse.RecentActions
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.browse.routeOf
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

    @Composable
    private fun Host() {
        // Loaded before any Screen object, as MainShell does (see Screen.bottomNavItems).
        Routes.tabRoutes
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
            startDestination = Screen.Files.route,
            enterTransition = { reverieEnter() },
            exitTransition = { reverieExit() },
            popEnterTransition = { reveriePopEnter() },
            popExitTransition = { reveriePopExit() },
        ) {
            reverieComposable(Screen.Files.route) { Recorded(Screen.Files.route) { Dashboard(inFolder = false) } }
            reverieComposable(Routes.FOLDER, listOf(navArgument("folderId") { type = NavType.StringType })) {
                Recorded(Routes.FOLDER) { Dashboard(inFolder = true) }
            }
            reverieComposable(
                Routes.KIND,
                listOf(
                    navArgument("kind") { type = NavType.StringType },
                    navArgument("folderId") { type = NavType.StringType; nullable = true; defaultValue = null },
                ),
            ) { entry ->
                val route = entry.arguments?.getString("kind")
                Recorded(Routes.KIND) { Kind(DocumentKind.entries.first { routeOf(it) == route }) }
            }
            reverieComposable(Screen.Search.route) { Recorded(Screen.Search.route) { Search() } }
            reverieComposable(
                Routes.DOCUMENT,
                listOf(
                    navArgument("id") { type = NavType.StringType },
                    navArgument("from") { type = NavType.StringType },
                    navArgument("ar") { type = NavType.FloatType; defaultValue = -1f },
                ),
            ) { entry ->
                val id = entry.arguments?.getString("id") ?: ""
                Recorded(Routes.DOCUMENT) { Box(Modifier.fillMaxSize().documentSharedBounds(id)) }
            }
        }
    }

    @Composable
    private fun Recorded(route: String, content: @Composable () -> Unit) {
        imageKeys[route] = documentBoundsKey(LocalDiveOrigin.current!!, "image")
        content()
    }

    @Composable
    private fun Dashboard(inFolder: Boolean) {
        DashboardBody(
            state = DashboardState(recent = FeedState(FeedDocuments(documents, total = 3, hasMore = false, fetched = true))),
            listState = rememberLazyListState(), contentPadding = PaddingValues(0.dp), today = today, zone = zone,
            actions = DashboardActions(onOpenKind = {}, recent = RecentActions(emptySet(), {}, {}, {}, {})),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null, inFolder = inFolder, onUpload = {},
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
    private fun morphs(navigate: NavHostController.() -> Unit): Boolean {
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread { nav.navigate() }
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
        DocumentKind.entries.forEach { assertSlides(Screen.Files.route, Routes.kind(routeOf(it))) }
    }

    @Test fun `no row flies between a folder page and its kind screen`() {
        compose.setContent { Host() }
        show(Routes.folder("f1"))
        DocumentKind.entries.forEach { assertSlides(Routes.FOLDER, Routes.kind(routeOf(it), "f1")) }
    }

    @Test fun `no row flies between the dashboard and a folder page or search`() {
        compose.setContent { Host() }
        assertSlides(Screen.Files.route, Routes.folder("f1"))
        assertSlides(Screen.Files.route, Screen.Search.route)
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

    @Test fun `a document opened from a folder page or search dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        show(Routes.folder("f1"))
        assertDives("file")
        show(Screen.Search.route)
        assertDives("image")
    }

    @Test fun `the viewer takes the key of the screen it was opened from`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val dashboardKey = imageKeys.getValue(Screen.Files.route)
        assertEquals(dashboardKey, imageKeys[Routes.DOCUMENT])

        compose.runOnUiThread { nav.popBackStack() }
        show(Routes.kind(routeOf(DocumentKind.IMAGE)))
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val kindKey = imageKeys.getValue(Routes.KIND)
        assertEquals(kindKey, imageKeys[Routes.DOCUMENT])
        assertNotEquals(dashboardKey, kindKey)
    }

    private companion object {
        /** About a second of 16ms frames: longer than any navigation transition. */
        const val TRANSITION_FRAMES = 60
    }
}
