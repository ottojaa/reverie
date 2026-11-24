package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode
import org.junit.Rule
import org.junit.Test

/**
 * The Collections tab as the C boards draw it, from fixtures shaped like them (see CollectionsFixtures).
 * Every state renders dark and light. Blurhashes stand in for thumbnails: a screenshot test has no network.
 * Recorded images sit in src/test/snapshots/images, named `…CollectionsScreenshotTest_<state>_<theme>.png`.
 */
class CollectionsScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 3000))

    private val actions = CollectionsActions()

    private fun both(state: String, content: @Composable () -> Unit) {
        CollectionsFixtures.warmBlurhashes()
        listOf(ThemeMode.DARK to "dark", ThemeMode.LIGHT to "light").forEach { (mode, name) ->
            paparazzi.snapshot("${state}_$name") {
                // Inspection mode makes Coil draw the placeholder (the blurhash) instead of nothing.
                CompositionLocalProvider(LocalInspectionMode provides true) {
                    ReverieTheme(themeMode = mode) { Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) { content() } }
                }
            }
        }
    }

    @Test fun grouped() = both("grouped") {
        CollectionsContent(
            CollectionsFixtures.state(CollectionsFixtures.travel, CollectionsFixtures.code, CollectionsFixtures.apps, CollectionsFixtures.rootFolder),
            actions,
        )
    }

    @Test fun locked() = both("locked") {
        CollectionsContent(CollectionsFixtures.state(CollectionsFixtures.lockedVault, CollectionsFixtures.apps), actions)
    }

    // The server sends no cover for a private folder, open or not: its row shows the folder icon.
    @Test fun privateUnlocked() = both("privateUnlocked") {
        CollectionsContent(CollectionsFixtures.state(CollectionsFixtures.unlockedVault, covers = emptyMap()), actions)
    }

    @Test fun empty() = both("empty") {
        CollectionsContent(CollectionsFixtures.state(CollectionsFixtures.emptyCollection, CollectionsFixtures.apps), actions)
    }

    // The popup itself is a window of its own that a screenshot test does not draw, so the menu's
    // items are drawn in place under the collection they belong to.
    @Test fun menu() = both("menu") {
        Column(Modifier.padding(16.dp)) {
            CollectionSection(CollectionsFixtures.travel, CollectionsFixtures.covers, expanded = false, actions = actions)
            Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp), tonalElevation = 3.dp, shadowElevation = 6.dp, modifier = Modifier.padding(top = 8.dp)) {
                Column(Modifier.padding(vertical = 8.dp)) {
                    RowMenuItems(isPrivate = false, onNewFolder = {}, onEdit = {}, onTogglePrivate = {}, onDelete = {})
                }
            }
        }
    }
}
