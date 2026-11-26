package com.reverie.app.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.local.entity.UploadTaskEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A version 7 database, built as that version declared it, opened by the current one. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class Migration7To8Test {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private var database: ReverieDatabase? = null

    @After fun tearDown() {
        database?.close()
    }

    private fun createVersion7(vararg rows: String) {
        val file = context.getDatabasePath(NAME).apply { parentFile?.mkdirs() }
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            (VERSION_7 + rows).forEach(db::execSQL)
            db.version = 7
        }
    }

    /** No destructive fallback: a migration that leaves the wrong schema fails the open. */
    private fun open(): ReverieDatabase =
        Room.databaseBuilder(context, ReverieDatabase::class.java, NAME)
            .addMigrations(Migration7To8)
            .allowMainThreadQueries()
            .build()
            .also { database = it }

    @Test fun `queued uploads and the backup ledger survive, and the folder cache starts empty`() = runBlocking {
        createVersion7(
            "INSERT INTO upload_tasks VALUES ('s1', 'folder-1', 'replace', 'QUEUED', 7)",
            "INSERT INTO backup_ledger VALUES (42, 'abc', 'doc-1', 'UPLOADED', 7)",
            "INSERT INTO folders VALUES ('folder-1', NULL, 'Old', '/Old', NULL, NULL, 0, 'folder', 1, 0, 3, 'c', 'u', 7)",
        )

        val migrated = open()

        val task = migrated.uploadDao().getTask("s1")!!
        assertEquals(listOf("folder-1", "replace", "QUEUED"), listOf(task.folderId, task.conflictStrategy, task.status))
        assertEquals(emptyList<Any>(), migrated.folderDao().observeAll().first())
        migrated.openHelper.readableDatabase.query("SELECT mediaId FROM backup_ledger").use { cursor ->
            assertEquals(1, cursor.count)
        }
    }

    @Test fun `an upload to the top level can be queued afterwards`() = runBlocking {
        createVersion7()

        val dao = open().uploadDao()
        dao.insertTask(UploadTaskEntity("s2", null, null, "QUEUED", 8))

        assertEquals(null, dao.getTask("s2")!!.folderId)
    }

    private companion object {
        const val NAME = "migration-test.db"

        val VERSION_7 = listOf(
            "CREATE TABLE IF NOT EXISTS `documents` (`id` TEXT NOT NULL, `folderId` TEXT, `originalFilename` TEXT NOT NULL, `mimeType` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, `width` INTEGER, `height` INTEGER, `durationSeconds` REAL, `thumbnailBlurhash` TEXT, `documentCategory` TEXT, `extractedDate` TEXT, `ocrStatus` TEXT NOT NULL, `thumbnailStatus` TEXT NOT NULL, `llmStatus` TEXT NOT NULL, `llmSummary` TEXT, `llmMetadataJson` TEXT, `llmProcessedAt` TEXT, `llmTokenCount` INTEGER, `photoMetadataJson` TEXT, `takenAt` TEXT, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, `cachedAt` INTEGER NOT NULL, `lastAccessedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            "CREATE INDEX IF NOT EXISTS `index_documents_folderId` ON `documents` (`folderId`)",
            "CREATE INDEX IF NOT EXISTS `index_documents_lastAccessedAt` ON `documents` (`lastAccessedAt`)",
            "CREATE INDEX IF NOT EXISTS `index_documents_createdAt` ON `documents` (`createdAt`)",
            "CREATE TABLE IF NOT EXISTS `folders` (`id` TEXT NOT NULL, `parentId` TEXT, `name` TEXT NOT NULL, `path` TEXT NOT NULL, `description` TEXT, `emoji` TEXT, `sortOrder` INTEGER NOT NULL, `type` TEXT NOT NULL, `isPrivate` INTEGER NOT NULL, `locked` INTEGER NOT NULL, `documentCount` INTEGER NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, `cachedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))",
            "CREATE INDEX IF NOT EXISTS `index_folders_parentId` ON `folders` (`parentId`)",
            "CREATE TABLE IF NOT EXISTS `search_history` (`query` TEXT NOT NULL, `lastUsedAt` INTEGER NOT NULL, `useCount` INTEGER NOT NULL, PRIMARY KEY(`query`))",
            "CREATE TABLE IF NOT EXISTS `cached_files` (`documentId` TEXT NOT NULL, `relativePath` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, `mimeType` TEXT NOT NULL, `lastAccessedAt` INTEGER NOT NULL, PRIMARY KEY(`documentId`))",
            "CREATE TABLE IF NOT EXISTS `upload_tasks` (`sessionId` TEXT NOT NULL, `folderId` TEXT NOT NULL, `conflictStrategy` TEXT, `status` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, PRIMARY KEY(`sessionId`))",
            "CREATE TABLE IF NOT EXISTS `upload_items` (`id` TEXT NOT NULL, `sessionId` TEXT NOT NULL, `stagedPath` TEXT NOT NULL, `displayName` TEXT NOT NULL, `mimeType` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, `status` TEXT NOT NULL, `progress` INTEGER NOT NULL, `errorMessage` TEXT, `documentId` TEXT, PRIMARY KEY(`id`))",
            "CREATE INDEX IF NOT EXISTS `index_upload_items_sessionId` ON `upload_items` (`sessionId`)",
            "CREATE TABLE IF NOT EXISTS `backup_ledger` (`mediaId` INTEGER NOT NULL, `sha256` TEXT NOT NULL, `documentId` TEXT, `outcome` TEXT NOT NULL, `handledAt` INTEGER NOT NULL, PRIMARY KEY(`mediaId`))",
            "CREATE TABLE IF NOT EXISTS `backup_retry` (`mediaId` INTEGER NOT NULL, `failures` INTEGER NOT NULL, `cutOffs` INTEGER NOT NULL, `nextAttemptAt` INTEGER NOT NULL, `lastError` TEXT, PRIMARY KEY(`mediaId`))",
            "CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)",
            "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '44e516119c0c9676e59a7ee4fd4ad862')",
        )
    }
}
