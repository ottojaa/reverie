package com.reverie.app.domain.model

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InsightPhaseTest {

    private fun doc(
        ocr: JobStatus = JobStatus.COMPLETE,
        llm: JobStatus = JobStatus.COMPLETE,
        summary: String? = null,
        fallback: Boolean = false,
    ) = DocumentDto(
        id = "d", folder_id = null, file_path = "", file_hash = "", original_filename = "f",
        mime_type = "application/pdf", size_bytes = 1, width = null, height = null,
        thumbnail_blurhash = null, thumbnail_paths = null, document_category = null, extracted_date = null,
        ocr_status = ocr, thumbnail_status = JobStatus.COMPLETE, llm_status = llm, llm_summary = summary,
        llm_metadata = if (summary != null || fallback) buildJsonObject { if (fallback) put("fallback", true) } else null,
        llm_processed_at = null, llm_token_count = null, is_private = false,
        created_at = "2024-01-01T00:00:00.000Z", updated_at = "2024-01-01T00:00:00.000Z",
    )

    @Test fun `ocr running is Reading`() {
        assertEquals(InsightPhase.Reading, toInsightPhase(doc(ocr = JobStatus.PROCESSING)))
    }

    @Test fun `llm running is Writing`() {
        assertEquals(InsightPhase.Writing, toInsightPhase(doc(llm = JobStatus.PROCESSING)))
    }

    @Test fun `llm failed is Failed llm`() {
        assertEquals(InsightPhase.Failed(InsightPhase.Stage.LLM), toInsightPhase(doc(llm = JobStatus.FAILED)))
    }

    @Test fun `a real summary is Summary`() {
        val phase = toInsightPhase(doc(summary = "A concise summary."))
        assertTrue(phase is InsightPhase.Summary)
        assertEquals("A concise summary.", (phase as InsightPhase.Summary).summary)
    }

    @Test fun `a fallback summary is not surfaced as AI`() {
        // Summary present but metadata is a fallback record → phase falls through to Idle.
        assertEquals(InsightPhase.Idle, toInsightPhase(doc(summary = "OCR preview", fallback = true)))
    }

    @Test fun `ocr failed without a summary is Failed ocr`() {
        assertEquals(InsightPhase.Failed(InsightPhase.Stage.OCR), toInsightPhase(doc(ocr = JobStatus.FAILED)))
    }

    @Test fun `nothing to show is Idle`() {
        assertEquals(InsightPhase.Idle, toInsightPhase(doc()))
    }

    @Test fun `formatCategory title-cases underscored names`() {
        assertEquals("Bank Statement", formatCategory("bank_statement"))
        assertEquals("Receipt", formatCategory("receipt"))
    }

    @Test fun `isFallback detects the fallback flag`() {
        assertTrue(isFallbackLlmMetadata(buildJsonObject { put("fallback", true) }))
        assertFalse(isFallbackLlmMetadata(buildJsonObject { put("title", "x") }))
        assertFalse(isFallbackLlmMetadata(null))
    }
}
