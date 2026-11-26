package com.reverie.app.data.local

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.kind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Process-memory home for documents that live in private folders. They are deliberately never
 * written to Room (see [toEntityOrNull]) so no private metadata survives a process restart; this
 * store is what the grid and viewer read them from while their folder's lock is open.
 *
 * Immutable snapshots in a [StateFlow]: every update swaps the whole map.
 */
@Singleton
class PrivateDocumentStore @Inject constructor() {
    private val state = MutableStateFlow<Map<String, DocumentDto>>(emptyMap())

    val documents: StateFlow<Map<String, DocumentDto>> = state.asStateFlow()

    fun putAll(docs: Collection<DocumentDto>) {
        if (docs.isEmpty()) return
        state.value = state.value + docs.associateBy { it.id }
    }

    fun get(id: String): DocumentDto? = state.value[id]

    fun remove(ids: Collection<String>) {
        val present = ids.filter { it in state.value }
        if (present.isEmpty()) return
        state.value = state.value - present.toSet()
    }

    /**
     * Drop the documents of [folderId] that are not in [keepIds] (the server no longer lists them).
     * Only documents [filter] holds: a listing of some kinds says nothing about the others.
     */
    fun removeInFolderNotIn(folderId: String, keepIds: Set<String>, filter: DocumentFilter = DocumentFilter.ALL) {
        val stale = state.value.values.filter {
            it.folder_id == folderId && it.id !in keepIds && filter.holds(it.kind)
        }
        remove(stale.map { it.id })
    }

    fun clear() {
        state.value = emptyMap()
    }

    fun observeFolder(folderId: String): Flow<List<DocumentDto>> =
        state.map { docs -> docs.values.filter { it.folder_id == folderId } }.distinctUntilChanged()

    fun observe(id: String): Flow<DocumentDto?> = state.map { it[id] }.distinctUntilChanged()
}
