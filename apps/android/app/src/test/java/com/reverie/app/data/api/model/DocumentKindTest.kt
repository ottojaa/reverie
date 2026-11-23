package com.reverie.app.data.api.model

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same table as `libs/shared/src/domain/document-kind.test.ts`: keep the two in step. */
class DocumentKindTest {

    private val cases = listOf(
        "image/jpeg" to DocumentKind.IMAGE,
        "IMAGE/JPEG" to DocumentKind.IMAGE,
        "image/svg+xml" to DocumentKind.IMAGE,
        "image/heic" to DocumentKind.IMAGE,
        "video/mp4" to DocumentKind.VIDEO,
        "video/quicktime" to DocumentKind.VIDEO,
        "Video/X-Matroska" to DocumentKind.VIDEO,
        "application/pdf" to DocumentKind.FILE,
        "audio/mpeg" to DocumentKind.FILE,
        "text/markdown" to DocumentKind.FILE,
        "application/zip" to DocumentKind.FILE,
        "application/octet-stream" to DocumentKind.FILE,
        "" to DocumentKind.FILE,
        "image" to DocumentKind.FILE,
        " image/png" to DocumentKind.FILE,
    )

    @Test fun `reads each mime type as its kind`() {
        cases.forEach { (mime, kind) -> assertEquals("kind of '$mime'", kind, DocumentKind.of(mime)) }
    }

    @Test fun `sends the wire name the server expects`() {
        assertEquals(listOf("image", "video", "file"), DocumentKind.entries.map { it.wire })
    }
}
