package com.reverie.app.data.upload

import android.content.Context
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.reverie.app.data.backup.ManualUploads
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** Asks WorkManager whether an [UploadWorker] is running; it tags every request with its worker's class name. */
class WorkManagerManualUploads @Inject constructor(
    @ApplicationContext private val context: Context,
) : ManualUploads {
    override suspend fun isRunning(): Boolean = WorkManager.getInstance(context)
        .getWorkInfosByTagFlow(UploadWorker::class.java.name)
        .first()
        .any { it.state == WorkInfo.State.RUNNING }
}
