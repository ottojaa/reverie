package com.reverie.app.domain.model

/** A request for a document's thumbnail at a given size — resolved to the JWT-authed endpoint. */
data class ThumbnailRef(
    val documentId: String,
    val size: ThumbnailSize,
)

enum class ThumbnailSize(val wire: String) {
    SM("sm"),
    MD("md"),
    LG("lg"),
}
