package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.reverie.app.data.local.entity.DocumentEntity
import kotlinx.coroutines.flow.Flow

/** One cached document's MIME type (see [DocumentDao.mimeTypesInFolder] and [DocumentDao.allMimeTypes]). */
data class DocumentMimeType(val id: String, val mimeType: String)

/** One cached document's date taken (see [DocumentDao.takenAtOf]). */
data class DocumentTakenAt(val id: String, val takenAt: String)

@Dao
interface DocumentDao {

    @Query("SELECT * FROM documents ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE folderId = :folderId ORDER BY createdAt DESC")
    fun observeByFolder(folderId: String): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE id = :id")
    fun observeById(id: String): Flow<DocumentEntity?>

    // Statuses are stored as JobStatus names; these two are the unfinished ones.
    @Query("SELECT id FROM documents WHERE thumbnailStatus IN ('PENDING', 'PROCESSING')")
    fun observeIdsAwaitingThumbnail(): Flow<List<String>>

    @Query("SELECT * FROM documents WHERE id = :id")
    suspend fun getById(id: String): DocumentEntity?

    @Upsert
    suspend fun upsertAll(documents: List<DocumentEntity>)

    @Query("DELETE FROM documents WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /** Reconcile a fully-loaded folder: drop cached rows the server no longer returns. */
    @Query("DELETE FROM documents WHERE folderId = :folderId AND id NOT IN (:keepIds)")
    suspend fun deleteInFolderNotIn(folderId: String, keepIds: List<String>)

    /** Id and MIME type of every cached document: enough to tell which of them are of a given kind. */
    @Query("SELECT id, mimeType FROM documents")
    suspend fun allMimeTypes(): List<DocumentMimeType>

    /** Id and MIME type of every cached document in [folderId]: enough to tell which of them are of a given kind. */
    @Query("SELECT id, mimeType FROM documents WHERE folderId = :folderId")
    suspend fun mimeTypesInFolder(folderId: String): List<DocumentMimeType>

    /** The date taken of the cached rows among [ids] that have one. */
    @Query("SELECT id, takenAt FROM documents WHERE id IN (:ids) AND takenAt IS NOT NULL")
    suspend fun takenAtOf(ids: List<String>): List<DocumentTakenAt>

    /** Which of [ids] have a cached row (used to detect documents that became private after caching). */
    @Query("SELECT id FROM documents WHERE id IN (:ids)")
    suspend fun existingIds(ids: List<String>): List<String>

    /** Cached documents whose folder is not one of the known-public [publicFolderIds]. */
    @Query("SELECT id FROM documents WHERE folderId IS NOT NULL AND folderId NOT IN (:publicFolderIds)")
    suspend fun idsOutsideFolders(publicFolderIds: List<String>): List<String>

    @Query("UPDATE documents SET lastAccessedAt = :timestamp WHERE id = :id")
    suspend fun touchLastAccessed(id: String, timestamp: Long)

    @Query("DELETE FROM documents")
    suspend fun clear()
}
