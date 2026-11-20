package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.reverie.app.data.local.entity.BackupLedgerEntity
import com.reverie.app.data.local.entity.BackupRetryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface BackupDao {

    @Query("SELECT mediaId FROM backup_ledger")
    suspend fun ledgerIds(): List<Long>

    @Query("SELECT mediaId FROM backup_ledger")
    fun observeLedgerIds(): Flow<List<Long>>

    @Query("SELECT * FROM backup_retry")
    suspend fun retries(): List<BackupRetryEntity>

    @Query("SELECT * FROM backup_retry")
    fun observeRetries(): Flow<List<BackupRetryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putLedger(entry: BackupLedgerEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRetry(entry: BackupRetryEntity)

    @Query("DELETE FROM backup_retry WHERE mediaId = :mediaId")
    suspend fun deleteRetry(mediaId: Long)

    @Query("DELETE FROM backup_ledger")
    suspend fun clearLedger()

    @Query("DELETE FROM backup_retry")
    suspend fun clearRetries()

    /** Forgets everything: used when the ledger belongs to another server or account. */
    @Transaction
    suspend fun clearAll() {
        clearLedger()
        clearRetries()
    }

    /** Records [entry] as handled and drops its retry bookkeeping in one step. */
    @Transaction
    suspend fun markHandled(entry: BackupLedgerEntity) {
        putLedger(entry)
        deleteRetry(entry.mediaId)
    }
}
