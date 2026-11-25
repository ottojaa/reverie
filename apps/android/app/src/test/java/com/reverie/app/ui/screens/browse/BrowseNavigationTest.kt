package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.settings.GridLayoutMode
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
 * Hosts a real NavHost with the dashboard's and a kind screen's stateless bodies, fed fixed state, and
 * checks that back from a kind screen returns to the dashboard at the scroll it was left at.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BrowseNavigationTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 11, 23)
    private val zone = ZoneOffset.UTC
    private val layout = FeedLayout(GridLayoutMode.MOSAIC, featureEvery = 8, today = today, zone = zone)

    // Forty files with different names, a day apart: forty single rows, so the list is long and nothing folds.
    private val files: List<DocumentDto> = (1..40).map { doc("f$it", "application/pdf", "2026-10-%02dT10:00:00Z".format(1 + it % 28), name = "file-$it.pdf") }
    private val photos: List<DocumentDto> = (1..12).map { doc("p$it", "image/jpeg", "2026-11-%02dT10:00:00Z".format(it)) }

    private var dashboardList: LazyListState? = null
    private var kindList: LazyListState? = null
    private lateinit var nav: NavHostController

    @Composable
    private fun Host() {
        nav = rememberNavController()
        ReverieTheme {
            NavHost(nav, startDestination = "dashboard") {
                composable("dashboard") { Dashboard() }
                composable("kind") { Kind() }
            }
        }
    }

    @Composable
    private fun Dashboard() {
        val listState = rememberLazyListState()
        dashboardList = listState
        val state = DashboardState(recent = FeedState(FeedDocuments(files, total = 40, hasMore = false, fetched = true)))
        DashboardBody(
            state = state, listState = listState, contentPadding = PaddingValues(top = 0.dp, bottom = 24.dp), today = today, zone = zone,
            actions = DashboardActions(onOpenKind = { nav.navigate("kind") }, recent = RecentActions(emptySet(), {}, {}, {}, {})),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, error = null, onUpload = {},
        )
    }

    @Composable
    private fun Kind() {
        val listState = rememberLazyListState()
        kindList = listState
        KindFeed(
            kind = DocumentKind.IMAGE, documents = photos, hasMore = false, listState = listState,
            contentPadding = PaddingValues(0.dp), layout = layout, actions = RowActions(selected = { false }, onClick = {}, onLongClick = {}),
            focusedId = null, onFocusConsumed = {}, onLoadMore = {}, onHeading = {},
        )
    }

    private fun scrollDashboardTo(index: Int) {
        lateinit var scope: kotlinx.coroutines.CoroutineScope
        compose.runOnUiThread { scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main) }
        compose.runOnUiThread { scope.launch { dashboardList!!.scrollToItem(index) } }
        compose.waitForIdle()
    }

    @Test fun `back from a kind screen returns to the dashboard at its scroll`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        scrollDashboardTo(12)
        val before = compose.runOnUiThread { dashboardList!!.firstVisibleItemIndex }
        assertEquals(12, before)

        compose.runOnUiThread { nav.navigate("kind") }
        compose.waitForIdle()
        assertEquals("kind", nav.currentBackStackEntry?.destination?.route)

        compose.runOnUiThread { nav.popBackStack() }
        compose.waitForIdle()

        assertEquals("dashboard", nav.currentBackStackEntry?.destination?.route)
        assertEquals("the dashboard comes back where it was left", 12, compose.runOnUiThread { dashboardList!!.firstVisibleItemIndex })
    }

    @Test fun `a kind screen starts at its own top however far the dashboard was scrolled`() {
        compose.setContent { Host() }
        compose.waitForIdle()
        scrollDashboardTo(12)

        compose.runOnUiThread { nav.navigate("kind") }
        compose.waitForIdle()

        assertEquals(0, compose.runOnUiThread { kindList!!.firstVisibleItemIndex })
        assertTrue(compose.runOnUiThread { nav.previousBackStackEntry?.destination?.route == "dashboard" })
    }
}
