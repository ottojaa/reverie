package com.reverie.app.ui.components

import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A folder's thumbnail: a glimpse of what is in it, and a badge that says it is a folder, or a locked one. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class FolderThumbnailTest {
    @get:Rule
    val compose = createComposeRule()

    private val cover = FolderCoverDto(tiles = listOf(FolderCoverTileDto("d", "application/pdf", "deed.pdf")))

    private fun show(locked: Boolean = false, cover: FolderCoverDto? = null) = compose.setContent {
        ReverieTheme { FolderThumbnail(locked, cover, Modifier.testTag("thumbnail")) }
    }

    @Test fun `a folder shows what is in it, under a folder badge past its lower right corner`() {
        show(cover = cover)

        compose.onNodeWithText("PDF", useUnmergedTree = true).assertExists()
        val picture = compose.onNodeWithTag("thumbnail").getUnclippedBoundsInRoot()
        val badge = compose.onNodeWithContentDescription("Folder", useUnmergedTree = true).getUnclippedBoundsInRoot()

        assertEquals(52.dp, picture.right - picture.left)
        assertEquals(picture.right + 5.dp, badge.right)
        assertEquals(picture.bottom + 5.dp, badge.bottom)
        assertEquals(26.dp, badge.right - badge.left)
    }

    @Test fun `an empty folder is a plain tile with the badge`() {
        show(cover = FolderCoverDto(tiles = emptyList()))

        compose.onNodeWithContentDescription("Folder").assertExists()
        compose.onNodeWithText("PDF", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun `a locked folder shows a lock in the badge and nothing of what is in it`() {
        show(locked = true, cover = cover)

        compose.onNodeWithContentDescription("Locked folder").assertExists()
        compose.onNodeWithContentDescription("Folder").assertDoesNotExist()
        compose.onNodeWithText("PDF", useUnmergedTree = true).assertDoesNotExist()
    }
}
