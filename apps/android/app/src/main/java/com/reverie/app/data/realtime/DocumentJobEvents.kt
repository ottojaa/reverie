package com.reverie.app.data.realtime

import com.reverie.app.data.api.model.JobEventDto
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The slice of the realtime socket that document processing tracking needs. [RealtimeManager] is
 * the production implementation; the interface keeps the tracker testable without Android.
 */
interface DocumentJobEvents {
    /** Job events for the document rooms currently subscribed. */
    val events: SharedFlow<JobEventDto>

    /** True while the socket is connected. Rooms are only joined once this is true. */
    val connected: StateFlow<Boolean>

    /** True while the app is in the foreground (the socket is torn down in the background). */
    val foregrounded: StateFlow<Boolean>

    /** Join a document's room. Closing the handle leaves it; handles are refcounted per document. */
    suspend fun subscribeDocument(documentId: String): AutoCloseable
}
