package com.reverie.app.ui.navigation

import android.os.Looper
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The Photos tab, built from the real screen and view model on the route the app registers for it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class PhotosTabTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld().apply {
        listed = listOf(
            doc("photo", "image/jpeg", "2026-11-20T10:00:00Z", name = "photo.jpg"),
            doc("clip", "video/mp4", "2026-11-19T10:00:00Z", name = "clip.mp4"),
            doc("report", "application/pdf", "2026-11-18T10:00:00Z", name = "report.pdf"),
        )
    }

    private val app = ReturnScrollApp(ApplicationProvider.getApplicationContext(), world)

    @After fun stop() = app.close()

    // A tile with a picture is described by its name; one without writes the name out.
    private fun named(name: String): SemanticsMatcher =
        hasText(name, substring = true) or hasContentDescription(name, substring = true)

    private fun count(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().size

    private fun showPhotos() {
        compose.setContent { app.Content() }
        compose.runOnUiThread { app.nav.navigate(Routes.PHOTOS) }
        compose.waitUntil(WAIT_MS) {
            shadowOf(Looper.getMainLooper()).idle()
            count(named("clip.mp4")) > 0
        }
    }

    @Test fun `lists photos and videos together and no other files`() {
        showPhotos()
        assertEquals(1, count(named("photo.jpg")))
        assertEquals(1, count(named("clip.mp4")))
        assertEquals(0, count(named("report.pdf")))
    }

    @Test fun `a video opens in the viewer`() {
        showPhotos()
        compose.onNode(named("clip.mp4")).performClick()
        compose.waitForIdle()
        assertEquals(Routes.DOCUMENT, compose.runOnUiThread { app.nav.currentBackStackEntry?.destination?.route })
    }

    private companion object {
        const val WAIT_MS = 10_000L
    }
}
