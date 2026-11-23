package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.ui.theme.ReverieTheme

private val SAMPLE_FILES = listOf(
    Triple("IMG_20241103_184512.jpg", "image/jpeg", Triple(JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.SKIPPED)),
    Triple("Lease agreement – Kalevankatu 12 (signed).pdf", "application/pdf", Triple(JobStatus.PROCESSING, JobStatus.COMPLETE, JobStatus.SKIPPED)),
    Triple("Q3 budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Triple(JobStatus.COMPLETE, JobStatus.COMPLETE, JobStatus.PROCESSING)),
    Triple("Holiday clip.mp4", "video/mp4", Triple(JobStatus.PENDING, JobStatus.PENDING, JobStatus.SKIPPED)),
    Triple("Meeting notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Triple(JobStatus.COMPLETE, JobStatus.COMPLETE, JobStatus.PENDING)),
    Triple("scan-0042.pdf", "application/pdf", Triple(JobStatus.PENDING, JobStatus.PENDING, JobStatus.SKIPPED)),
    Triple("Receipt – Prisma.jpg", "image/jpeg", Triple(JobStatus.PROCESSING, JobStatus.COMPLETE, JobStatus.SKIPPED)),
    Triple("Passport photo.png", "image/png", Triple(JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.SKIPPED)),
)

private fun sampleRows(): List<DocumentDto> = SAMPLE_FILES.mapIndexed { index, (name, mime, statuses) ->
    DocumentDto(
        id = "sample-$index", file_path = "/sample/$index", file_hash = "h$index", original_filename = name,
        mime_type = mime, size_bytes = 1, ocr_status = statuses.first, thumbnail_status = statuses.second,
        llm_status = statuses.third, is_private = false,
        created_at = "2024-11-03T18:4$index:00Z", updated_at = "2024-11-03T18:4$index:00Z",
    )
}

@Composable
private fun PreviewSheet(state: ProcessingSheetState, height: Int = 620) {
    ReverieTheme {
        Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
            ProcessingSheetContent(
                state = state,
                onOpenDocument = {},
                onLoadMore = {},
                modifier = Modifier.fillMaxWidth().height(height.dp),
            )
        }
    }
}

@Preview(name = "Processing sheet — populated", widthDp = 380, showBackground = true)
@Composable
internal fun ProcessingSheetPopulatedPreview() =
    PreviewSheet(ProcessingSheetState(rows = sampleRows(), total = 8, isLoading = false))

@Preview(name = "Processing sheet — loading more", widthDp = 380, showBackground = true)
@Composable
internal fun ProcessingSheetLoadingMorePreview() =
    PreviewSheet(
        ProcessingSheetState(rows = sampleRows().take(5), total = 200, isLoading = false, isLoadingMore = true),
        height = 470,
    )

@Preview(name = "Processing sheet — empty", widthDp = 380, showBackground = true)
@Composable
internal fun ProcessingSheetEmptyPreview() =
    PreviewSheet(ProcessingSheetState(rows = emptyList(), total = 0, isLoading = false))
