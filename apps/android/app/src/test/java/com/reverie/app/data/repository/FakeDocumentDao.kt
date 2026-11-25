package com.reverie.app.data.repository

import com.reverie.app.data.local.dao.DocumentDao
import com.reverie.app.data.local.dao.DocumentMimeType
import com.reverie.app.data.local.dao.DocumentTakenAt
import com.reverie.app.data.local.entity.DocumentEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

internal class FakeDocumentDao : DocumentDao {
    val rows = MutableStateFlow<List<DocumentEntity>>(emptyList())
    override fun observeAll(): Flow<List<DocumentEntity>> =
        rows.map { list -> list.sortedByDescending { it.createdAt } }
    override fun observeByFolder(folderId: String): Flow<List<DocumentEntity>> =
        rows.map { list -> list.filter { it.folderId == folderId } }
    override fun observeById(id: String): Flow<DocumentEntity?> =
        rows.map { list -> list.firstOrNull { it.id == id } }
    override fun observeIdsAwaitingThumbnail(): Flow<List<String>> =
        rows.map { list -> list.filter { it.thumbnailStatus == "PENDING" || it.thumbnailStatus == "PROCESSING" }.map { it.id } }
    override suspend fun getById(id: String): DocumentEntity? = rows.value.firstOrNull { it.id == id }
    override suspend fun upsertAll(documents: List<DocumentEntity>) {
        val map = rows.value.associateBy { it.id }.toMutableMap()
        documents.forEach { map[it.id] = it }
        rows.value = map.values.toList()
    }
    override suspend fun deleteByIds(ids: List<String>) { rows.value = rows.value.filterNot { it.id in ids } }
    override suspend fun deleteInFolderNotIn(folderId: String, keepIds: List<String>) {
        rows.value = rows.value.filterNot { it.folderId == folderId && it.id !in keepIds }
    }
    override suspend fun allMimeTypes(): List<DocumentMimeType> =
        rows.value.map { DocumentMimeType(it.id, it.mimeType) }
    override suspend fun mimeTypesInFolder(folderId: String): List<DocumentMimeType> =
        rows.value.filter { it.folderId == folderId }.map { DocumentMimeType(it.id, it.mimeType) }
    override suspend fun takenAtOf(ids: List<String>): List<DocumentTakenAt> =
        rows.value.filter { it.id in ids && it.takenAt != null }.map { DocumentTakenAt(it.id, it.takenAt!!) }
    override suspend fun existingIds(ids: List<String>): List<String> =
        rows.value.map { it.id }.filter { it in ids }
    override suspend fun idsOutsideFolders(publicFolderIds: List<String>): List<String> =
        rows.value.filter { it.folderId != null && it.folderId !in publicFolderIds }.map { it.id }
    override suspend fun touchLastAccessed(id: String, timestamp: Long) {}
    override suspend fun clear() { rows.value = emptyList() }
}
