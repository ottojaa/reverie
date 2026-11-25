package com.reverie.app.domain.search

/** What a search looks in. */
sealed interface SearchScope {
    data object Library : SearchScope

    /** Photos and videos, wherever they are. */
    data object Media : SearchScope

    /** One folder and everything beneath it. */
    data class Folder(val id: String) : SearchScope
}
