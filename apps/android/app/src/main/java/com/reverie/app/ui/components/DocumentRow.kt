package com.reverie.app.ui.components

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** How big the picture of a folder or document row is. */
val ROW_PICTURE = 52.dp

/**
 * One document in a list: [picture] ([ROW_PICTURE] across; a check takes its place while the row is
 * [selected]) beside the name, with a star after a [starred] one, over a [meta] line. A hold selects.
 */
@Composable
fun DocumentRow(
    name: String,
    meta: String,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    starred: Boolean = false,
    indent: Dp = 0.dp,
    nameOverflow: TextOverflow = TextOverflow.Ellipsis,
    picture: @Composable () -> Unit,
) {
    ListRow(selected, onClick, onLongClick, modifier, indent = indent) {
        SelectablePicture(selected, ROW_PICTURE, picture)
        RowText(name, meta, starred, nameOverflow)
    }
}

/** The shape folder and document rows share: its height, its edges and what a selected one looks like. */
@Composable
internal fun ListRow(
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    pictureSize: Dp = ROW_PICTURE,
    indent: Dp = 0.dp,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .selectedBackground(selected)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick,
                onLongClickLabel = "Select".takeIf { onLongClick != null },
            )
            .heightIn(min = pictureSize + 18.dp)
            .padding(start = 20.dp + indent, end = 20.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

/** A row's name over its meta line, taking the width its picture leaves; an empty [meta] draws no line. */
@Composable
internal fun RowScope.RowText(
    name: String,
    meta: String,
    starred: Boolean,
    nameOverflow: TextOverflow = TextOverflow.Ellipsis,
) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        NameWithStar(
            name,
            starred,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            overflow = nameOverflow,
        )
        if (meta.isEmpty()) return@Column
        Text(
            meta,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
