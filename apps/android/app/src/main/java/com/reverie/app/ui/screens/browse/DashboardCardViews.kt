package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.TopTypeDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.ui.theme.GeistMonoFontFamily
import com.reverie.app.util.formatBytes

/** Every card is this tall, so the half-width Videos and Files cards line up with Photos. */
private val CARD_HEIGHT = 150.dp
private val CARD_SHAPE = RoundedCornerShape(20.dp)
private val CARD_GAP = 8.dp
private const val TILE_GAP = 2

/**
 * The dashboard's picture cards, one row each as [dashboardCards] lays them out. A card opens its kind
 * as a screen of its own.
 */
@Composable
fun KindCards(
    cards: List<List<KindCard>>,
    photos: List<DocumentDto>,
    video: DocumentDto?,
    onOpen: (DocumentKind) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(CARD_GAP)) {
        cards.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(CARD_GAP), modifier = Modifier.fillMaxWidth()) {
                row.forEach { card ->
                    val open = { onOpen(card.kind) }
                    when (card.kind) {
                        DocumentKind.IMAGE -> PhotosCard(card, photos, open, Modifier.weight(1f))
                        DocumentKind.VIDEO -> VideosCard(card, video, open, Modifier.weight(1f))
                        DocumentKind.FILE -> FilesCard(card, open, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun CardFrame(title: String, card: KindCard, onClick: () -> Unit, height: androidx.compose.ui.unit.Dp, modifier: Modifier, wide: Boolean, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier
            .height(height)
            .clip(CARD_SHAPE)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClickLabel = "Open $title", onClick = onClick)
            .semantics { contentDescription = title + (figures(card)?.let { ", $it" } ?: "") },
    ) {
        content()
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.78f))))
        Column(Modifier.align(Alignment.BottomStart).padding(start = if (wide) 16.dp else 14.dp, bottom = if (wide) 12.dp else 10.dp)) {
            Text(title, color = Color.White, fontSize = if (wide) 20.sp else 17.sp, lineHeight = if (wide) 26.sp else 22.sp, fontWeight = FontWeight.SemiBold)
            figures(card)?.let { Text(it, color = Color.White.copy(alpha = 0.75f), fontSize = if (wide) 13.sp else 12.sp, lineHeight = 16.sp) }
        }
    }
}

/** "38 · 210 MB"; null when the server hasn't told the figures yet. */
fun figures(card: KindCard): String? {
    val count = card.count ?: return null
    val bytes = card.bytes ?: return count.toString()
    return "$count · ${formatBytes(bytes)}"
}

@Composable
private fun PhotosCard(card: KindCard, photos: List<DocumentDto>, onClick: () -> Unit, modifier: Modifier) {
    CardFrame("Photos", card, onClick, CARD_HEIGHT, modifier, wide = true) {
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(TILE_GAP.dp)) {
            photos.take(PHOTO_PREVIEW_COUNT).forEach { photo -> Thumb(photo, Modifier.weight(1f).fillMaxHeight()) }
        }
    }
}

@Composable
private fun VideosCard(card: KindCard, video: DocumentDto?, onClick: () -> Unit, modifier: Modifier) {
    CardFrame("Videos", card, onClick, CARD_HEIGHT, modifier, wide = false) {
        video?.let { Thumb(it, Modifier.fillMaxSize()) }
        Box(
            Modifier.align(Alignment.TopEnd).padding(12.dp).size(32.dp).background(Color.Black.copy(alpha = 0.45f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun Thumb(doc: DocumentDto, modifier: Modifier) = DocumentThumbnail(
    documentId = doc.id,
    mimeType = doc.mime_type,
    filename = doc.original_filename,
    blurhash = doc.thumbnail_blurhash,
    hasThumbnail = doc.hasRenderedThumbnail,
    modifier = modifier,
    size = ThumbnailSize.MD,
)

@Composable
private fun FilesCard(card: KindCard, onClick: () -> Unit, modifier: Modifier) {
    CardFrame("Files", card, onClick, CARD_HEIGHT, modifier, wide = false) {
        TypeBlocks(card.topTypes.take(4))
    }
}

/** The file types as blocks that fill the card edge to edge: one, two side by side, or a 2×2 grid. */
@Composable
private fun TypeBlocks(types: List<TopTypeDto>) {
    val columns = types.chunked(2)
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(TILE_GAP.dp)) {
        columns.ifEmpty { listOf(emptyList()) }.forEach { pair ->
            Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(TILE_GAP.dp)) {
                pair.forEach { type -> TypeBlock(type.ext, Modifier.weight(1f).fillMaxHeight()) }
                // A row with one type (an odd count of 3) keeps the empty half neutral.
                if (pair.size == 1 && types.size > 1) Box(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerHighest))
                if (pair.isEmpty()) Box(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerHighest))
            }
        }
    }
}

/** One file type, coloured as the file rows colour it, its extension near the top. */
@Composable
private fun TypeBlock(ext: String, modifier: Modifier) {
    val tint = fileTypeVisual(mime = "", filename = "file.$ext").tint
    val base = MaterialTheme.colorScheme.surfaceContainerHighest
    Box(modifier.background(tint.copy(alpha = 0.30f).compositeOver(base)), contentAlignment = Alignment.TopCenter) {
        Text(
            // The rows label the same documents with this rule, so a MIME-subtype "extension" reads FILE here too.
            text = fileTypeLabel(mime = "", filename = "file.$ext"),
            color = tint,
            fontFamily = GeistMonoFontFamily,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
