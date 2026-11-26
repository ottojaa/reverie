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
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.GridLayoutMode
import com.reverie.app.ui.components.PhotoResultTile
import com.reverie.app.ui.screens.browse.ChromeSlot
import com.reverie.app.ui.screens.browse.FeedDocuments
import com.reverie.app.ui.screens.browse.FeedLayout
import com.reverie.app.ui.screens.browse.FeedList
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.FeedState
import com.reverie.app.ui.screens.browse.FolderBody
import com.reverie.app.ui.screens.browse.FolderLinks
import com.reverie.app.ui.screens.browse.FolderState
import com.reverie.app.ui.screens.browse.RowActions
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.library.LibraryActions
import com.reverie.app.ui.screens.library.LibraryBody
import com.reverie.app.ui.screens.library.LibraryDay
import com.reverie.app.ui.screens.library.LibraryLinks
import com.reverie.app.ui.screens.library.LibraryMarks
import com.reverie.app.ui.screens.library.LibraryState
import com.reverie.app.ui.screens.library.UNFILED_SECTION
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
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class DocumentDiveTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone)

    // One of each kind, each on a day of its own.
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
            reverieComposable(Routes.LIBRARY) { Recorded(Routes.LIBRARY) { Library() } }
            reverieComposable(Routes.FOLDER, Routes.folderArguments) {
                Recorded(Routes.FOLDER) { Folder() }
            }
            reverieComposable(Routes.FEED, Routes.feedArguments) { entry ->
                val source = FeedSource.ofArgument(entry.arguments?.getString("source"))
                Recorded(Routes.FEED) { Feed(source) }
            }
            reverieComposable(Routes.SEARCH, Routes.searchArguments) { Recorded(Routes.SEARCH) { Search() } }
            reverieComposable(Routes.DOCUMENT, Routes.documentArguments) { entry ->
                val id = entry.arguments?.getString("id") ?: ""
                // As in the pager, the page on screen carries the key.
                Recorded(Routes.DOCUMENT) { Box(Modifier.fillMaxSize().documentSharedBounds(id)) }
            }
        }
    }

    @Composable
    private fun Recorded(route: String, content: @Composable () -> Unit) {
        imageKeys[route] = documentBoundsKey(LocalDiveOrigin.current!!, "image")
        content()
    }

    /** Every document is both recently added and in no folder, so the page shows each twice. */
    @Composable
    private fun Library() {
        fun opening(section: String?) = RowActions(
            selected = { false },
            onClick = { nav.openDocument(nav.currentBackStackEntry!!, it.id, section = section) },
            onLongClick = {},
        )
        LibraryBody(
            state = LibraryState(
                recent = FeedState(FeedDocuments(documents, total = 3, hasMore = false, fetched = true)),
                unfiled = FeedDocuments(documents, total = 3, fetched = true),
            ),
            marks = LibraryMarks(),
            links = LibraryLinks(onOpenFolder = {}, onOpenList = {}, onOpenFavourites = {}, onSearch = {}, onOpenTrash = {}),
            actions = LibraryActions(
                recent = opening(null), unfiled = opening(UNFILED_SECTION),
                onLoadMore = {}, onNewFolder = {}, onFocusConsumed = {},
            ),
            day = LibraryDay(today, zone),
            slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = {}),
        )
    }

    @Composable
    private fun Folder() {
        val (media, files) = documents.partition { DocumentFilter.MEDIA.holds(it.kind) }
        FolderBody(
            state = FolderState(
                media = FeedDocuments(media, total = media.size, fetched = true),
                files = FeedDocuments(files, total = files.size, fetched = true),
            ),
            name = "Trips", description = null,
            links = FolderLinks(emptyMap(), starredIds = emptySet(), onOpen = {}),
            layout = layout,
            actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null,
            slot = ChromeSlot(Modifier, PaddingValues(0.dp), onHeading = {}, onUpload = {}),
        )
    }

    @Composable
    private fun Feed(source: FeedSource) {
        FeedList(
            source = source, documents = documents.filter { source.filter.holds(it.kind) }, hasMore = false,
            listState = rememberLazyListState(), contentPadding = PaddingValues(0.dp), layout = layout,
            actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {},
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

    @Test fun `no row flies between the Library and a list screen`() {
        compose.setContent { Host() }
        FeedSource.entries.forEach { assertSlides(Routes.LIBRARY, Routes.feed(it)) }
    }

    @Test fun `no row flies between the Library and a folder page or search`() {
        compose.setContent { Host() }
        assertSlides(Routes.LIBRARY, Routes.folder("f1"))
        assertSlides(Routes.LIBRARY, Routes.search())
    }

    @Test fun `a document opened from the Library dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        assertDives("image", aspect = 1.5f)
        assertDives("video")
        assertDives("file")
    }

    @Test fun `a document opened from a list screen dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        listOf(FeedSource.PHOTOS to "image", FeedSource.VIDEOS to "video", FeedSource.FILES to "file").forEach { (source, id) ->
            show(Routes.feed(source))
            assertDives(id)
        }
    }

    @Test fun `a document opened from the lists of mixed documents dives into the viewer and shrinks back`() {
        compose.setContent { Host() }
        show(Routes.feed(FeedSource.MEDIA))
        assertDives("video")
        show(Routes.feed(FeedSource.RECENT))
        assertDives("file")
    }

    @Test fun `a document opened from a folder's grid or file rows dives into the viewer and shrinks back`() {
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
        val libraryKey = imageKeys.getValue(Routes.LIBRARY)
        assertEquals(libraryKey, imageKeys[Routes.DOCUMENT])

        compose.runOnUiThread { nav.popBackStack() }
        show(Routes.feed(FeedSource.PHOTOS))
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val feedKey = imageKeys.getValue(Routes.FEED)
        assertEquals(feedKey, imageKeys[Routes.DOCUMENT])
        assertNotEquals(libraryKey, feedKey)

        compose.runOnUiThread { nav.popBackStack() }
        show(Routes.folder("f1"))
        compose.runOnUiThread { nav.openDocument(nav.currentBackStackEntry!!, "image") }
        compose.waitForIdle()
        val folderKey = imageKeys.getValue(Routes.FOLDER)
        assertEquals(folderKey, imageKeys[Routes.DOCUMENT])
        assertNotEquals(libraryKey, folderKey)
    }

    @Test fun `a document in both of the Library's lists dives from the one it was opened from`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        val library = compose.runOnUiThread { nav.currentBackStackEntry!!.id }
        // The tile in Recently added comes first, then the row under "Not in a folder".
        listOf(library, sectionOrigin(library, UNFILED_SECTION)).forEachIndexed { copy, origin ->
            val tapped = compose.onAllNodesWithText("image.bin")[copy]

            assertTrue("no dive from copy $copy", morphsAfter { tapped.performClick() })
            assertEquals(documentBoundsKey(origin, "image"), imageKeys[Routes.DOCUMENT])
            assertTrue("no shrink back to copy $copy", morphs { popBackStack() })
        }
    }

    private companion object {
        /** About a second of 16ms frames: longer than any navigation transition. */
        const val TRANSITION_FRAMES = 60
    }
}
