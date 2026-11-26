package com.reverie.app.domain.upload

import com.reverie.app.data.local.entity.UploadItemEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UploadProgressTest {

    private fun item(id: String, session: String, status: String) = UploadItemEntity(
        id = id, sessionId = session, stagedPath = "/$id", displayName = id, mimeType = "image/jpeg",
        sizeBytes = 1, status = status, progress = 0, errorMessage = null, documentId = null,
    )

    @Test fun `nothing to report without files`() {
        assertNull(toUploadProgress(emptyList(), emptyList()))
    }

    @Test fun `a running batch shows all of its files, and none of a finished one`() {
        val done = item("old", "first", "complete")
        val sent = item("sent", "second", "complete")
        val waiting = item("waiting", "second", "queued")

        val progress = toUploadProgress(listOf(done, sent, waiting), listOf("second"))

        assertEquals(UploadProgress.Running(listOf(sent, waiting)), progress)
    }

    @Test fun `a failed file of a batch that is still being retried is not reported as failed yet`() {
        val failed = item("a", "only", "failed")

        assertEquals(UploadProgress.Running(listOf(failed)), toUploadProgress(listOf(failed), listOf("only")))
    }

    @Test fun `once nothing runs, uploads and failures are counted`() {
        val items = listOf(item("a", "s", "complete"), item("b", "s", "failed"), item("c", "t", "complete"))

        assertEquals(UploadProgress.Finished(uploaded = 2, failed = 1), toUploadProgress(items, emptyList()))
    }
}
