package com.reverie.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.reverie.app.data.local.dao.CachedFileDao
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.dao.SearchHistoryDao
import com.reverie.app.data.local.dao.UploadDao
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
    ],
    version = 2,
    exportSchema = false,
)
abstract class ReverieDatabase : RoomDatabase() {
    abstract fun documentDao(): DocumentDao
    abstract fun folderDao(): FolderDao
    abstract fun searchHistoryDao(): SearchHistoryDao
    abstract fun cachedFileDao(): CachedFileDao
    abstract fun uploadDao(): UploadDao
}
