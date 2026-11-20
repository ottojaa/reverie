package com.reverie.app.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One MediaStore item that auto-backup has dealt with, keyed by its `MediaStore.Files` `_ID`.
 * [outcome] is [OUTCOME_UPLOADED] (it became [documentId]) or [OUTCOME_SKIPPED] (its content was
 * already in the library, so nothing was uploaded). A file that failed is never in here, so the
 * next scan finds it again.
 */
@Entity(tableName = "backup_ledger")
data class BackupLedgerEntity(
    @PrimaryKey val mediaId: Long,
    val sha256: String,
    val documentId: String?,
    val outcome: String,
    val handledAt: Long,
) {
    companion object {
        const val OUTCOME_UPLOADED = "uploaded"
        const val OUTCOME_SKIPPED = "skipped"
    }
}

/**
 * Bookkeeping for a file that has not finished backing up: how often it failed, when it may be
 * tried again, and how often a run was cut off while it was uploading alone. Removed once the
 * file reaches the ledger.
 */
@Entity(tableName = "backup_retry")
data class BackupRetryEntity(
    @PrimaryKey val mediaId: Long,
    val failures: Int,
    val cutOffs: Int,
    val nextAttemptAt: Long,
    val lastError: String?,
)
