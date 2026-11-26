package com.reverie.app.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderWithChildren

/**
 * One folder in a list: its thumbnail, name, [meta] line and a chevron, with a star after the name
 * of a [starred] one. A [selected] row shows a check in the thumbnail's place.
 */
@Composable
fun FolderRow(
    folder: FolderWithChildren,
    cover: FolderCoverDto?,
    meta: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    coverSize: Dp = ROW_PICTURE,
    starred: Boolean = false,
    selected: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    ListRow(selected, onClick, onLongClick, modifier, pictureSize = coverSize) {
        SelectablePicture(selected, coverSize) { FolderThumbnail(folder.locked, cover, size = coverSize) }
        RowText(folder.name, meta, starred)
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(18.dp),
        )
    }
}
