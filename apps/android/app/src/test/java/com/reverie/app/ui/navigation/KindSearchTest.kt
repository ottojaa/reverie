package com.reverie.app.ui.navigation

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import io.ktor.http.Url
import org.junit.After
import org.junit.Assert.assertEquals
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
 * Search opened from the screen of one kind of document, through the real screens: it asks the server for that
 * kind, says so on a chip, and asks for the whole library once the chip is removed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class KindSearchTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var app: ReturnScrollApp

    @Before fun start() {
        // Search asks the server only on a connected phone.
        val network = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = ShadowNetworkCapabilities.newInstance()
        shadowOf(capabilities).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        shadowOf(network).setNetworkCapabilities(network.activeNetwork, capabilities)
        app = ReturnScrollApp(context, FavouriteWorld())
        compose.setContent { app.Content() }
    }

    @After fun stop() = app.close()

    private fun await(condition: () -> Boolean) = compose.waitUntil(WAIT_MS) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        condition()
    }

    private fun asked(path: String, since: Int = 0): List<Url> = app.asked.drop(since).filter { it.encodedPath == path }

    private fun assertSearchKeepsTo(route: String, kind: String, chip: String) {
        compose.runOnUiThread { app.nav.navigate(route) }
        compose.waitForIdle()
        compose.onNode(hasContentDescription("Search", substring = true) and hasClickAction()).performClick()
        compose.waitForIdle()

        compose.onNode(hasSetTextAction()).performTextInput("lisbon")
        await { asked("/search").isNotEmpty() && asked("/search/facets").isNotEmpty() }

        assertEquals(kind, asked("/search").last().parameters["kind"])
        assertEquals(kind, asked("/search/facets").last().parameters["kind"])
        compose.onNodeWithText(chip).assertIsDisplayed()

        val before = app.asked.size
        compose.onNodeWithText(chip).performClick()
        await { asked("/search", before).isNotEmpty() && asked("/search/facets", before).isNotEmpty() }

        val widened = asked("/search", before) + asked("/search/facets", before)
        assertEquals(emptyList<String>(), widened.mapNotNull { it.parameters["kind"] ?: it.parameters["media"] })
        compose.onNodeWithText(chip).assertDoesNotExist()
    }

    @Test fun `search from the Photos tab looks in photos`() = assertSearchKeepsTo(Routes.PHOTOS, "image", "In Photos")

    @Test fun `search from the list of photos looks in photos`() =
        assertSearchKeepsTo(Routes.feed(FeedSource.PHOTOS), "image", "In Photos")

    @Test fun `search from Videos looks in videos`() =
        assertSearchKeepsTo(Routes.feed(FeedSource.VIDEOS), "video", "In Videos")

    @Test fun `search from Files looks in files`() =
        assertSearchKeepsTo(Routes.feed(FeedSource.FILES), "file", "In Files")

    private companion object {
        const val WAIT_MS = 10_000L
    }
}
