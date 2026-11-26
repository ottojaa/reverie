package com.reverie.app.ui.navigation

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.domain.search.SearchScope
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.time.Duration

/**
 * One library, read on every screen that counts it: the Library's cards, the list of each kind, a folder's row
 * and page, and search. A list's own pages hold one document of each kind here, so a header that counted them
 * instead of asking for the library's figures would show.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h2000dp")
class CountsTest {
    @get:Rule
    val compose = createComposeRule()

    private val trip = node("Trip").copy(kind_counts = KindCountsDto(image = 31, video = 4, file = 2))

    private val world = FavouriteWorld().apply {
        summary = DocumentSummaryDto(KindTotalsDto(126), KindTotalsDto(49), FileTotalsDto(77))
        tree = listOf(trip)
        listed = listOf(
            doc("photo", "image/jpeg", "2026-11-20T10:00:00Z"),
            doc("video", "video/mp4", "2026-11-19T10:00:00Z"),
            doc("paper", "application/pdf", "2026-11-18T10:00:00Z"),
        ).map { it.copy(folder_id = trip.id) }
    }

    private lateinit var app: ReturnScrollApp

    @Before fun start() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // Search asks the server only on a connected phone.
        val network = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = ShadowNetworkCapabilities.newInstance()
        shadowOf(capabilities).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(network).setNetworkCapabilities(network.activeNetwork, capabilities)
        app = ReturnScrollApp(context, world)
        app.quickFilters = listOf(
            QuickFilter("photos", "Photos", "type:photo", count = 90),
            QuickFilter("videos", "Videos", "type:video", count = 48),
            QuickFilter("screenshots", "Screenshots", "type:screenshot", count = 36),
        )
        compose.setContent { app.Content() }
    }

    @After fun stop() = app.close()

    private fun awaitText(text: String) = compose.waitUntil(WAIT_MS) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    }

    private fun show(route: String) {
        compose.runOnUiThread { app.nav.navigate(route) }
        compose.waitForIdle()
    }

    private fun back() {
        compose.runOnUiThread { app.nav.popBackStack() }
        compose.waitForIdle()
    }

    @Test fun `the Library's cards and each kind's list show the same counts`() {
        listOf("126", "49", "77").forEach { awaitText(it) }

        listOf(
            FeedSource.PHOTOS to "126 photos",
            FeedSource.VIDEOS to "49 videos",
            FeedSource.FILES to "77 files",
        ).forEach { (source, counted) ->
            show(Routes.feed(source))
            awaitText(counted)
            back()
        }
    }

    @Test fun `a folder's row and its page show the same count`() {
        awaitText("37 files")

        show(Routes.folder(trip.id))

        awaitText("37 files")
    }

    @Test fun `search offers no count of photos or videos`() {
        awaitText("126")

        show(Routes.search(SearchScope.Library))

        awaitText("Screenshots · 36")
        compose.onNodeWithText("Photos · 90").assertDoesNotExist()
        compose.onNodeWithText("Videos · 48").assertDoesNotExist()
    }

    private companion object {
        const val WAIT_MS = 10_000L
    }
}
