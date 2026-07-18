package com.reverie.app.data.repository

import com.reverie.app.data.api.FoldersApi
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.ReorderFolderUpdate
import com.reverie.app.data.api.model.ReorderFoldersRequest
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.flattenToEntities
import com.reverie.app.data.local.toDto
import com.reverie.app.data.local.toTree
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FolderRepository @Inject constructor(
    private val folderDao: FolderDao,
    private val foldersApi: FoldersApi,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** The two-level tree, reassembled from cached rows. */
    fun observeTree(): Flow<List<FolderWithChildren>> =
        folderDao.observeAll().map { it.toTree() }

    /** A single folder (for headers), from cache. */
    fun observeFolder(id: String): Flow<FolderDto?> =
        folderDao.observeAll().map { rows -> rows.firstOrNull { it.id == id }?.toDto() }

    suspend fun refresh() = withContext(io) {
        val tree = foldersApi.tree()
        val entities = tree.flattenToEntities(System.currentTimeMillis())
        folderDao.upsertAll(entities)
        folderDao.deleteNotIn(entities.map { it.id })
    }

    suspend fun create(request: CreateFolderRequest): FolderDto = withContext(io) {
        foldersApi.create(request).also { refresh() }
    }

    suspend fun update(id: String, request: UpdateFolderRequest): FolderDto = withContext(io) {
        foldersApi.update(id, request).also { refresh() }
    }

    suspend fun delete(id: String) = withContext(io) {
        foldersApi.delete(id)
        folderDao.deleteByIds(listOf(id))
    }

    suspend fun reorder(updates: List<ReorderFolderUpdate>) = withContext(io) {
        foldersApi.reorder(ReorderFoldersRequest(updates))
        refresh()
    }
}
