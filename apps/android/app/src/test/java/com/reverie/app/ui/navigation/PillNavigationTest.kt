package com.reverie.app.ui.navigation

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The app shell's pill over a graph of empty pages: where each button leads, and where it shows. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class PillNavigationTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var nav: NavHostController

    private val pages = mapOf(
        Routes.LIBRARY to emptyList(),
        Routes.FOLDER to Routes.folderArguments,
        Routes.PHOTOS to Routes.photosArguments,
        Routes.FEED to Routes.feedArguments,
        Routes.MY_FILES to emptyList(),
        Routes.FAVOURITES to emptyList(),
        Routes.SEARCH to Routes.searchArguments,
        Routes.DOCUMENT to Routes.documentArguments,
        Routes.SETTINGS to emptyList(),
    )

    @Before fun start() {
        compose.setContent {
            nav = rememberNavController()
            ReverieTheme {
                MainShell(nav) { modifier ->
                    NavHost(nav, startDestination = Routes.LIBRARY, modifier = modifier) {
                        pages.forEach { (route, arguments) -> composable(route, arguments) { Text("page $route") } }
                    }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun go(route: String) {
        compose.runOnUiThread { nav.navigate(route) }
        compose.waitForIdle()
    }

    private fun back() {
        compose.runOnUiThread { nav.popBackStack() }
        compose.waitForIdle()
    }

    private fun tap(label: String) {
        compose.onNodeWithText(label).performClick()
        compose.waitForIdle()
    }

    private fun button(label: String) = compose.onNodeWithText(label)

    private fun search() = compose.onNodeWithContentDescription("Search")

    /** The screen on show: its route, with the folder it is of. */
    private fun here(): String = compose.runOnUiThread {
        val entry = nav.currentBackStackEntry!!
        val folder = entry.arguments?.getString("folderId")
        if (folder != null) "folder $folder" else entry.destination.route!!
    }

    /** Pops to the bottom, collecting the screens passed. */
    private fun unwind(): List<String> {
        val seen = mutableListOf(here())
        while (compose.runOnUiThread { nav.previousBackStackEntry != null }) {
            back()
            seen += here()
        }
        return seen
    }

    @Test fun `the Library is where the app starts`() {
        assertEquals(Routes.LIBRARY, here())
        button("Library").assertIsSelected()
        button("Photos").assertIsNotSelected()
    }

    @Test fun `Library goes back to its root from any depth`() {
        go(Routes.folder("a"))
        go(Routes.folder("b"))
        go(Routes.folder("c"))

        tap("Library")

        assertEquals(listOf(Routes.LIBRARY), unwind())
    }

    @Test fun `folders left behind for Photos never come back`() {
        go(Routes.folder("a"))
        go(Routes.folder("b"))

        tap("Photos")
        assertEquals(Routes.PHOTOS, here())
        tap("Library")
        assertEquals(Routes.LIBRARY, here())
        tap("Photos")

        assertEquals(listOf(Routes.PHOTOS, Routes.LIBRARY), unwind())
    }

    @Test fun `Photos is found as it was left`() {
        tap("Photos")
        go(Routes.folder("a"))
        button("Photos").assertIsSelected()

        tap("Library")
        assertEquals(Routes.LIBRARY, here())
        button("Library").assertIsSelected()
        tap("Photos")

        assertEquals(listOf("folder a", Routes.PHOTOS, Routes.LIBRARY), unwind())
    }

    @Test fun `Library pages opened after a trip to Photos leave what Photos kept alone`() {
        tap("Photos")
        go(Routes.folder("a"))
        tap("Library")
        go(Routes.folder("b"))
        tap("Library")

        tap("Photos")

        assertEquals("folder a", here())
    }

    @Test fun `a folder found by a search opens over its results, even one already below`() {
        go(Routes.folder("a"))
        go(Routes.folder("b"))
        go(Routes.search())

        compose.runOnUiThread { nav.showFolder("a") }
        compose.waitForIdle()

        assertEquals(listOf("folder a", Routes.SEARCH, "folder b", "folder a", Routes.LIBRARY), unwind())
    }

    @Test fun `a breadcrumb step goes back to a folder on the way here, and opens any other on top`() {
        go(Routes.folder("a"))
        go(Routes.folder("b"))

        compose.runOnUiThread { nav.openCrumb("a") }
        compose.waitForIdle()
        assertEquals("folder a", here())
        compose.runOnUiThread { nav.openCrumb("top") }
        compose.waitForIdle()

        assertEquals(listOf("folder top", "folder a", Routes.LIBRARY), unwind())
    }

    @Test fun `the breadcrumb's root opens My files over the folder, with the pill's Library still selected`() {
        go(Routes.folder("a"))

        compose.runOnUiThread { nav.openCrumb(null) }
        compose.waitForIdle()

        button("Library").assertIsSelected()
        assertEquals(listOf(Routes.MY_FILES, "folder a", Routes.LIBRARY), unwind())
    }

    @Test fun `the breadcrumb's root goes back to My files when the folder was opened from there`() {
        go(Routes.MY_FILES)
        go(Routes.folder("a"))
        go(Routes.folder("b"))

        compose.runOnUiThread { nav.openCrumb(null) }
        compose.waitForIdle()

        assertEquals(listOf(Routes.MY_FILES, Routes.LIBRARY), unwind())
    }

    @Test fun `Photos tapped while on Photos goes back to its root`() {
        tap("Photos")
        go(Routes.folder("a"))

        tap("Photos")

        assertEquals(listOf(Routes.PHOTOS, Routes.LIBRARY), unwind())
    }

    @Test fun `a button tapped on its own root changes nothing`() {
        tap("Library")
        assertEquals(listOf(Routes.LIBRARY), unwind())
        tap("Photos")
        tap("Photos")
        assertEquals(listOf(Routes.PHOTOS, Routes.LIBRARY), unwind())
    }

    @Test fun `the round button searches the whole library`() {
        search().performClick()
        compose.waitForIdle()

        assertEquals(Routes.SEARCH, here())
        compose.runOnUiThread {
            val arguments = nav.currentBackStackEntry!!.arguments!!
            assertNull(arguments.getString("folder"))
            assertNull(arguments.getString("kind"))
            assertEquals("", arguments.getString("q"))
        }
    }

    @Test fun `a search route carries its scope and query`() {
        go(Routes.search(SearchScope.Folder("f1"), "type:photo a&b=c"))
        compose.runOnUiThread {
            val arguments = nav.currentBackStackEntry!!.arguments!!
            assertEquals("f1", arguments.getString("folder"))
            assertEquals("type:photo a&b=c", arguments.getString("q"))
        }

        go(Routes.search(SearchScope.Kind(DocumentKind.VIDEO)))
        compose.runOnUiThread { assertEquals("video", nav.currentBackStackEntry!!.arguments!!.getString("kind")) }
    }

    @Test fun `the round button is beside the pill on the Library root and Favourites only`() {
        search().assertExists()
        go(Routes.folder("a"))
        search().assertDoesNotExist()
        button("Library").assertExists()
        go(Routes.FAVOURITES)
        search().assertExists()
        go(Routes.feed(FeedSource.FILES))
        search().assertDoesNotExist()
        tap("Photos")
        search().assertDoesNotExist()
        button("Photos").assertExists()
    }

    @Test fun `the pill is off screen over search, the viewer and settings`() {
        listOf(Routes.search(), Routes.document("d", "none"), Routes.SETTINGS).forEach { route ->
            go(route)
            button("Library").assertDoesNotExist()
            button("Photos").assertDoesNotExist()
            search().assertDoesNotExist()
            back()
            button("Library").assertExists()
        }
    }
}
