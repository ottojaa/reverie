package com.reverie.app.domain.upload

import com.reverie.app.data.local.entity.UploadItemEntity

/** Where the uploads that haven't been cleared away stand. */
sealed interface UploadProgress {
    /** Batches still being worked on: every file of theirs, finished ones included. */
    data class Running(val items: List<UploadItemEntity>) : UploadProgress

    /** Nothing is running any more. */
    data class Finished(val uploaded: Int, val failed: Int) : UploadProgress
}

/** [items] are every file not yet cleared away; [runningSessions] the batches still being worked on. */
fun toUploadProgress(items: List<UploadItemEntity>, runningSessions: List<String>): UploadProgress? {
    val running = items.filter { it.sessionId in runningSessions }
    if (running.isNotEmpty()) return UploadProgress.Running(running)
    if (items.isEmpty()) return null
    val failed = items.count { it.status == "failed" }
    return UploadProgress.Finished(uploaded = items.size - failed, failed = failed)
}
