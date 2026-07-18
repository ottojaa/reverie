package com.reverie.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.reverie.app.data.local.entity.CachedFileEntity

@Dao
interface CachedFileDao {

    @Query("SELECT * FROM cached_files WHERE documentId = :documentId")
    suspend fun get(documentId: String): CachedFileEntity?

    @Upsert
    suspend fun upsert(entry: CachedFileEntity)

    @Query("SELECT COALESCE(SUM(sizeBytes), 0) FROM cached_files")
    suspend fun totalBytes(): Long

    /** Oldest-accessed first — the eviction order for the LRU file cache. */
    @Query("SELECT * FROM cached_files ORDER BY lastAccessedAt ASC")
    suspend fun allByAccessAsc(): List<CachedFileEntity>

    @Query("UPDATE cached_files SET lastAccessedAt = :timestamp WHERE documentId = :documentId")
    suspend fun touch(documentId: String, timestamp: Long)

    @Query("DELETE FROM cached_files WHERE documentId = :documentId")
    suspend fun delete(documentId: String)

    @Query("DELETE FROM cached_files")
    suspend fun clear()
}
