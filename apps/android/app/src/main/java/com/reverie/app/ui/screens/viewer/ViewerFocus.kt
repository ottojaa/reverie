package com.reverie.app.ui.screens.viewer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.navigation.LocalDiveOrigin
import kotlinx.coroutines.flow.StateFlow

/**
 * The document the viewer is showing, and who it was opened from: [originId] is the viewer route's `from`
 * (see [LocalDiveOrigin]).
 */
data class ViewerFocus(val originId: String, val documentId: String)

/**
 * The document the viewer last showed, for a list to scroll to on return: only on the screen the viewer was
 * opened from. Null on every other screen, even one whose list holds that document too.
 */
@Composable
fun returnedDocumentId(viewerFocus: StateFlow<ViewerFocus?>): String? {
    val focus by viewerFocus.collectAsStateWithLifecycle()
    val here = LocalDiveOrigin.current
    return focus?.takeIf { it.originId == here }?.documentId
}
