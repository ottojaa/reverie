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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.screens.browse.FeedSource
import com.reverie.app.ui.theme.ReverieTheme

private val SMALL_CARD_HEIGHT = 124.dp
private val CARD_GAP = 10.dp

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

/** The Files card: up to two of the newest files as sheets of paper lying on it. */
@Composable
private fun FilesCard(count: Int?, files: List<DocumentDto>, onOpen: (DocumentKind) -> Unit, modifier: Modifier) {
    CardFrame(onClick = { onOpen(DocumentKind.FILE) }, modifier) {
        // Drawn in this order, so the second sheet lies over the first.
        files.getOrNull(0)?.let { Sheet(it, Modifier.offset(x = 24.dp, y = 14.dp).rotate(8f)) }
        files.getOrNull(1)?.let { Sheet(it, Modifier.offset(x = (-14).dp, y = 18.dp).rotate(-6f)) }
        // Solid by the label's height, so the name never competes with the sheets under it.
        Scrim(from = 0.15f, to = ReverieTheme.cardColor, reachedAt = 0.65f)
        CardLabel(DocumentKind.FILE, count, isLarge = false, MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun CardFrame(onClick: () -> Unit, modifier: Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier = modifier.clip(MaterialTheme.shapes.large).background(ReverieTheme.cardColor).clickable(onClick = onClick),
        content = content,
    )
}

@Composable
private fun BoxScope.Sheet(document: DocumentDto, placement: Modifier) {
    val shape = MaterialTheme.shapes.small
    TilePicture(
        document,
        Modifier.align(Alignment.TopCenter).then(placement).size(width = 64.dp, height = 84.dp)
            .shadow(3.dp, shape).clip(shape),
    )
}

/** Fades the card into [to], from [from] of its height; [to] is reached at [reachedAt] and held to the foot. */
@Composable
private fun BoxScope.Scrim(from: Float, to: Color, reachedAt: Float = 1f) {
    val brush = Brush.verticalGradient(from to to.copy(alpha = 0f), reachedAt to to)
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
