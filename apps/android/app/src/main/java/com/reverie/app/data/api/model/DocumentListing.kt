package com.reverie.app.data.api.model

/** Which documents a listing, a summary or an observation of the cache covers. */
sealed interface DocumentScope {
    /** The whole library, which never includes private documents. */
    data object All : DocumentScope

    /** The documents that are in no folder. */
    data object TopLevel : DocumentScope

    /** One folder's own documents, without those of the folders beneath it. */
    data class Folder(val id: String) : DocumentScope

    companion object {
        /** The place a folder id names, where null means the top level. */
        fun of(folderId: String?): DocumentScope = if (folderId == null) TopLevel else Folder(folderId)
    }
}

/** Which kinds a document listing holds. */
enum class DocumentFilter(private val kinds: Set<DocumentKind>) {
    ALL(setOf(DocumentKind.IMAGE, DocumentKind.VIDEO, DocumentKind.FILE)),

    /** Photos and videos together. */
    MEDIA(setOf(DocumentKind.IMAGE, DocumentKind.VIDEO)),
    IMAGES(setOf(DocumentKind.IMAGE)),
    VIDEOS(setOf(DocumentKind.VIDEO)),
    FILES(setOf(DocumentKind.FILE)),
    ;

    fun holds(kind: DocumentKind): Boolean = kind in kinds

    /** The server orders photos and videos by date taken, and every other listing by upload time. */
    val isByDateTaken: Boolean get() = DocumentKind.FILE !in kinds

    /** The one kind listed; null when the listing mixes kinds. */
    val singleKind: DocumentKind? get() = kinds.singleOrNull()

    companion object {
        fun of(kind: DocumentKind): DocumentFilter = when (kind) {
            DocumentKind.IMAGE -> IMAGES
            DocumentKind.VIDEO -> VIDEOS
            DocumentKind.FILE -> FILES
        }
    }
}
