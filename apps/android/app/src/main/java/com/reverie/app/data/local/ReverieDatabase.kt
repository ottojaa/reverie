package com.reverie.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.local.dao.CachedFileDao
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.dao.SearchHistoryDao
import com.reverie.app.data.local.dao.UploadDao
import com.reverie.app.data.local.entity.BackupLedgerEntity
import com.reverie.app.data.local.entity.BackupRetryEntity
import com.reverie.app.data.local.entity.CachedFileEntity
import com.reverie.app.data.local.entity.DocumentEntity
import com.reverie.app.data.local.entity.FolderEntity
import com.reverie.app.data.local.entity.SearchHistoryEntity
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.local.entity.UploadTaskEntity

@Database(
    entities = [
        DocumentEntity::class,
        FolderEntity::class,
        SearchHistoryEntity::class,
        CachedFileEntity::class,
        UploadTaskEntity::class,
        UploadItemEntity::class,
        BackupLedgerEntity::class,
        BackupRetryEntity::class,
    ],
    // v5: documents lost isPrivate/locked (private documents are never stored; see Migration4To5).
    // v6: adds the auto-backup ledger and retry tables (additive; see Migration5To6).
    // Other version jumps fall back to a destructive rebuild from the network (DatabaseModule).
    // v7: documents gained takenAt, the date taken the Photos and Videos tabs order by (additive; see Migration6To7).
    // v8: folders gained lockId and per-kind counts; uploads may have no folder (see Migration7To8).
    version = 8,
    exportSchema = false,
)
abstract class ReverieDatabase : RoomDatabase() {
    abstract fun documentDao(): DocumentDao
    abstract fun folderDao(): FolderDao
    abstract fun searchHistoryDao(): SearchHistoryDao
    abstract fun cachedFileDao(): CachedFileDao
    abstract fun uploadDao(): UploadDao
    abstract fun backupDao(): BackupDao
}
