package com.reverie.app.ui.navigation

import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.model.QuickFilter
import com.reverie.app.data.settings.SettingsRepository
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The real Library, with its view model and the settings on disk: the chips' order outlives the screen. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class ShortcutOrderTest {
    @get:Rule
    val compose = createComposeRule()

    private val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
    private lateinit var app: ReturnScrollApp
    private var screen by mutableIntStateOf(0)

    private val labels = listOf("Favourites", "Receipts", "Trash")

    @Before fun start() {
        save(emptyList())
        app = ReturnScrollApp(ApplicationProvider.getApplicationContext(), FavouriteWorld())
        app.quickFilters = listOf(QuickFilter("receipts", "Receipts", "q", count = 3))
    }

    @After fun stop() = app.close()

    private fun save(order: List<String>) = runBlocking { settings.updateShortcutOrder { order } }

    private fun show() {
        compose.setContent { key(screen) { app.Content() } }
        await("Receipts")
    }

    private fun await(text: String) = compose.waitUntil(5_000) {
        shadowOf(Looper.getMainLooper()).idle()
        compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun stripOrder() = labels.sortedBy { compose.onNodeWithText(it).getUnclippedBoundsInRoot().left }

    private fun awaitStrip(expected: List<String>) {
        runCatching {
            compose.waitUntil(5_000) {
                shadowOf(Looper.getMainLooper()).idle()
                stripOrder() == expected
            }
        }
        assertEquals(expected, stripOrder())
    }

    @Test fun `an order chosen in the sheet is there when the screen is made again`() {
        show()
        compose.onNodeWithContentDescription("Reorder shortcuts").performScrollTo().performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasContentDescription("Move Trash")).fetchSemanticsNodes().isNotEmpty()
        }
        val up = compose.onNodeWithContentDescription("Move Trash").fetchSemanticsNode()
            .config[SemanticsActions.CustomActions].single { it.label == "Move up" }
        compose.runOnUiThread { up.action() }
        // Not a touch: Robolectric delivers none to a bottom sheet's window.
        compose.onNodeWithText("Done").performSemanticsAction(SemanticsActions.OnClick)
        await("Receipts")
        compose.waitUntil(5_000) {
            shadowOf(Looper.getMainLooper()).idle()
            compose.onAllNodes(hasContentDescription("Move Trash")).fetchSemanticsNodes().isEmpty()
        }
        awaitStrip(listOf("Favourites", "Trash", "Receipts"))

        screen++
        compose.waitForIdle()
        await("Receipts")

        awaitStrip(listOf("Favourites", "Trash", "Receipts"))
    }

    @Test fun `an order saved before is shown, with a chip it does not name at the end`() {
        // As saved by a version of the app without Receipts.
        save(listOf("trash", "favourites"))

        show()

        awaitStrip(listOf("Trash", "Favourites", "Receipts"))
    }
}
