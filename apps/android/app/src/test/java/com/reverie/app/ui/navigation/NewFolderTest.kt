package com.reverie.app.ui.navigation

import android.os.Looper
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/** Naming a new folder on the Library and on a folder page: one submit makes one folder and closes the sheet. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h1200dp")
class NewFolderTest {
    @get:Rule
    val compose = createComposeRule()

    private val world = FavouriteWorld().apply { tree = listOf(node("Travel")) }
    private val app = ReturnScrollApp(ApplicationProvider.getApplicationContext(), world)

    @After fun stop() = app.close()

    private val nameField = hasText("Name") and hasSetTextAction()

    private fun count(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().size

    private fun await(condition: () -> Boolean) = compose.waitUntil(WAIT_MS) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        condition()
    }

    private fun tap(matcher: SemanticsMatcher) {
        await { count(matcher) > 0 }
        compose.onNode(matcher).performClick()
    }

    private val creations get() = world.requests.filter { it.startsWith("POST folders") }

    /** A click by its action: Robolectric drops some touches on a bottom sheet's window. */
    private fun press(matcher: SemanticsMatcher) {
        await { count(matcher) > 0 }
        compose.onNode(matcher).performSemanticsAction(SemanticsActions.OnClick)
    }

    /** Opens the sheet from the header's add button and types a name into it. */
    private fun nameFolder(addButton: String) {
        tap(hasContentDescription(addButton))
        // The Library page has a "New folder" row of its own; this is the add sheet's.
        press(hasText("New folder") and hasAnyAncestor(isDialog()))
        await { count(nameField) == 1 }
        compose.onNode(nameField).performTextInput("Trips")
    }

    private fun assertMadeOnce(parentId: String?) {
        await { creations.isNotEmpty() && count(hasText("Trips")) > 0 }
        compose.waitForIdle()
        assertEquals("the sheet is still up", 0, count(nameField))
        val body = creations.single().substringAfter("POST folders ")
        val asked = ApiJson.decodeFromString(CreateFolderRequest.serializer(), body)
        assertEquals("Trips" to parentId, asked.name to asked.parent_id)
    }

    private fun showLibrary() = compose.setContent { app.Content() }

    private fun showFolder() {
        showLibrary()
        compose.runOnUiThread { app.nav.navigate(Routes.folder("Travel")) }
    }

    @Test fun `Create on the Library makes the folder at the top and closes the sheet`() {
        showLibrary()
        nameFolder("Upload or new folder")

        press(hasText("Create"))

        assertMadeOnce(parentId = null)
    }

    @Test fun `Create on a folder page makes the folder inside it and closes the sheet`() {
        showFolder()
        nameFolder("Add files or a folder here")

        press(hasText("Create"))

        assertMadeOnce(parentId = "Travel")
    }

    @Test fun `the keyboard's Done key creates the folder and closes the sheet too`() {
        showFolder()
        nameFolder("Add files or a folder here")

        compose.onNode(nameField).performImeAction()

        assertMadeOnce(parentId = "Travel")
    }

    private companion object {
        const val WAIT_MS = 10_000L
    }
}
