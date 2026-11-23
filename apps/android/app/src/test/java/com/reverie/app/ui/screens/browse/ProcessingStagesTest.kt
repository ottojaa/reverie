package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class ProcessingStagesTest {
    private fun doc(ocr: JobStatus, thumbnail: JobStatus, llm: JobStatus) = DocumentDto(
        id = "d", file_path = "/d", file_hash = "h", original_filename = "d.pdf", mime_type = "application/pdf",
        size_bytes = 1, ocr_status = ocr, thumbnail_status = thumbnail, llm_status = llm,
        is_private = false, created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
    )

    @Test fun `a fresh upload lists thumbnail and text recognition`() {
        val stages = processingStages(doc(JobStatus.PENDING, JobStatus.PENDING, JobStatus.SKIPPED))
        assertEquals(listOf("Thumbnail", "Text recognition"), stages)
    }

    @Test fun `only the AI summary is left once the other two finish`() {
        val stages = processingStages(doc(JobStatus.COMPLETE, JobStatus.COMPLETE, JobStatus.PROCESSING))
        assertEquals(listOf("AI summary"), stages)
    }

    @Test fun `failed and skipped stages are not running`() {
        assertEquals(emptyList<String>(), processingStages(doc(JobStatus.FAILED, JobStatus.COMPLETE, JobStatus.SKIPPED)))
    }

    @Test fun `no stage is ever called OCR or LLM`() {
        val all = processingStages(doc(JobStatus.PENDING, JobStatus.PENDING, JobStatus.PENDING))
        assertEquals(listOf("Thumbnail", "Text recognition", "AI summary"), all)
    }

    @Test fun `the title says how many, singular for one and plain when none`() {
        assertEquals("12 files processing", processingTitle(12))
        assertEquals("1 file processing", processingTitle(1))
        assertEquals("No files processing", processingTitle(0))
    }
}
