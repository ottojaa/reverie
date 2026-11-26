package com.reverie.app.ui.screens.viewer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.navigation.LocalDiveOrigin
import com.reverie.app.ui.navigation.sectionOrigin
import kotlinx.coroutines.flow.StateFlow

/**
 * The document the viewer is showing, and who it was opened from: [originId] is the viewer route's `from`
 * (see [LocalDiveOrigin]).
 */
data class ViewerFocus(val originId: String, val documentId: String)

/**
 * The document the viewer last showed, for a list to scroll to on return: only on the screen the viewer was
 * opened from. Null on every other screen, even one whose list holds that document too.
 *
 * @param section the list asking, on a screen that gives its lists origins of their own (see DiveSection).
 */
@Composable
fun returnedDocumentId(viewerFocus: StateFlow<ViewerFocus?>, section: String? = null): String? {
    val focus by viewerFocus.collectAsStateWithLifecycle()
    val screen = LocalDiveOrigin.current
    val here = if (section == null) screen else screen?.let { sectionOrigin(it, section) }
    return focus?.takeIf { it.originId == here }?.documentId
}
