package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.reverie.app.data.local.entity.DocumentEntity
import kotlinx.coroutines.flow.Flow

/** One cached document's MIME type (see [DocumentDao.mimeTypesInFolder] and [DocumentDao.allMimeTypes]). */
data class DocumentMimeType(val id: String, val mimeType: String)

/** What a cached document knows from its photo or video (see [DocumentDao.photoFactsOf]). */
data class DocumentPhotoFacts(val id: String, val takenAt: String?, val city: String?)

@Dao
interface DocumentDao {

    @Query("SELECT * FROM documents ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE folderId = :folderId ORDER BY createdAt DESC")
    fun observeByFolder(folderId: String): Flow<List<DocumentEntity>>

    /** Cached documents that are in no folder. */
    @Query("SELECT * FROM documents WHERE folderId IS NULL ORDER BY createdAt DESC")
    fun observeTopLevel(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE id = :id")
    fun observeById(id: String): Flow<DocumentEntity?>

    /** Those of [ids] whose thumbnail status is one of [statuses] (stored as JobStatus names). */
    @Query("SELECT id FROM documents WHERE id IN (:ids) AND thumbnailStatus IN (:statuses)")
    fun observeIdsWithThumbnailStatus(ids: List<String>, statuses: List<String>): Flow<List<String>>

    @Query("SELECT * FROM documents WHERE id = :id")
    suspend fun getById(id: String): DocumentEntity?

    @Upsert
    suspend fun upsertAll(documents: List<DocumentEntity>)

    @Query("DELETE FROM documents WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /** Id and MIME type of every cached document: enough to tell which of them are of a given kind. */
    @Query("SELECT id, mimeType FROM documents")
    suspend fun allMimeTypes(): List<DocumentMimeType>

    /** Id and MIME type of every cached document in [folderId]: enough to tell which of them are of a given kind. */
    @Query("SELECT id, mimeType FROM documents WHERE folderId = :folderId")
    suspend fun mimeTypesInFolder(folderId: String): List<DocumentMimeType>

    /** Id and MIME type of every cached document that is in no folder. */
    @Query("SELECT id, mimeType FROM documents WHERE folderId IS NULL")
    suspend fun mimeTypesAtTopLevel(): List<DocumentMimeType>

    /** Cached documents in any of [folderIds]. */
    @Query("SELECT id FROM documents WHERE folderId IN (:folderIds)")
    suspend fun idsInFolders(folderIds: List<String>): List<String>

    /** The date taken and the city of the cached rows among [ids] that have either. */
    @Query("SELECT id, takenAt, city FROM documents WHERE id IN (:ids) AND (takenAt IS NOT NULL OR city IS NOT NULL)")
    suspend fun photoFactsOf(ids: List<String>): List<DocumentPhotoFacts>

    /** Which of [ids] have a cached row (used to detect documents that became private after caching). */
    @Query("SELECT id FROM documents WHERE id IN (:ids)")
    suspend fun existingIds(ids: List<String>): List<String>

    /** The folders the cached documents are in. */
    @Query("SELECT DISTINCT folderId FROM documents WHERE folderId IS NOT NULL")
    suspend fun folderIdsInUse(): List<String>

    @Query("UPDATE documents SET lastAccessedAt = :timestamp WHERE id = :id")
    suspend fun touchLastAccessed(id: String, timestamp: Long)

    @Query("DELETE FROM documents")
    suspend fun clear()
}
