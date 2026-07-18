package com.reverie.app.data.repository

import android.net.Uri
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.local.dao.UploadDao
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.upload.UploadEnqueuer
import com.reverie.app.data.upload.UploadStager
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UploadRepository @Inject constructor(
    private val uploadDao: UploadDao,
    private val documentsApi: DocumentsApi,
    private val stager: UploadStager,
    private val enqueuer: UploadEnqueuer,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** Count of files currently queued/uploading/processing — drives the status pill. */
    fun observeActiveCount(): Flow<Int> = uploadDao.observeActive().map { it.size }

    fun observeItems(sessionId: String): Flow<List<UploadItemEntity>> = uploadDao.observeItems(sessionId)

    suspend fun checkDuplicates(folderId: String, filenames: List<String>): List<String> = withContext(io) {
        runCatching { documentsApi.checkDuplicates(folderId, filenames).duplicates }.getOrDefault(emptyList())
    }

    /** Stage the picked files and enqueue the background upload; returns the session id. */
    suspend fun startUpload(folderId: String, uris: List<Uri>, conflictStrategy: String?): String = withContext(io) {
        val sessionId = UUID.randomUUID().toString()
        val staged = stager.stage(sessionId, uris)
        enqueuer.enqueue(sessionId, folderId, conflictStrategy, staged)
        sessionId
    }

    suspend fun clearCompleted() = withContext(io) { uploadDao.clearCompletedItems() }
}
