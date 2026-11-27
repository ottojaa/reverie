package com.reverie.app.ui.screens.settings.backup

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import com.reverie.app.data.backup.AlbumBlock
import com.reverie.app.data.backup.AlbumFolder
import com.reverie.app.data.backup.AlbumProblem
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

/** The album rows and new-album notices of the backup screen: what they say and what tapping them asks for. */
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
        onDismissNewAlbum = { asked += "not now $it" },
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

    private fun show(state: BackupUiState = this.state) = compose.setContent {
        ReverieTheme { BackupSettingsContent(state, actions) }
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

    @Test fun `the albums card says a change affects new photos only`() {
        show()

        assertEquals(1, count("Changing it affects new photos only; ones already backed up stay where they are."))
    }

    @Test fun `a new album is announced with both answers`() {
        show()

        compose.onNodeWithText("New album: Instagram, 12 photos — back it up?").assertExists()
        compose.onNodeWithText("Not now").click()
        // "Back up" is also the unticked rows' click label, but only the notice shows it as text.
        compose.onNodeWithText("Back up").click()

        assertEquals(listOf("not now 4", "back up 4"), asked)
    }

    @Test fun `the notice counts videos as videos`() {
        val albums = listOf(BackupAlbum(5, "Clips", 1, videos = 1), BackupAlbum(6, "Trip", 3, videos = 2))
        show(state.copy(albums = albums))

        compose.onNodeWithText("New album: Clips, 1 video — back it up?").assertExists()
        compose.onNodeWithText("New album: Trip, 1 photo and 2 videos — back it up?").assertExists()
    }

    @Test fun `each blocked row says why and the others say nothing`() {
        val problems = mapOf(1L to AlbumBlock("photos", AlbumProblem.Gone), 2L to AlbumBlock("shots", AlbumProblem.Locked))
        show(state.copy(settings = settings.copy(albumProblems = problems)))

        assertEquals(1, count("Not backing up: this folder can't be found. Choose another folder."))
        assertEquals(
            1,
            count("Not backing up: this folder is private and locked. Choose another backup folder, or a folder just for this album."),
        )
        assertEquals(2, count("Not backing up"))
    }

    @Test fun `a locked folder of the album's own asks for another folder`() {
        val problems = mapOf(1L to AlbumBlock("photos", AlbumProblem.Locked))
        show(state.copy(settings = settings.copy(albumProblems = problems)))

        assertEquals(1, count("Not backing up: this folder is private and locked. Choose another folder."))
    }
}
