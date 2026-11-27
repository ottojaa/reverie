package com.reverie.app.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeOf
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.theme.ReverieTheme

private val SMALL_CARD_HEIGHT = 124.dp
private val CARD_GAP = 10.dp
private val BLOCK_GAP = 2.dp

/** The three kinds of document as cover cards: Photos tall, Videos over Files beside it. */
@Composable
fun LibraryBento(
    summary: DocumentSummaryDto?,
    covers: KindCovers,
    onOpen: (DocumentKind) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 20.dp, top = 14.dp, end = 20.dp)
            .height(SMALL_CARD_HEIGHT * 2 + CARD_GAP),
        horizontalArrangement = Arrangement.spacedBy(CARD_GAP),
    ) {
        fun count(kind: DocumentKind) = summary?.countOf(kind)
        PictureCard(
            DocumentKind.IMAGE, count(DocumentKind.IMAGE), covers.photo, onOpen,
            Modifier.weight(1f).fillMaxHeight(), isLarge = true,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(CARD_GAP)) {
            val small = Modifier.fillMaxWidth().height(SMALL_CARD_HEIGHT)
            PictureCard(DocumentKind.VIDEO, count(DocumentKind.VIDEO), covers.video, onOpen, small)
            FilesCard(count(DocumentKind.FILE), covers.files, onOpen, small)
        }
    }
}

/** A card filled by one picture, its label on a scrim; plain where there is no picture to show. */
@Composable
private fun PictureCard(
    kind: DocumentKind,
    count: Int?,
    cover: DocumentDto?,
    onOpen: (DocumentKind) -> Unit,
    modifier: Modifier = Modifier,
    isLarge: Boolean = false,
) {
    CardFrame(onClick = { onOpen(kind) }, modifier) {
        val picture = cover?.takeIf { it.hasRenderedThumbnail }
        if (picture != null) {
            TilePicture(picture, Modifier.matchParentSize(), ThumbnailSize.LG)
            Scrim(from = if (isLarge) 0.45f else 0.3f, to = Color.Black.copy(alpha = 0.68f))
        }
        CardLabel(kind, count, isLarge, if (picture != null) Color.White else MaterialTheme.colorScheme.onSurface)
    }
}

/** The Files card: the types of the newest files as four blocks, the name on a scrim over their foot. */
@Composable
private fun FilesCard(count: Int?, files: List<DocumentDto>, onOpen: (DocumentKind) -> Unit, modifier: Modifier) {
    CardFrame(onClick = { onOpen(DocumentKind.FILE) }, modifier) {
        FileBlocks(files, Modifier.matchParentSize())
        Scrim(from = 0.3f, to = Color.Black.copy(alpha = 0.78f))
        CardLabel(DocumentKind.FILE, count, isLarge = false, Color.White)
    }
}

/** Two rows of two, filled left to right; a place with no file for it stays plain. */
@Composable
private fun FileBlocks(files: List<DocumentDto>, modifier: Modifier) {
    Column(modifier.background(MaterialTheme.colorScheme.background), verticalArrangement = Arrangement.spacedBy(BLOCK_GAP)) {
        repeat(2) { row ->
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(BLOCK_GAP)) {
                repeat(2) { column -> FileBlock(files.getOrNull(row * 2 + column), Modifier.weight(1f).fillMaxHeight()) }
            }
        }
    }
}

/** A file's extension on a block tinted by its type. Decoration: the card is read by its name and count. */
@Composable
private fun FileBlock(file: DocumentDto?, modifier: Modifier) {
    if (file == null) {
        val base = MaterialTheme.colorScheme.surfaceContainerHighest
        Box(modifier.background(base).clearAndSetSemantics { testTag = "file-block:plain" })
        return
    }
    val label = fileTypeLabel(file.mime_type, file.original_filename)
    val type = fileTypeOf(file.mime_type, file.original_filename)
    Box(
        modifier.background(type.ground)
            .clearAndSetSemantics { testTag = "file-block:$label" },
        contentAlignment = Alignment.TopCenter,
    ) {
        Text(
            label,
            color = type.ink,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.08.em,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(top = 10.dp),
        )
    }
}

@Composable
private fun CardFrame(onClick: () -> Unit, modifier: Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier = modifier.clip(MaterialTheme.shapes.large).background(ReverieTheme.cardColor).clickable(onClick = onClick),
        content = content,
    )
}

/** Fades the card into [to], from [from] of its height down to the foot. */
@Composable
private fun BoxScope.Scrim(from: Float, to: Color) {
    val brush = Brush.verticalGradient(from to to.copy(alpha = 0f), 1f to to)
    Box(Modifier.matchParentSize().background(brush))
}

@Composable
private fun BoxScope.CardLabel(kind: DocumentKind, count: Int?, isLarge: Boolean, color: Color) {
    val inset = if (isLarge) 16.dp else 14.dp
    Column(Modifier.align(Alignment.BottomStart).padding(start = inset, end = inset, bottom = inset - 2.dp)) {
        Text(
            FeedSource.of(kind).title,
            fontSize = if (isLarge) 20.sp else 17.sp,
            lineHeight = if (isLarge) 26.sp else 22.sp,
            fontWeight = FontWeight.SemiBold,
            color = color,
        )
        if (count == null) return@Column
        Text(count.toString(), fontSize = 13.sp, lineHeight = 18.sp, color = color.copy(alpha = 0.82f))
    }
}
