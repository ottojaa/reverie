package com.reverie.app.data.api.model

import java.util.Locale

/**
 * The kind a document belongs to, by MIME type alone: a type starting with `image/` is an image,
 * one starting with `video/` a video, everything else (an empty or unknown type too) a file. Mirrors `documentKindOf` in
 * `libs/shared` and the server's `kind` filter; keep the three in step.
 */
enum class DocumentKind(val wire: String) {
    IMAGE("image"),
    VIDEO("video"),
    FILE("file"),
    ;

    companion object {
        fun ofWire(wire: String?): DocumentKind? = entries.firstOrNull { it.wire == wire }

        fun of(mimeType: String): DocumentKind {
            val mime = mimeType.lowercase(Locale.ROOT)
            return when {
                mime.startsWith("image/") -> IMAGE
                mime.startsWith("video/") -> VIDEO
                else -> FILE
            }
        }
    }
}

val DocumentDto.kind: DocumentKind get() = DocumentKind.of(mime_type)
