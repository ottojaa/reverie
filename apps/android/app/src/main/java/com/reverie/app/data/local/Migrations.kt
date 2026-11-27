package com.reverie.app.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.io.File

/**
 * v4 -> v5: private documents no longer live on disk.
 *
 * Earlier versions cached every document the API returned, private ones included, and flagged them
 * with `isPrivate`/`locked` columns on `documents`. Privacy now belongs to the folder, and private
 * documents are held in memory only, so this migration:
 *  - deletes the cached original files and `cached_files` rows of every private document,
 *  - deletes those documents' rows (anything flagged private, or sitting in a folder that is
 *    private itself or inside a private parent),
 *  - rebuilds `documents` without the two flag columns,
 *  - removes the old Coil thumbnail directory (it may hold private thumbnails; the image cache now
 *    lives in a differently named directory).
 *
 * Public documents and everything else are kept. [cacheDir] is the app's cache directory.
 */
class Migration4To5(private val cacheDir: File) : Migration(4, 5) {

    override fun migrate(db: SupportSQLiteDatabase) {
        deleteCachedOriginals(db)
        db.execSQL("DELETE FROM cached_files WHERE documentId IN ($PRIVATE_DOCUMENT_IDS)")
        db.execSQL("DELETE FROM documents WHERE id IN ($PRIVATE_DOCUMENT_IDS)")
        rebuildDocumentsWithoutFlags(db)
        File(cacheDir, OLD_THUMBNAIL_DIR).deleteRecursively()
    }

    private fun deleteCachedOriginals(db: SupportSQLiteDatabase) {
        val originals = File(cacheDir, ORIGINALS_DIR)
        db.query("SELECT relativePath FROM cached_files WHERE documentId IN ($PRIVATE_DOCUMENT_IDS)").use { cursor ->
            while (cursor.moveToNext()) File(originals, cursor.getString(0)).delete()
        }
    }

    private fun rebuildDocumentsWithoutFlags(db: SupportSQLiteDatabase) {
        db.execSQL(CREATE_DOCUMENTS_V5)
        db.execSQL("INSERT INTO documents_v5 ($DOCUMENT_COLUMNS) SELECT $DOCUMENT_COLUMNS FROM documents")
        db.execSQL("DROP TABLE documents")
        db.execSQL("ALTER TABLE documents_v5 RENAME TO documents")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_documents_folderId` ON `documents` (`folderId`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_documents_lastAccessedAt` ON `documents` (`lastAccessedAt`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_documents_createdAt` ON `documents` (`createdAt`)")
    }

    companion object {
        // Must stay in step with FileCacheManager / ImageModule's old cache locations.
        private const val ORIGINALS_DIR = "originals"
        private const val OLD_THUMBNAIL_DIR = "coil_thumbs"

        /** Ids of documents that were private in the v4 schema: flagged, or in a private folder/collection. */
        private const val PRIVATE_DOCUMENT_IDS =
            "SELECT id FROM documents WHERE isPrivate = 1 OR locked = 1 OR folderId IN (" +
                "SELECT f.id FROM folders f LEFT JOIN folders p ON p.id = f.parentId " +
                "WHERE f.isPrivate = 1 OR p.isPrivate = 1)"

        private const val DOCUMENT_COLUMNS =
            "id, folderId, originalFilename, mimeType, sizeBytes, width, height, durationSeconds, " +
                "thumbnailBlurhash, documentCategory, extractedDate, ocrStatus, thumbnailStatus, llmStatus, " +
                "llmSummary, llmMetadataJson, llmProcessedAt, llmTokenCount, photoMetadataJson, " +
                "createdAt, updatedAt, cachedAt, lastAccessedAt"

        // Mirrors the `documents` table Room generates for DocumentEntity; Room validates the schema
        // after migrating, so a drift here fails at startup rather than silently.
        private const val CREATE_DOCUMENTS_V5 =
            "CREATE TABLE IF NOT EXISTS `documents_v5` (`id` TEXT NOT NULL, `folderId` TEXT, " +
                "`originalFilename` TEXT NOT NULL, `mimeType` TEXT NOT NULL, `sizeBytes` INTEGER NOT NULL, " +
                "`width` INTEGER, `height` INTEGER, `durationSeconds` REAL, `thumbnailBlurhash` TEXT, " +
                "`documentCategory` TEXT, `extractedDate` TEXT, `ocrStatus` TEXT NOT NULL, " +
                "`thumbnailStatus` TEXT NOT NULL, `llmStatus` TEXT NOT NULL, `llmSummary` TEXT, " +
                "`llmMetadataJson` TEXT, `llmProcessedAt` TEXT, `llmTokenCount` INTEGER, " +
                "`photoMetadataJson` TEXT, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL, " +
                "`cachedAt` INTEGER NOT NULL, `lastAccessedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))"
    }
}

/**
 * v5 -> v6: adds the auto-backup tables. Purely additive: no existing table or row is touched, so
 * the cached library survives the upgrade.
 */
object Migration5To6 : Migration(5, 6) {

    override fun migrate(db: SupportSQLiteDatabase) {
        // Mirror the tables Room generates for BackupLedgerEntity / BackupRetryEntity; Room
        // validates the schema after migrating, so a drift here fails at startup.
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `backup_ledger` (`mediaId` INTEGER NOT NULL, `sha256` TEXT NOT NULL, " +
                "`documentId` TEXT, `outcome` TEXT NOT NULL, `handledAt` INTEGER NOT NULL, PRIMARY KEY(`mediaId`))",
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `backup_retry` (`mediaId` INTEGER NOT NULL, `failures` INTEGER NOT NULL, " +
                "`cutOffs` INTEGER NOT NULL, `nextAttemptAt` INTEGER NOT NULL, `lastError` TEXT, PRIMARY KEY(`mediaId`))",
        )
    }
}

/**
 * v6 -> v7: documents gain `takenAt`, the date taken the Photos and Videos tabs order by. Additive;
 * existing rows start with null (ordered by upload date) until the next fetch fills it in.
 */
object Migration6To7 : Migration(6, 7) {

    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `documents` ADD COLUMN `takenAt` TEXT")
    }
}

/**
 * v8 -> v9: documents gain `city`, where a photo or video was taken, which a folder's list names. Additive;
 * existing rows start with null until the next fetch fills it in.
 */
object Migration8To9 : Migration(8, 9) {

    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `documents` ADD COLUMN `city` TEXT")
    }
}

/**
 * v7 -> v8: folders nest to any depth and documents may sit at the top level.
 *
 * `folders` is only a copy of the server's tree, so it is dropped and made again empty: a row carried
 * over would have no lock id and read as public. The next tree refresh fills it. `upload_tasks` is
 * rebuilt so an upload can have no folder; its rows are kept, because queued uploads point at them.
 * The files of batches that are over are forgotten: version 7 never cleared them, and the upload card
 * counts every file listed.
 */
object Migration7To8 : Migration(7, 8) {

    override fun migrate(db: SupportSQLiteDatabase) {
        replaceFolders(db)
        allowUploadsWithoutFolder(db)
        forgetFinishedUploads(db)
    }

    private fun forgetFinishedUploads(db: SupportSQLiteDatabase) {
        db.execSQL("DELETE FROM upload_items WHERE sessionId NOT IN (SELECT sessionId FROM upload_tasks WHERE status = 'uploading')")
    }

    private fun replaceFolders(db: SupportSQLiteDatabase) {
        db.execSQL("DROP TABLE `folders`")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `folders` (`id` TEXT NOT NULL, `parentId` TEXT, `name` TEXT NOT NULL, " +
                "`path` TEXT NOT NULL, `description` TEXT, `emoji` TEXT, `sortOrder` INTEGER NOT NULL, " +
                "`isPrivate` INTEGER NOT NULL, `lockId` TEXT, `locked` INTEGER NOT NULL, `imageCount` INTEGER NOT NULL, " +
                "`videoCount` INTEGER NOT NULL, `fileCount` INTEGER NOT NULL, `createdAt` TEXT NOT NULL, " +
                "`updatedAt` TEXT NOT NULL, `cachedAt` INTEGER NOT NULL, PRIMARY KEY(`id`))",
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_folders_parentId` ON `folders` (`parentId`)")
    }

    private fun allowUploadsWithoutFolder(db: SupportSQLiteDatabase) {
        val columns = "sessionId, folderId, conflictStrategy, status, createdAt"
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `upload_tasks_v8` (`sessionId` TEXT NOT NULL, `folderId` TEXT, " +
                "`conflictStrategy` TEXT, `status` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, PRIMARY KEY(`sessionId`))",
        )
        db.execSQL("INSERT INTO upload_tasks_v8 ($columns) SELECT $columns FROM upload_tasks")
        db.execSQL("DROP TABLE upload_tasks")
        db.execSQL("ALTER TABLE upload_tasks_v8 RENAME TO upload_tasks")
    }
}
