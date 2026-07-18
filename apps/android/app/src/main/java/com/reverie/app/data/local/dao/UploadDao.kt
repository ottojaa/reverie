package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.data.local.entity.UploadTaskEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface UploadDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTask(task: UploadTaskEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<UploadItemEntity>)

    @Query("SELECT * FROM upload_tasks WHERE sessionId = :sessionId")
    suspend fun getTask(sessionId: String): UploadTaskEntity?

    @Query("SELECT * FROM upload_items WHERE sessionId = :sessionId")
    suspend fun getItems(sessionId: String): List<UploadItemEntity>

    @Query("SELECT * FROM upload_items WHERE sessionId = :sessionId ORDER BY displayName ASC")
    fun observeItems(sessionId: String): Flow<List<UploadItemEntity>>

    @Query("SELECT * FROM upload_items WHERE status IN ('queued', 'uploading', 'processing')")
    fun observeActive(): Flow<List<UploadItemEntity>>

    @Query("UPDATE upload_items SET progress = :progress, status = :status WHERE id = :id")
    suspend fun updateProgress(id: String, progress: Int, status: String)

    @Query("UPDATE upload_items SET status = :status, errorMessage = :error, documentId = :documentId WHERE id = :id")
    suspend fun updateItemResult(id: String, status: String, error: String?, documentId: String?)

    @Query("UPDATE upload_tasks SET status = :status WHERE sessionId = :sessionId")
    suspend fun updateTaskStatus(sessionId: String, status: String)

    @Query("DELETE FROM upload_items WHERE status = 'complete'")
    suspend fun clearCompletedItems()

    @Query("DELETE FROM upload_tasks WHERE sessionId = :sessionId")
    suspend fun deleteTask(sessionId: String)
}
