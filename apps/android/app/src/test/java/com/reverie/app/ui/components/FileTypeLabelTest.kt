package com.reverie.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as the web's `file-type-label.test.ts`: the two apps must label a file alike. */
class FileTypeLabelTest {

    @Test fun `the extension is the label, in capitals, when it is 4 characters or fewer`() {
        assertEquals("ZIP", fileTypeLabel("application/zip", "backup.zip"))
        assertEquals("ZIP", fileTypeLabel("application/zip", "Backup.ZiP"))
        assertEquals("DOCX", fileTypeLabel("text/markdown", "notes.docx"))
    }

    @Test fun `the last extension of a name with several counts`() {
        assertEquals("GZ", fileTypeLabel("application/gzip", "archive.tar.gz"))
    }

    @Test fun `an extension longer than 4 characters falls back to the MIME type`() {
        assertEquals("TXT", fileTypeLabel("text/markdown", "notes.markdown"))
        assertEquals("FILE", fileTypeLabel("application/octet-stream", "script.javascript"))
    }

    @Test fun `a name without an extension falls back to the MIME type`() {
        assertEquals("PDF", fileTypeLabel("application/pdf", "report"))
        assertEquals("JSON", fileTypeLabel("application/json", "data."))
        assertEquals("TXT", fileTypeLabel("text/plain", "Makefile"))
        assertEquals("FILE", fileTypeLabel("application/octet-stream", "mystery"))
        assertEquals("FILE", fileTypeLabel("", "mystery"))
    }

    @Test fun `a card block, which knows only an extension, is FILE once the extension is long`() {
        assertEquals("APK", fileTypeLabel("", "file.apk"))
        assertEquals("FILE", fileTypeLabel("", "file.markdown"))
    }
}
