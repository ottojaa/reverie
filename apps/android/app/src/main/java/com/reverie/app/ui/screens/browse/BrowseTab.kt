package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentKind

/** The four views of Browse. [kind] is what the server is asked for; null lists every kind. */
enum class BrowseTab(val label: String, val kind: DocumentKind?) {
    ALL("All", null),
    PHOTOS("Photos", DocumentKind.IMAGE),
    VIDEOS("Videos", DocumentKind.VIDEO),
    FILES("Files", DocumentKind.FILE),
    ;

    companion object {
        /** The tab saved under [name], or [ALL] for the first launch and for a name this build doesn't know. */
        fun fromSaved(name: String?): BrowseTab = entries.firstOrNull { it.name == name } ?: ALL
    }
}
