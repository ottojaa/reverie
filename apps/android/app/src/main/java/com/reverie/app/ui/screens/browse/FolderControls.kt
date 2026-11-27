package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentSort
import com.reverie.app.data.settings.FolderView

private val DocumentSort.label: String
    get() = when (this) {
        DocumentSort.NEWEST -> "Newest first"
        DocumentSort.NAME -> "Name"
        DocumentSort.SIZE -> "Size"
    }

/** An arrow beside lines of falling length, which the Material icon set has no equivalent of. */
private val SortArrow: ImageVector by lazy {
    ImageVector.Builder("SortArrow", 24.dp, 24.dp, 24f, 24f, autoMirror = true).addPath(
        pathData = PathParser().parsePathString("M7 4v16M3 16l4 4 4-4M14 6h7M14 12h5M14 18h3").toNodes(),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
    ).build()
}

/** Above a folder's content: what its documents are ordered by, and the button that draws it the other way. */
@Composable
internal fun FolderControls(
    sort: DocumentSort,
    view: FolderView,
    onSort: (DocumentSort) -> Unit,
    onShowAs: (FolderView) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SortButton(sort, onSort)
        val isGrid = view == FolderView.GRID
        IconButton(onClick = { onShowAs(if (isGrid) FolderView.LIST else FolderView.GRID) }) {
            Icon(
                if (isGrid) Icons.AutoMirrored.Outlined.FormatListBulleted else Icons.Outlined.GridView,
                contentDescription = if (isGrid) "Show as list" else "Show as grid",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun SortButton(sort: DocumentSort, onSort: (DocumentSort) -> Unit) {
    var isOpen by remember { mutableStateOf(false) }
    // The menu anchors to the Box around its button.
    Box {
        OutlinedButton(
            onClick = { isOpen = true },
            modifier = Modifier.height(36.dp),
            shape = CircleShape,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
            contentPadding = PaddingValues(horizontal = 12.dp),
        ) {
            Icon(SortArrow, contentDescription = null, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text(sort.label, fontSize = 13.sp)
        }
        DropdownMenu(expanded = isOpen, onDismissRequest = { isOpen = false }) {
            DocumentSort.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    trailingIcon = { if (option == sort) Icon(Icons.Outlined.Check, contentDescription = null) },
                    onClick = { isOpen = false; onSort(option) },
                    modifier = Modifier.semantics { selected = option == sort },
                )
            }
        }
    }
}
