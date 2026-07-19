package com.reverie.app.ui.screens.viewer

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The ordered run of documents the viewer can swipe through, handed off from whichever screen
 * opened the viewer (Browse or Search). [ids] stays live so the pager grows as the origin
 * paginates; [initialIds] is the synchronous snapshot at open time so the pager can pick the
 * correct start page on its very first frame (before [ids] emits).
 */
class DocumentSequence(
    val initialIds: List<String>,
    val ids: Flow<List<String>>,
    /** Ask the origin to fetch its next page. Safe to call spuriously — origins guard/ignore it. */
    val loadMore: () -> Unit,
)

/**
 * App-scoped hand-off for the "swipe between documents" sequence. Only one viewer is open at a
 * time, so a single current sequence is the right granularity. The origin screen fills this in at
 * tap time; the viewer reads it. It is deliberately null after process death → the viewer falls
 * back to a single-document pager built from the route id.
 */
@Singleton
class DocumentSequenceHolder @Inject constructor() {

    @Volatile
    var current: DocumentSequence? = null
        private set

    /** The document the viewer is currently showing, so the origin grid can scroll to it on return. */
    private val _focused = MutableStateFlow<String?>(null)
    val focused: StateFlow<String?> = _focused.asStateFlow()

    fun set(sequence: DocumentSequence) {
        current = sequence
    }

    fun setFocused(id: String?) {
        _focused.value = id
    }

    fun clear() {
        current = null
    }
}
