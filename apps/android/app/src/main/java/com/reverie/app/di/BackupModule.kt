package com.reverie.app.di

import com.reverie.app.data.backup.BackupMediaSource
import com.reverie.app.data.backup.BackupTransport
import com.reverie.app.data.backup.ManualUploads
import com.reverie.app.data.backup.MediaStoreBackupSource
import com.reverie.app.data.backup.MediaStoreBackupTransport
import com.reverie.app.data.upload.WorkManagerManualUploads
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class BackupModule {
    @Binds abstract fun bindMediaSource(impl: MediaStoreBackupSource): BackupMediaSource
    @Binds abstract fun bindTransport(impl: MediaStoreBackupTransport): BackupTransport
    @Binds abstract fun bindManualUploads(impl: WorkManagerManualUploads): ManualUploads
}
