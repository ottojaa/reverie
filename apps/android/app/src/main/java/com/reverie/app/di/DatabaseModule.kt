package com.reverie.app.di

import android.content.Context
import androidx.room.Room
import com.reverie.app.data.local.ReverieDatabase
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
            .fallbackToDestructiveMigration()
            .build()

    @Provides fun provideDocumentDao(db: ReverieDatabase): DocumentDao = db.documentDao()
    @Provides fun provideFolderDao(db: ReverieDatabase): FolderDao = db.folderDao()
    @Provides fun provideSearchHistoryDao(db: ReverieDatabase): SearchHistoryDao = db.searchHistoryDao()
    @Provides fun provideCachedFileDao(db: ReverieDatabase): CachedFileDao = db.cachedFileDao()
    @Provides fun provideUploadDao(db: ReverieDatabase): UploadDao = db.uploadDao()
}
