package com.reverie.app.domain.search

import com.reverie.app.data.api.model.DocumentKind

/** What a search looks in. */
sealed interface SearchScope {
    /** The folder the search stays inside, when it is narrowed to one. */
    val folderId: String? get() = null

    /** The one kind of document that matches, when the search is narrowed to one. */
    val kind: DocumentKind? get() = null

    data object Library : SearchScope

    /** The documents of one kind, wherever they are. */
    data class Kind(override val kind: DocumentKind) : SearchScope

    /** One folder and everything beneath it. */
    data class Folder(override val folderId: String) : SearchScope
}
