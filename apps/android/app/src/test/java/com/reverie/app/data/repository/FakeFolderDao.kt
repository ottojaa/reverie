package com.reverie.app.data.repository

import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.entity.FolderEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

internal class FakeFolderDao : FolderDao {
    val rows = MutableStateFlow<List<FolderEntity>>(emptyList())
    override fun observeAll(): Flow<List<FolderEntity>> = rows
    override suspend fun getById(id: String): FolderEntity? = rows.value.firstOrNull { it.id == id }
    override suspend fun upsertAll(folders: List<FolderEntity>) {
        rows.update { current -> (current.associateBy { it.id } + folders.associateBy { it.id }).values.toList() }
    }
    override suspend fun deleteByIds(ids: List<String>) { rows.update { current -> current.filterNot { it.id in ids } } }
    override suspend fun allIds(): List<String> = rows.value.map { it.id }
    override suspend fun clear() { rows.value = emptyList() }
}

internal object NoopPurger : PrivateDataPurger {
    override suspend fun purgeCachedCopies(ids: Collection<String>) {}
    override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) {}
    override suspend fun forgetMoved(ids: Collection<String>) {}
    override suspend fun forgetInFolders(folderIds: Collection<String>) {}
    override suspend fun clearSession() {}
}
