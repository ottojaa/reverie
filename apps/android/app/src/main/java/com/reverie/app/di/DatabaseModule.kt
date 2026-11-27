package com.reverie.app.di

import android.content.Context
import androidx.room.Room
import com.reverie.app.data.local.Migration4To5
import com.reverie.app.data.local.Migration5To6
import com.reverie.app.data.local.Migration6To7
import com.reverie.app.data.local.Migration7To8
import com.reverie.app.data.local.Migration8To9
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.local.dao.CachedFileDao
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.dao.SearchHistoryDao
import com.reverie.app.data.local.dao.UploadDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): ReverieDatabase =
        Room.databaseBuilder(context, ReverieDatabase::class.java, "reverie.db")
            .addMigrations(Migration4To5(context.cacheDir), Migration5To6, Migration6To7, Migration7To8, Migration8To9)
            // Everything in this database is a cache of the server and can be rebuilt, except the backup
            // ledger (backup_ledger / backup_retry). A schema bump without a migration would wipe it
            // silently; the cost is only re-hashing the albums (the server's content check still skips
            // what it already has), but always add a real migration instead of relying on this.
            .fallbackToDestructiveMigration()
            .build()

    @Provides fun provideDocumentDao(db: ReverieDatabase): DocumentDao = db.documentDao()
    @Provides fun provideFolderDao(db: ReverieDatabase): FolderDao = db.folderDao()
    @Provides fun provideSearchHistoryDao(db: ReverieDatabase): SearchHistoryDao = db.searchHistoryDao()
    @Provides fun provideCachedFileDao(db: ReverieDatabase): CachedFileDao = db.cachedFileDao()
    @Provides fun provideUploadDao(db: ReverieDatabase): UploadDao = db.uploadDao()
    @Provides fun provideBackupDao(db: ReverieDatabase): BackupDao = db.backupDao()
}
