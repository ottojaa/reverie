package com.reverie.app.data.repository

import com.reverie.app.data.api.ServerUrlProvider
import com.reverie.app.data.api.TrashApi
import com.reverie.app.data.api.model.ThumbnailUrls
import com.reverie.app.data.api.model.TrashListDto
import com.reverie.app.data.api.model.TrashSelectionRequest
import com.reverie.app.di.IoDispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** The trash, always as the server has it: nothing of it is kept on the phone. */
@Singleton
class TrashRepository @Inject constructor(
    private val trashApi: TrashApi,
    private val folders: FolderRepository,
    private val documents: DocumentRepository,
    private val serverUrl: ServerUrlProvider,
    @IoDispatcher private val io: CoroutineDispatcher,
) {
    /** What is in the trash, with thumbnail addresses that can be loaded as they are. */
    suspend fun list(): TrashListDto = withContext(io) {
        val listing = trashApi.list()
        listing.copy(documents = listing.documents.map { it.copy(thumbnail_urls = it.thumbnail_urls?.toAbsolute()) })
    }

    suspend fun restore(selection: TrashSelectionRequest): Unit = withContext(io) {
        trashApi.restore(selection)
        // The restore has happened; folders that cannot be read now arrive with the next refresh.
        runCatching { folders.refresh() }
        documents.announceRestored(selection.document_ids)
    }

    /** Deletes the selected items for good. */
    suspend fun purge(selection: TrashSelectionRequest): Unit = withContext(io) {
        trashApi.purge(selection)
    }

    private fun ThumbnailUrls.toAbsolute() =
        ThumbnailUrls(serverUrl.toAbsolute(sm), serverUrl.toAbsolute(md), serverUrl.toAbsolute(lg))
}
