package com.reverie.app.ui.navigation

import android.os.Looper
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.model.DocumentSearchResult
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.favourites.FavouriteDestination
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import com.reverie.app.ui.screens.search.ViewMode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration
import java.time.LocalDate

/**
 * Which lists move when the viewer closes: only the one on the screen that opened it, scrolled to the
 * document the viewer last showed. Every list here holds every document, newest ("d00") first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class ReturnScrollTest {
    @get:Rule
    val compose = createComposeRule()

    private val library = (0..29).map { index ->
        val name = "d%02d".format(index)
        val day = LocalDate.of(2026, 11, 20).minusDays(index.toLong())
        doc(name, "application/pdf", "${day}T10:00:00Z", name = "$name.pdf").copy(folder_id = FOLDER)
    }

    private val world = FavouriteWorld().apply {
        listed = library
        served = library
        // Two documents far down every list.
        items = listOf(FAR, FARTHER).map { id ->
            FavouriteFixtures.file(library.first { it.id == id }.copy(original_filename = "starred $id"))
        }
    }

    private lateinit var app: ReturnScrollApp

    @Before fun start() {
        app = ReturnScrollApp(ApplicationProvider.getApplicationContext(), world)
        app.hits = library.map {
            DocumentSearchResult(
                document_id = it.id, display_name = it.original_filename, filename = it.original_filename,
                uploaded_at = it.created_at, mime_type = it.mime_type, format = "pdf", has_text = false, size_bytes = 1,
            )
        }
        compose.setContent { app.Content() }
        awaitTop()
    }

    @After fun stop() = app.close()

    private fun named(name: String): SemanticsMatcher =
        hasText(name, substring = true) or hasContentDescription(name, substring = true)

    private fun exists(matcher: SemanticsMatcher) =
        compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    private fun await(matcher: SemanticsMatcher) = compose.waitUntil(WAIT_MS) {
        // Delayed work on the main thread (the search box's debounce) runs only when the looper is moved on.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        exists(matcher)
    }

    private fun awaitTop() = await(named("d00.pdf"))

    private fun assertAtTop(screen: String) {
        compose.waitForIdle()
        assertTrue("$screen scrolled", exists(named("d00.pdf")) && !exists(named("$FARTHER.pdf")))
    }

    private fun assertScrolledTo(id: String) {
        compose.waitForIdle()
        compose.onNode(named("$id.pdf")).assertIsDisplayed()
    }

    private fun act(block: () -> Unit) {
        compose.runOnUiThread(block)
        compose.waitForIdle()
    }

    private fun show(route: String) {
        act { app.nav.navigate(route) }
        awaitTop()
    }

    private fun back() = act { app.nav.popBackStack() }

    private fun currentRoute() = compose.runOnUiThread { app.nav.currentBackStackEntry?.destination?.route }

    /** With the viewer open, swipes to [swipeTo] when given, and goes back to the screen below. */
    private fun viewAndReturn(swipeTo: String?) {
        compose.waitForIdle()
        assertEquals(Routes.DOCUMENT, currentRoute())
        swipeTo?.let { act { app.viewer.onPageSettled(it) } }
        back()
    }

    private fun tapStarredTile() {
        await(hasText("starred $FAR"))
        compose.onNodeWithText("starred $FAR").performClick()
        compose.waitForIdle()
    }

    private fun openStarredDirectly() = act { app.nav.openFavourite(FavouriteDestination.Document(FAR, null)) }

    private fun tapFirstRow() {
        compose.onAllNodes(named("d00.pdf"))[0].performClick()
        compose.waitForIdle()
    }

    @Test fun `a starred document from the dashboard strip scrolls nothing`() {
        tapStarredTile()
        viewAndReturn(swipeTo = null)
        assertAtTop("the dashboard")
    }

    @Test fun `swiping on from a starred document from the dashboard strip scrolls nothing`() {
        tapStarredTile()
        viewAndReturn(swipeTo = FARTHER)
        assertAtTop("the dashboard")
    }

    private fun starredFromFavourites(swipeTo: String?) {
        act { app.nav.navigate(Routes.FAVOURITES) }
        tapStarredTile()
        viewAndReturn(swipeTo)
        assertEquals(Routes.FAVOURITES, currentRoute())
        back()
        assertAtTop("the dashboard")
    }

    @Test fun `a starred document from the Favourites screen scrolls no list`() = starredFromFavourites(swipeTo = null)

    @Test fun `swiping on from a starred document from the Favourites screen scrolls no list`() =
        starredFromFavourites(swipeTo = FARTHER)

    /** A folder page and a kind screen have no tiles of their own: the viewer opens as a favourite's does. */
    private fun starredOver(route: String, swipeTo: String?) {
        show(route)
        openStarredDirectly()
        viewAndReturn(swipeTo)
        assertAtTop(route)
        back()
        assertAtTop("the dashboard")
    }

    @Test fun `a starred document over a folder page scrolls no list`() = starredOver(FOLDER_ROUTE, swipeTo = null)

    @Test fun `swiping on from a starred document over a folder page scrolls no list`() =
        starredOver(FOLDER_ROUTE, swipeTo = FARTHER)

    @Test fun `a starred document over a file-type page scrolls no list`() = starredOver(KIND_ROUTE, swipeTo = null)

    @Test fun `swiping on from a starred document over a file-type page scrolls no list`() =
        starredOver(KIND_ROUTE, swipeTo = FARTHER)

    @Test fun `a document from Recently added scrolls it to the document last shown`() {
        tapFirstRow()
        viewAndReturn(swipeTo = FARTHER)
        assertScrolledTo(FARTHER)
    }

    /** Opens the first document of the list on [route], over the dashboard, and swipes far down it. */
    private fun onlyThatListScrolls(route: String) {
        show(route)
        tapFirstRow()
        viewAndReturn(swipeTo = FARTHER)
        assertScrolledTo(FARTHER)
        back()
        assertAtTop("the dashboard")
    }

    @Test fun `a document from a folder page scrolls that page and nothing else`() = onlyThatListScrolls(FOLDER_ROUTE)

    @Test fun `a document from a file-type page scrolls that page and nothing else`() = onlyThatListScrolls(KIND_ROUTE)

    private fun showResults(viewMode: ViewMode) {
        act { app.nav.navigate(Routes.search()) }
        act {
            app.search.setViewMode(viewMode)
            app.search.setFreeText("pdf")
        }
        awaitTop()
    }

    @Test fun `a document from the search grid scrolls the grid and nothing else`() {
        showResults(ViewMode.GRID)
        tapFirstRow()
        viewAndReturn(swipeTo = FARTHER)
        assertScrolledTo(FARTHER)
        back()
        assertAtTop("the dashboard")
    }

    @Test fun `a document from the search list leaves the dashboard where it was`() {
        showResults(ViewMode.LIST)
        tapFirstRow()
        viewAndReturn(swipeTo = FARTHER)
        back()
        assertAtTop("the dashboard")
    }

    private companion object {
        const val FOLDER = "f1"
        const val FAR = "d25"
        const val FARTHER = "d26"
        val FOLDER_ROUTE = Routes.folder(FOLDER)
        val KIND_ROUTE = Routes.kind("files")
        const val WAIT_MS = 10_000L
    }
}
