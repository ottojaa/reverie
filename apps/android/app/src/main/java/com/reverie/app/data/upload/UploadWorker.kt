package com.reverie.app.data.upload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.reverie.app.R
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.UploadApi
import com.reverie.app.data.local.dao.UploadDao
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.File

/**
 * Uploads each staged file in a session with one multipart request apiece (per-file retry
 * and status), running as a foreground `dataSync` service so it survives backgrounding.
 * State lives in Room, so only the session id is passed as worker input.
 */
@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val uploadDao: UploadDao,
    private val uploadApi: UploadApi,
    private val stager: UploadStager,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val sessionId = inputData.getString(UPLOAD_SESSION_KEY) ?: return Result.failure()
        val task = uploadDao.getTask(sessionId) ?: return Result.failure()

        val pending = uploadDao.getItems(sessionId).filter { it.status != "complete" }
        var transientFailure = false

        pending.forEachIndexed { index, item ->
            setForeground(foregroundInfo(index + 1, pending.size))
            uploadDao.updateProgress(item.id, 0, "uploading")
            val file = File(item.stagedPath)
            try {
                val response = uploadApi.uploadFile(
                    sessionId = sessionId,
                    folderId = task.folderId,
                    file = file,
                    filename = item.displayName,
                    mimeType = item.mimeType,
                    conflictStrategy = task.conflictStrategy,
                    onProgress = { _, _ -> },
                )
                val documentId = response.documents.firstOrNull()?.id
                uploadDao.updateItemResult(item.id, "complete", null, documentId)
                file.delete()
            } catch (e: ReverieApiException.Http) {
                uploadDao.updateItemResult(item.id, "failed", e.userMessage(), null)
            } catch (e: ReverieApiException.Auth) {
                uploadDao.updateItemResult(item.id, "failed", e.userMessage(), null)
            } catch (e: Exception) {
                transientFailure = true
                uploadDao.updateItemResult(item.id, "failed", "Upload failed. Will retry.", null)
            }
        }

        if (transientFailure && runAttemptCount < MAX_ATTEMPTS) {
            return Result.retry()
        }

        val items = uploadDao.getItems(sessionId)
        val hasFailure = items.any { it.status == "failed" }
        uploadDao.updateTaskStatus(sessionId, if (hasFailure) "failed" else "complete")
        stager.cleanup(sessionId)
        return Result.success()
    }

    private fun foregroundInfo(current: Int, total: Int): ForegroundInfo {
        ensureChannel()
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("Uploading to Reverie")
            .setContentText("Uploading $current of $total")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setProgress(total, current, false)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Uploads", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    private companion object {
        const val CHANNEL_ID = "reverie_uploads"
        const val NOTIFICATION_ID = 42
        const val MAX_ATTEMPTS = 3
    }
}
