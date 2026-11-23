package com.reverie.app.di

import com.reverie.app.data.realtime.DocumentJobEvents
import com.reverie.app.data.realtime.RealtimeManager
import com.reverie.app.data.repository.DocumentRepository
import com.reverie.app.data.repository.ProcessingDocuments
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class ProcessingModule {

    @Binds
    abstract fun bindJobEvents(impl: RealtimeManager): DocumentJobEvents

    @Binds
    abstract fun bindProcessingDocuments(impl: DocumentRepository): ProcessingDocuments
}
