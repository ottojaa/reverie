package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentKind

/**
 * The lists Browse reads. [ALL] is the dashboard's Recently added stream; the other three are the kind
 * screens (and the dashboard's two picture-card previews). [kind] is what the server is asked for; null lists every kind.
 */
enum class BrowseTab(val label: String, val kind: DocumentKind?) {
    ALL("Recently added", null),
    PHOTOS("Photos", DocumentKind.IMAGE),
    VIDEOS("Videos", DocumentKind.VIDEO),
    FILES("Files", DocumentKind.FILE),
    ;

    companion object {
        /** The tab for [kind]; [ALL] for null. */
        fun of(kind: DocumentKind?): BrowseTab = entries.first { it.kind == kind }
    }
}
