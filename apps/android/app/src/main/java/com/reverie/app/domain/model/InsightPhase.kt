package com.reverie.app.domain.model

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * What the viewer toolbar subtitle should communicate about a document's AI pipeline.
 * Ported from apps/web/.../insight-state.ts — job events carry no job_type, so the
 * (websocket-refetched) document statuses are the source of truth.
 */
sealed interface InsightPhase {
    data object Reading : InsightPhase        // OCR running — "Reading document…"
    data object Writing : InsightPhase        // LLM running/queued — "Writing summary…"
    data class Summary(val summary: String) : InsightPhase
    data class Failed(val stage: Stage) : InsightPhase
    data object Idle : InsightPhase

    enum class Stage { OCR, LLM }
}

fun toInsightPhase(document: DocumentDto): InsightPhase {
    val ocr = document.ocr_status
    val llm = document.llm_status

    if (ocr == JobStatus.PENDING || ocr == JobStatus.PROCESSING) return InsightPhase.Reading
    if (llm == JobStatus.PENDING || llm == JobStatus.PROCESSING) return InsightPhase.Writing
    if (llm == JobStatus.FAILED) return InsightPhase.Failed(InsightPhase.Stage.LLM)

    val summary = document.llm_summary
    if (!summary.isNullOrBlank() && !isFallbackLlmMetadata(document.llm_metadata)) {
        return InsightPhase.Summary(summary)
    }

    if (ocr == JobStatus.FAILED) return InsightPhase.Failed(InsightPhase.Stage.OCR)
    return InsightPhase.Idle
}

/**
 * True when the stored llm_metadata is a fallback record (LLM unavailable): its summary is
 * a truncated OCR preview, not real insights, and must never be presented as AI output.
 */
fun isFallbackLlmMetadata(raw: JsonObject?): Boolean =
    (raw?.get("fallback") as? JsonPrimitive)?.booleanOrNull == true

/** "bank_statement" → "Bank Statement". */
fun formatCategory(category: String): String =
    category.split('_').joinToString(" ") { part ->
        part.replaceFirstChar { it.uppercaseChar() }
    }
