package com.reverie.app.domain.search

/** What a search looks in. */
sealed interface SearchScope {
    /** The folder the search stays inside, when it is narrowed to one. */
    val folderId: String? get() = null

    /** Only photos and videos match. */
    val isMediaOnly: Boolean get() = false

    data object Library : SearchScope

    /** Photos and videos, wherever they are. */
    data object Media : SearchScope {
        override val isMediaOnly = true
    }

    /** One folder and everything beneath it. */
    data class Folder(override val folderId: String) : SearchScope
}
