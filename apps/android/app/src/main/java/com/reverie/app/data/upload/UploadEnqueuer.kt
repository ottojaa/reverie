package com.reverie.app.data.upload

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.reverie.app.data.local.dao.UploadDao
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.local.entity.UploadTaskEntity
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

const val UPLOAD_SESSION_KEY = "session_id"

@Singleton
class UploadEnqueuer @Inject constructor(
    @ApplicationContext context: Context,
    private val uploadDao: UploadDao,
) {
    private val workManager = WorkManager.getInstance(context)

    suspend fun enqueue(
        sessionId: String,
        folderId: String,
        conflictStrategy: String?,
        staged: List<StagedFile>,
    ) {
        uploadDao.insertTask(
            UploadTaskEntity(
                sessionId = sessionId,
                folderId = folderId,
                conflictStrategy = conflictStrategy,
                status = "uploading",
                createdAt = System.currentTimeMillis(),
            ),
        )
        uploadDao.insertItems(
            staged.map { file ->
                UploadItemEntity(
                    id = file.id,
                    sessionId = sessionId,
                    stagedPath = file.path,
                    displayName = file.displayName,
                    mimeType = file.mimeType,
                    sizeBytes = file.sizeBytes,
                    status = "queued",
                    progress = 0,
                    errorMessage = null,
                    documentId = null,
                )
            },
        )

        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(workDataOf(UPLOAD_SESSION_KEY to sessionId))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()

        workManager.enqueueUniqueWork("upload-$sessionId", ExistingWorkPolicy.KEEP, request)
    }
}
