package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.ui.BLURHASHES
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

class ProcessingSheetScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5, renderingMode = SessionParams.RenderingMode.SHRINK)

    @Test fun populated() = paparazzi.snapshot { ProcessingSheetPopulatedPreview() }

    @Test fun loadingMore() = paparazzi.snapshot { ProcessingSheetLoadingMorePreview() }

    @Test fun empty() = paparazzi.snapshot { ProcessingSheetEmptyPreview() }

    @Test fun types() {
        fun row(name: String, mime: String, hash: Int? = null) =
            doc(name, mime, name = name).copy(llm_status = JobStatus.PROCESSING, thumbnail_blurhash = hash?.let { BLURHASHES[it] })
        val documents = listOf(
            row("PXL_20250821_101830.jpg", "image/jpeg", 3),
            row("Record_2026-11-24-00-14-04.mp4", "video/mp4", 2),
            row("Lease agreement – Kalevankatu 12.pdf", "application/pdf", 0),
            row("household-budget-2026.xlsx", "application/vnd.ms-excel", 1),
            row("reverie-1.0.32-release.apk", "application/vnd.android.package-archive"),
            row("holiday-originals.zip", "application/zip"),
            row("bcdr-tabletop-prep.md", "text/markdown"),
            // No picture of it yet.
            row("scan-0042.pdf", "application/pdf"),
        )
        val state = ProcessingSheetState(rows = documents, total = documents.size, isLoading = false)

        paparazzi.snapshotThemes("types") {
            Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
                ProcessingSheetContent(state, onOpenDocument = {}, onLoadMore = {}, Modifier.fillMaxWidth().height(620.dp))
            }
        }
    }
}
