package com.reverie.app.data.repository

import com.reverie.app.data.local.PrivateDataPurger
import com.reverie.app.data.local.dao.FolderDao
import com.reverie.app.data.local.entity.FolderEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

internal class FakeFolderDao : FolderDao {
    val rows = MutableStateFlow<List<FolderEntity>>(emptyList())
    override fun observeAll(): Flow<List<FolderEntity>> = rows
    override suspend fun getById(id: String): FolderEntity? = rows.value.firstOrNull { it.id == id }
    override suspend fun upsertAll(folders: List<FolderEntity>) {
        val byId = rows.value.associateBy { it.id }.toMutableMap()
        folders.forEach { byId[it.id] = it }
        rows.value = byId.values.toList()
    }
    override suspend fun deleteByIds(ids: List<String>) { rows.value = rows.value.filterNot { it.id in ids } }
    override suspend fun deleteNotIn(keepIds: List<String>) { rows.value = rows.value.filter { it.id in keepIds } }
    override suspend fun clear() { rows.value = emptyList() }
}

internal object NoopPurger : PrivateDataPurger {
    override suspend fun purgeCachedCopies(ids: Collection<String>) {}
    override suspend fun purgeOutsideFolders(publicFolderIds: Collection<String>) {}
    override suspend fun forgetMoved(ids: Collection<String>) {}
    override suspend fun forgetInFolders(folderIds: Collection<String>) {}
    override suspend fun clearSession() {}
}
