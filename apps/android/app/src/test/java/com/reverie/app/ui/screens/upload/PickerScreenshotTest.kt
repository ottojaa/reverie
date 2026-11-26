package com.reverie.app.ui.screens.upload

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.resources.Density
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.FolderContent
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.local.entity.UploadItemEntity
import com.reverie.app.domain.FolderTree
import com.reverie.app.domain.upload.ContentFinding
import com.reverie.app.domain.upload.UploadProgress
import com.reverie.app.ui.photoCover
import com.reverie.app.ui.screens.destination.DestinationPickerContent
import com.reverie.app.ui.screens.destination.DestinationRules
import com.reverie.app.ui.screens.destination.DestinationState
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

/** The upload screen, the "Select destination" browser and the upload's progress bar, dark and light. */
class PickerScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    private fun file(name: String, mimeType: String, size: Long) = PickedFile(Uri.parse("content://picked/1"), name, mimeType, size)

    private val files = listOf(
        file("IMG_20261106_190112.jpg", "image/jpeg", 3_251_000),
        file("Lease agreement 2026 signed by both parties.pdf", "application/pdf", 245_000),
        file("VID_20261106_174455.mp4", "video/mp4", 48_700_000),
    )

    private fun upload(name: String, state: ReviewState) = paparazzi.snapshotThemes(name) {
        UploadScreenContent(state, onClose = {}, onUpload = {}, onPickLocation = {}, onUploadAnyway = { _, _ -> }, onStrategy = {})
    }

    @Test fun uploadToTheLibrary() = upload("upload_library", ReviewState(files))

    @Test fun uploadWithFindings() = upload(
        "upload_findings",
        ReviewState(
            files,
            folderId = "p",
            folderName = "Portugal – 2025",
            findings = listOf(
                ContentFinding(
                    0, files[0].name,
                    CheckContentResult(name = files[0].name, content = FolderContent(listOf("Photos", "Portugal – 2025"), files[0].name)),
                ),
                ContentFinding(1, files[1].name, CheckContentResult(name = files[1].name, name_conflict = true)),
            ),
        ),
    )

    private fun counted(name: String, parent: String?, images: Int, vararg children: String) =
        node(name, parent, children.map { node(it, name).copy(kind_counts = KindCountsDto(image = 12)) })
            .copy(kind_counts = KindCountsDto(image = images))

    private val tree = FolderTree(
        listOf(
            node("Photos", children = listOf(counted("Portugal – 2025", "Photos", 25, "Lisbon and the coast", "Porto"))),
            counted("Documents and paperwork to sort through later", null, 0),
            node("Private papers", isPrivate = true, locked = true),
        ),
    )
    private val covers = listOf("Photos", "Portugal – 2025", "Lisbon and the coast").associateWith { photoCover(it) }

    private fun destination(name: String, state: DestinationState) = paparazzi.snapshotThemes(name) {
        DestinationPickerContent(state, onOpen = {}, onSearch = {}, onNewFolder = {}, onCancel = {}, onSelect = {})
    }

    @Test fun destinationInAFolder() =
        destination("destination_folder", DestinationState(tree, DestinationRules(), at = "Portugal – 2025", covers = covers))

    @Test fun destinationForBackupAtTheTop() = destination(
        "destination_backup_top",
        DestinationState(tree, DestinationRules(allowPrivate = false, allowTop = false), covers = covers),
    )

    @Test fun destinationSearch() =
        destination("destination_search", DestinationState(tree, DestinationRules(), query = "po", covers = covers))

    /** A 320dp-wide phone. */
    @Test fun destinationNarrow() {
        paparazzi.unsafeUpdateConfig(
            DeviceConfig.PIXEL_5.copy(screenWidth = 640, screenHeight = 1300, xdpi = 320, ydpi = 320, density = Density.XHIGH),
        )
        destination("destination_narrow", DestinationState(tree, DestinationRules(), at = "Portugal – 2025", covers = covers))
    }

    private fun item(id: String, status: String, progress: Int) = UploadItemEntity(
        id = id, sessionId = "s", stagedPath = "/$id", displayName = "$id.jpg", mimeType = "image/jpeg",
        sizeBytes = 3_000_000, status = status, progress = progress, errorMessage = null, documentId = null,
    )

    @Test fun progressBar() = paparazzi.snapshotThemes("upload_progress") { ProgressStates() }

    @Composable
    private fun ProgressStates() {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            UploadProgressCard(
                UploadProgress.Running(listOf(item("a", "complete", 100), item("b", "uploading", 40), item("c", "queued", 0))),
                onDone = {},
            )
            UploadProgressCard(UploadProgress.Finished(uploaded = 3, failed = 0), onDone = {})
            UploadProgressCard(UploadProgress.Finished(uploaded = 1, failed = 2), onDone = {})
        }
    }
}
