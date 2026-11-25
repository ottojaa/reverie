package com.reverie.app.data.settings

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SettingsRepositoryTest {

    @Test fun `folders open as cards until list is chosen, and the choice is remembered for every folder`() = runBlocking {
        val inFirstFolder = SettingsRepository(ApplicationProvider.getApplicationContext())
        assertEquals(FolderViewMode.GRID, inFirstFolder.settings.first().folderViewMode)

        inFirstFolder.setFolderViewMode(FolderViewMode.LIST)

        // Another folder's page, reading the same device settings.
        val inNextFolder = SettingsRepository(ApplicationProvider.getApplicationContext())
        assertEquals(FolderViewMode.LIST, inNextFolder.settings.first().folderViewMode)
    }
}
