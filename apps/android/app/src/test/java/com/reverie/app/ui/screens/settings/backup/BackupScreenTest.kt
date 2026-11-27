package com.reverie.app.ui.screens.settings.backup

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import com.reverie.app.data.backup.AlbumFolder
import com.reverie.app.data.backup.BackupAlbum
import com.reverie.app.data.backup.BackupSettings
import com.reverie.app.data.backup.INCLUDE_EXISTING
import com.reverie.app.data.backup.MediaAccess
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What tapping the album rows and new-album notices of the backup screen asks for. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h2000dp")
class BackupScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val asked = mutableListOf<String>()

    private val actions = BackupActions(
        onToggleAlbum = { asked += "toggle $it" },
        onPickAlbumFolder = { asked += "folder $it" },
        onResetAlbumFolder = { asked += "reset $it" },
        onBackUpNewAlbum = { asked += "back up $it" },
        onDismissNewAlbum = { asked += "dismiss $it" },
        onDismissNotice = { asked += "dismiss folder notice" },
    )

    private val settings = BackupSettings(
        enabled = true,
        bucketIds = setOf(1L, 2L),
        addedAfter = INCLUDE_EXISTING,
        folderId = "backup",
        albumFolders = mapOf(1L to AlbumFolder("photos", "Photos"), 2L to AlbumFolder("shots", "Screenshots", madeIn = "backup")),
        knownAlbums = setOf(1L, 2L, 3L),
    )

    private val state = BackupUiState(
        settings = settings,
        albums = listOf(
            BackupAlbum(1, "Camera", 30),
            BackupAlbum(2, "Screenshots", 20),
            BackupAlbum(3, "Signal", 10),
            BackupAlbum(4, "Instagram", 12),
        ),
        access = MediaAccess.Full,
        destinations = BackupDestinations(albums = mapOf(1L to "Photos", 2L to "Phone backup › Screenshots")),
    )

    private fun show(shown: BackupUiState = state) = compose.setContent {
        ReverieTheme { BackupSettingsContent(shown, actions) }
    }

    private fun SemanticsNodeInteraction.click() = performSemanticsAction(SemanticsActions.OnClick)

    /** A row reads as one thing to tap: its name, where it goes and its count. */
    private fun row(destination: String) = compose.onNodeWithText(destination)

    private fun checkboxes() = compose.onAllNodes(isToggleable())

    private fun count(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().size

    @Test fun `a ticked row opens the folder picker and an unticked one is ticked`() {
        show()

        row("To Photos").click()
        row("Signal").click()

        assertEquals(listOf("folder 1", "toggle 3"), asked)
    }

    @Test fun `a ticked album is still unticked by its checkbox`() {
        show()

        // The first switch and the Wi-Fi switch come before the album checkboxes.
        checkboxes()[2].click()

        assertEquals(listOf("toggle 1"), asked)
    }

    @Test fun `only an album with a folder of its own can be reset`() {
        show()

        assertEquals(1, count("Reset to default"))
        compose.onNodeWithText("Reset to default").click()

        assertEquals(listOf("reset 1"), asked)
    }

    @Test fun `a new album is announced with both answers`() {
        show()

        compose.onNodeWithText("New album: Instagram, 12 photos — back it up?").assertExists()
        compose.onNodeWithContentDescription("Dismiss").click()
        // "Back up" is also the unticked rows' click label, but only the notice shows it as text.
        compose.onNodeWithText("Back up").click()

        assertEquals(listOf("dismiss 4", "back up 4"), asked)
    }

    @Test fun `the folder notice can only be dismissed`() {
        show(state.copy(settings = settings.copy(folderNotice = "The folder was made again."), albums = state.albums.take(3)))

        compose.onNodeWithText("The folder was made again.").assertExists()
        assertEquals(0, compose.onAllNodes(hasText("Back up")).fetchSemanticsNodes().size)
        compose.onNodeWithContentDescription("Dismiss").click()

        assertEquals(listOf("dismiss folder notice"), asked)
    }
}
