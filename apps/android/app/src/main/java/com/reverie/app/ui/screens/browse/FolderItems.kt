package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.settings.FolderView
import com.reverie.app.domain.folderMeta
import com.reverie.app.ui.components.DocumentRow
import com.reverie.app.ui.components.FolderRow
import com.reverie.app.ui.components.FolderThumbnail
import com.reverie.app.ui.components.NameWithStar
import com.reverie.app.ui.components.SelectablePicture
import com.reverie.app.ui.components.selectedBackground
import com.reverie.app.ui.navigation.documentSharedBounds

private val TILE_EDGE = 20.dp
private val TILE_GAP = 8.dp
private const val TILE_AIM = 130f

/** How many folder tiles stand abreast on a page [width] dp wide. */
fun folderColumns(width: Float): Int = maxOf(3, (width / TILE_AIM).toInt())

/** How many items of the page's list its folders take: one each in a list, one per line of tiles in a grid. */
fun folderLineCount(state: FolderState, columns: Int): Int = when (state.view) {
    null -> 0
    FolderView.LIST -> state.children.size
    FolderView.GRID -> (state.children.size + columns - 1) / columns
}

/** The folders inside the page's folder, drawn the way the page is; nothing before that is decided. */
internal fun LazyListScope.folderItems(state: FolderState, links: FolderLinks, columns: Int, width: Dp) {
    when (state.view) {
        null -> Unit
        FolderView.LIST -> items(state.children, key = { "folder:" + it.id }, contentType = { "folder" }) { folder ->
            FolderRow(
                folder = folder,
                cover = links.covers[folder.id],
                meta = folderMeta(folder),
                onClick = { links.selection.tap(folder.id) { links.onOpen(folder.id) } },
                onLongClick = { links.selection.toggle(folder.id) },
                selected = folder.id in links.selection,
                starred = folder.id in links.starredIds,
            )
        }
        FolderView.GRID -> {
            val tile = (width - TILE_EDGE * 2 - TILE_GAP * (columns - 1)) / columns
            val lines = state.children.chunked(columns)
            items(lines, key = { "folders:" + it.first().id }, contentType = { "folders" }) { line ->
                FolderTileLine(line, links, tile)
            }
        }
    }
}

@Composable
private fun FolderTileLine(folders: List<FolderWithChildren>, links: FolderLinks, width: Dp) {
    Row(
        Modifier.fillMaxWidth().padding(start = TILE_EDGE, end = TILE_EDGE, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(TILE_GAP),
    ) {
        folders.forEach { FolderTile(it, links, width) }
    }
}

/** A folder above a grid: its thumbnail over its name. A tap opens it and a hold selects it, as its row does. */
@Composable
private fun FolderTile(folder: FolderWithChildren, links: FolderLinks, width: Dp) {
    Column(
        Modifier.width(width).combinedClickable(
            onClick = { links.selection.tap(folder.id) { links.onOpen(folder.id) } },
            onLongClick = { links.selection.toggle(folder.id) },
            onLongClickLabel = "Select",
        ),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        val selected = folder.id in links.selection
        // A selected folder keeps its tile as a tinted frame around the check, as a selected row is tinted.
        val frame = if (selected) Modifier.clip(MaterialTheme.shapes.medium) else Modifier
        Box(frame.selectedBackground(selected)) {
            SelectablePicture(selected, width) {
                FolderThumbnail(folder.locked, links.covers[folder.id], size = width)
            }
        }
        NameWithStar(
            folder.name,
            folder.id in links.starredIds,
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
        )
    }
}

/** A document of a folder shown as a list: every row the same height, whatever the document is. */
@Composable
internal fun FolderDocumentRow(doc: DocumentDto, filter: DocumentFilter, actions: RowActions, layout: FeedLayout) {
    DocumentRow(
        name = doc.original_filename,
        meta = folderRowMeta(doc, filter, layout.today, layout.zone),
        onClick = { actions.onClick(doc) },
        onLongClick = { actions.onLongClick(doc) },
        modifier = Modifier.documentSharedBounds(doc.id),
        selected = actions.selected(doc),
        starred = actions.starred(doc),
    ) { DocumentRowPicture(doc) }
}
