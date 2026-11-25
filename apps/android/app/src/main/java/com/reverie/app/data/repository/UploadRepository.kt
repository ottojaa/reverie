package com.reverie.app.data.repository

import android.net.Uri
import com.reverie.app.data.api.DocumentsApi
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentRequest
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.DocumentScope
import com.reverie.app.data.local.dao.UploadDao
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.upload.ContentHasher
import com.reverie.app.data.upload.HashProgress
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

/** The server's per-call limit for /documents/check-content. */
private const val CHECK_CONTENT_BATCH = 500

/**
 * Asks the server about [files] in as many calls as the per-call limit needs; answers come back in
 * [files]' order. Throws when a call fails (callers decide how to react to the reason).
 */
suspend fun DocumentsApi.checkContentInBatches(scope: DocumentScope, files: List<CheckContentFile>): List<CheckContentResult> =
    files.chunked(CHECK_CONTENT_BATCH).flatMap { batch ->
        val request = CheckContentRequest(
            folder_id = (scope as? DocumentScope.Folder)?.id,
            files = batch,
            top_level = true.takeIf { scope == DocumentScope.TopLevel },
        )
        checkContent(request).results
    }

@Singleton
class UploadRepository @Inject constructor(
    private val uploadDao: UploadDao,
    private val documentsApi: DocumentsApi,
    private val stager: UploadStager,
    private val hasher: ContentHasher,
    private val enqueuer: UploadEnqueuer,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** Count of files currently queued/uploading/processing — drives the status pill. */
    fun observeActiveCount(): Flow<Int> = uploadDao.observeActive().map { it.size }

    fun observeItems(sessionId: String): Flow<List<UploadItemEntity>> = uploadDao.observeItems(sessionId)

    /** SHA-256 of each picked file, read straight from its URI; null for one that can't be read. */
    suspend fun hashContents(uris: List<Uri>, onProgress: (HashProgress) -> Unit): List<String?> = hasher.hashAll(uris, onProgress)

    /**
     * Which of [files]' content is already in the library, and whether each name is taken where they
     * are going ([target]; [DocumentScope.All] names no place and checks content only). Answers come
     * back in [files]' order. Null when the check itself failed, so the caller can carry on without it
     * instead of blocking the upload.
     */
    suspend fun checkContent(target: DocumentScope, files: List<CheckContentFile>): List<CheckContentResult>? = withContext(io) {
        runCatching { documentsApi.checkContentInBatches(target, files) }.getOrNull()
    }

    /** Stage the picked files and enqueue the background upload; returns the session id. */
    suspend fun startUpload(folderId: String?, uris: List<Uri>, conflictStrategy: String?): String = withContext(io) {
        val sessionId = UUID.randomUUID().toString()
        val staged = stager.stage(sessionId, uris)
        enqueuer.enqueue(sessionId, folderId, conflictStrategy, staged)
        sessionId
    }

    suspend fun clearCompleted() = withContext(io) { uploadDao.clearCompletedItems() }
}
