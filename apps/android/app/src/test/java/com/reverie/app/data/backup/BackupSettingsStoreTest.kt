package com.reverie.app.data.backup

import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.preferencesOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class BackupSettingsStoreTest {
    @get:Rule
    val files = TemporaryFolder()

    /** What the version with one destination folder saved for an install that was backing up. */
    private val singleFolder = arrayOf<Preferences.Pair<*>>(
        BackupKeys.enabled to true,
        BackupKeys.bucketIds to setOf("7", "9"),
        BackupKeys.folderId to "folder-1",
        BackupKeys.folderName to "Camera uploads",
        BackupKeys.lastSuccessAt to 123L,
    )

    @Test fun `an install that was backing up carries on, its folder now the backup folder`() = runTest {
        val old = preferencesOf(*singleFolder)

        assertTrue(BackupSettingsMigration.shouldMigrate(old))
        val settings = toBackupSettings(BackupSettingsMigration.migrate(old))

        assertEquals("folder-1", settings.folderId)
        assertEquals("Camera uploads", settings.folderName)
        assertEquals(setOf(7L, 9L), settings.bucketIds)
        assertEquals(INCLUDE_EXISTING, settings.addedAfter)
        assertEquals(123L, settings.lastSuccessAt)
        assertEquals(BackupConfig(setOf(7L, 9L), INCLUDE_EXISTING), settings.toConfig())
    }

    @Test fun `an install that wasn't backing up is still asked, and keeps its folder`() = runTest {
        val unfinished = listOf(
            preferencesOf(*singleFolder, BackupKeys.enabled to false),
            preferencesOf(*singleFolder, BackupKeys.bucketIds to emptySet<String>()),
            preferencesOf(BackupKeys.enabled to true, BackupKeys.bucketIds to setOf("7")),
        )

        unfinished.forEach { assertNull(toBackupSettings(BackupSettingsMigration.migrate(it)).addedAfter) }
        assertEquals("folder-1", toBackupSettings(BackupSettingsMigration.migrate(unfinished.first())).folderId)
    }

    @Test fun `it happens once, so a folder picked later answers nothing`() = runTest {
        val migrated = BackupSettingsMigration.migrate(preferencesOf())

        assertFalse(BackupSettingsMigration.shouldMigrate(migrated))
    }

    @Test fun `a new install waits for the choice however much else is set`() = runTest {
        val repository = settingsRepository(files)

        repository.setEnabled(true)
        repository.setBuckets(setOf(1L))
        repository.setDestination("folder-1", "Archive")

        assertNull(repository.current().addedAfter)
        assertFalse(repository.current().isReady)
    }

    @Test fun `only new is chosen once, and existing media can be added later`() = runTest {
        val repository = settingsRepository(files)
        repository.setEnabled(true)
        repository.setBuckets(setOf(1L))

        repository.backUpOnlyNew(since = 500)
        repository.backUpOnlyNew(since = 900)
        assertEquals(BackupConfig(setOf(1L), addedAfter = 500), repository.current().toConfig())

        repository.includeExisting()
        assertEquals(INCLUDE_EXISTING, repository.current().addedAfter)
    }
}
