package com.reverie.app.data.local

import com.reverie.app.data.image.ThumbnailCachePurger
import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Removes every disk copy of documents that are (or have become) private. Repositories depend on
 * this interface; [DiskPrivateDataPurger] is the real implementation.
 */
interface PrivateDataPurger {
    /** Purge the disk copies of [ids] (only when a cached row proves there may be any). */
    suspend fun purgeCachedCopies(ids: Collection<String>)

    /**
     * Purge cached documents whose folder is not in [publicFolderIds]: private folders, the folders
     * beneath them, and those the tree no longer lists at all (a locked folder lists no children).
     */
    suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>)

    /** Forget moved documents everywhere: they may have landed in (or left) a private folder. */
    suspend fun forgetMoved(ids: Collection<String>)

    /** Forget every document held for [folderIds]: the folders went to the trash. */
    suspend fun forgetInFolders(folderIds: Collection<String>)

    /** Logout: drop the in-memory private documents, transient private originals and decoded thumbnails. */
    suspend fun clearSession()
}

/**
 * Removes every disk copy of documents that are (or have become) private: their Room rows, their
 * cached original files and their cached thumbnails. Private documents are never written to
 * those caches going forward, so this only has to clean up what was cached while the document
 * was still public, e.g. before its folder was made private on another device.
 */
@Singleton
class DiskPrivateDataPurger @Inject constructor(
    private val documentDao: DocumentDao,
    private val store: PrivateDocumentStore,
    private val fileCache: FileCacheManager,
    private val thumbnails: ThumbnailCachePurger,
    @IoDispatcher private val io: CoroutineDispatcher,
) : PrivateDataPurger {
    override suspend fun purgeCachedCopies(ids: Collection<String>) = withContext(io) {
        // Chunked: SQLite caps the number of bound variables in one statement.
        val cached = ids.chunked(QUERY_CHUNK).flatMap { documentDao.existingIds(it) }
        purgeRows(cached)
    }

    private suspend fun purgeRows(cachedIds: List<String>) {
        if (cachedIds.isEmpty()) return
        cachedIds.chunked(QUERY_CHUNK).forEach { documentDao.deleteByIds(it) }
        fileCache.evict(cachedIds)
        thumbnails.remove(cachedIds)
    }

    override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) = withContext(io) {
        purgeRows(documentDao.idsOutsideFolders(publicFolderIds.toList()))
    }

    override suspend fun forgetMoved(ids: Collection<String>) = withContext(io) {
        store.remove(ids)
        purgeCachedCopies(ids)
    }

    override suspend fun forgetInFolders(folderIds: Collection<String>) = withContext(io) {
        val cached = folderIds.chunked(QUERY_CHUNK).flatMap { documentDao.idsInFolders(it) }
        val held = store.documents.value.values.filter { it.folder_id in folderIds }.map { it.id }
        forgetMoved(cached + held)
    }

    override suspend fun clearSession() = withContext(io) {
        store.clear()
        fileCache.clearPrivate()
        thumbnails.clearMemory()
    }

    private companion object {
        const val QUERY_CHUNK = 500
    }
}
