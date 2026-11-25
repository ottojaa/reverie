package com.reverie.app.ui.screens.collections

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Each action the old screen had still fires from the new one, with the node it was tapped on. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w411dp-h2400dp-xxhdpi")
class CollectionsActionsTest {
    @get:Rule
    val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private fun label(prefix: String): (FolderWithChildren) -> Unit = { calls += "$prefix:${it.id}" }

    private val actions = CollectionsActions(
        onOpenFolder = label("open"),
        onUnlock = label("unlock"),
        onToggleExpand = { calls += "toggle:$it" },
        onNewCollection = { calls += "newCollection" },
        onNewFolder = { calls += "newFolder:$it" },
        onEdit = label("edit"),
        onTogglePrivate = label("private"),
        onDelete = label("delete"),
        onOpenAllDocuments = { calls += "allDocuments" },
        onFilterChange = { calls += "filter:$it" },
        onRefresh = { calls += "refresh" },
        onToggleStar = { calls += "favourite:$it" },
    )

    private fun show(vararg tree: FolderWithChildren) {
        compose.setContent { ReverieTheme { CollectionsContent(CollectionsFixtures.state(*tree), actions) } }
    }

    @Test fun `tapping a collection folds it and a folder opens`() {
        show(CollectionsFixtures.travel, CollectionsFixtures.rootFolder)

        compose.onNodeWithText("Travel").performClick()
        compose.onNodeWithText("Iceland 2025").performClick()

        assertEquals(listOf("toggle:c-travel", "open:f-iceland"), calls)
    }

    @Test fun `the header's actions fire`() {
        show(CollectionsFixtures.travel)

        compose.onNodeWithText("All documents").performClick()
        compose.onNodeWithContentDescription("New collection").performClick()

        assertEquals(listOf("allDocuments", "newCollection"), calls)
    }

    @Test fun `filtering reports what was typed`() {
        show(CollectionsFixtures.travel)

        compose.onNodeWithContentDescription("Filter collections").performClick()
        compose.onNodeWithText("Filter collections").performTextInput("ice")

        assertTrue(calls.last().startsWith("filter:"))
    }

    @Test fun `a collection's menu offers favourite, new folder, edit, private and delete`() {
        show(CollectionsFixtures.travel)

        listOf("Add to favourites" to "favourite:c-travel", "New folder" to "newFolder:c-travel", "Edit" to "edit:c-travel", "Make private" to "private:c-travel", "Delete" to "delete:c-travel")
            .forEach { (item, call) ->
                compose.onAllNodesWithContentDescription("Actions").onFirst().performClick()
                compose.onNodeWithText(item).performClick()
                assertEquals(call, calls.last())
            }
    }

    @Test fun `a private unlocked collection offers Remove from private`() {
        show(CollectionsFixtures.unlockedVault)

        compose.onAllNodesWithContentDescription("Actions").onFirst().performClick()
        compose.onNodeWithText("Remove from private").performClick()

        assertEquals(listOf("private:c-vault"), calls)
    }

    @Test fun `a locked collection is one card that unlocks`() {
        show(CollectionsFixtures.lockedVault)

        compose.onNodeWithText("Tap to unlock with your password").performClick()

        assertEquals(listOf("unlock:c-vault"), calls)
    }

    @Test fun `an empty collection offers Add a folder`() {
        show(CollectionsFixtures.emptyCollection)

        compose.onNodeWithText("Add a folder").performClick()

        assertEquals(listOf("newFolder:c-empty"), calls)
    }

    @Test fun `root folders sit under a Folders heading after the collections`() {
        show(CollectionsFixtures.travel, CollectionsFixtures.rootFolder)

        compose.onNodeWithText("Folders").assertExists()
        compose.onNodeWithText("Inbox").performClick()

        assertEquals(listOf("open:f-inbox"), calls)
    }
}
