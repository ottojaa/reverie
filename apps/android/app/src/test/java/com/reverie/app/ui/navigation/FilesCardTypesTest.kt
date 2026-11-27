package com.reverie.app.ui.navigation

import android.content.Context
import android.os.Looper
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/** The Library's Files card, read from the server: one block for each type, however far down the list it is. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class FilesCardTypesTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val world = FavouriteWorld()
    private lateinit var app: ReturnScrollApp

    @After fun stop() = app.close()

    private fun blocks(label: String): Int =
        compose.onAllNodesWithTag("file-block:$label", useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun `four newest builds leave room for the older types behind them`() {
        val names = (9 downTo 1).map { "build$it.apk" } + listOf("scan.pdf", "export.zip", "notes.md")
        world.listed = names.mapIndexed { age, name ->
            doc(name, "application/octet-stream", created = "2026-11-${26 - age}T10:00:00Z", name = name)
        }
        app = ReturnScrollApp(context, world)
        compose.setContent { app.Content() }

        compose.waitUntil(10_000) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            listOf("APK", "PDF", "ZIP", "MD").all { blocks(it) == 1 }
        }
    }
}
