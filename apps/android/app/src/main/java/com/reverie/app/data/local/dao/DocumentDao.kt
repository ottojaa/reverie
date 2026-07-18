package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.reverie.app.data.local.entity.DocumentEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DocumentDao {

    @Query("SELECT * FROM documents ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE folderId = :folderId ORDER BY createdAt DESC")
    fun observeByFolder(folderId: String): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE id = :id")
    fun observeById(id: String): Flow<DocumentEntity?>

    @Query("SELECT * FROM documents WHERE id = :id")
    suspend fun getById(id: String): DocumentEntity?

    @Upsert
    suspend fun upsertAll(documents: List<DocumentEntity>)

    @Query("DELETE FROM documents WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /** Reconcile a fully-loaded folder: drop cached rows the server no longer returns. */
    @Query("DELETE FROM documents WHERE folderId = :folderId AND id NOT IN (:keepIds)")
    suspend fun deleteInFolderNotIn(folderId: String, keepIds: List<String>)

    @Query("UPDATE documents SET isPrivate = :isPrivate WHERE id IN (:ids)")
    suspend fun setPrivacy(ids: List<String>, isPrivate: Boolean)

    @Query("UPDATE documents SET lastAccessedAt = :timestamp WHERE id = :id")
    suspend fun touchLastAccessed(id: String, timestamp: Long)

    @Query("DELETE FROM documents")
    suspend fun clear()
}
