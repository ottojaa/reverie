package com.reverie.app.ui.screens.upload

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.reverie.app.domain.upload.ContentFinding
import com.reverie.app.domain.upload.describeContent
import com.reverie.app.domain.upload.describeNameConflict
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.theme.ReverieTheme

private val CARD_CORNER = 18.dp

/** One file of the upload list, and under it the decision it needs when the check found something. */
@Composable
internal fun UploadFileRow(
    file: PickedFile,
    finding: ContentFinding?,
    folderName: String,
    uploadAnyway: Boolean,
    onUploadAnyway: (Boolean) -> Unit,
    isFirst: Boolean,
    isLast: Boolean,
) {
    val top = if (isFirst) CARD_CORNER else 0.dp
    val bottom = if (isLast) CARD_CORNER else 0.dp
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(
            Modifier.heightIn(min = 68.dp).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            FileThumbnail(file)
            Column(Modifier.weight(1f)) {
                Text(file.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                FileNotes(file, finding, folderName, uploadAnyway)
            }
        }
        if (finding?.result?.content != null) SkipOrUpload(uploadAnyway, onUploadAnyway)
        if (!isLast) HorizontalDivider(color = MaterialTheme.colorScheme.background)
    }
}

/** The picture of a photo; the file type's name for anything else, or a photo that won't load. */
@Composable
private fun FileThumbnail(file: PickedFile) {
    Box(
        Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            fileTypeLabel(file.mimeType.orEmpty(), file.name),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        if (file.mimeType?.startsWith("image/") == true) {
            AsyncImage(model = file.uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** The line under a file's name: its kind and size, or where it already is and what happens to it. */
@Composable
private fun FileNotes(file: PickedFile, finding: ContentFinding?, folderName: String, uploadAnyway: Boolean) {
    val found = finding?.result?.content?.let { describeContent(it, finding.name) }
    val line = if (found == null) {
        toFileMeta(file)
    } else {
        listOfNotNull(found.label, found.detail, "skipped".takeUnless { uploadAnyway }).joinToString(" · ")
    }
    Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (finding?.result?.name_conflict == true) {
        Text(
            describeNameConflict(folderName, finding.hasContentMatch),
            style = MaterialTheme.typography.bodySmall,
            color = ReverieTheme.extendedColors.warning,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SkipOrUpload(uploadAnyway: Boolean, onUploadAnyway: (Boolean) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 12.dp)) {
        SegmentedButton(
            selected = !uploadAnyway,
            onClick = { onUploadAnyway(false) },
            shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
        ) { Text("Skip") }
        SegmentedButton(
            selected = uploadAnyway,
            onClick = { onUploadAnyway(true) },
            shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
        ) { Text("Upload anyway") }
    }
}
