package com.reverie.app.data.repository

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.Paginated

/** What [com.reverie.app.data.processing.ProcessingTracker] reads from the server. */
interface ProcessingDocuments {
    /** A page of the library's still-processing documents, newest first, cached for the grid. */
    suspend fun fetchProcessing(limit: Int, offset: Int): Paginated<DocumentDto>

    /** Re-fetch one document into the cache. */
    suspend fun fetchDocument(id: String): DocumentDto
}
