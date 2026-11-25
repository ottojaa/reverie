package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.network.HttpException
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.image.thumbnailMemoryCacheKey
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.util.formatDuration

/**
 * The thumbnail fill for a document: a cropped image, or — when there's no rendered preview — a
 * centered file-type icon over a subtle type-colored wash, with the filename beneath it so files
 * with no picture (binaries, archives, .apk, …) are still tellable apart at a glance. Primitive
 * overload so callers backed by a [DocumentDto] AND by a search result (a different DTO) can share
 * one implementation.
 */
@Composable
fun DocumentThumbnail(
    documentId: String,
    mimeType: String,
    filename: String,
    blurhash: String?,
    hasThumbnail: Boolean,
    modifier: Modifier = Modifier,
    size: ThumbnailSize = ThumbnailSize.MD,
    // READ_ONLY reads a thumbnail some other screen already cached but never writes one.
    diskCachePolicy: CachePolicy = CachePolicy.ENABLED,
) {
    if (hasThumbnail) {
        val placeholder = rememberBlurhashPainter(blurhash)
        val onMissed = LocalOnThumbnailMissed.current
        Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
            AsyncImage(
                // Explicit memory-cache key so the viewer can reuse this exact decoded bitmap as
                // its placeholder during the container transform (see thumbnailMemoryCacheKey).
                model = ImageRequest.Builder(LocalContext.current)
                    .data(ThumbnailRef(documentId, size))
                    .memoryCacheKey(thumbnailMemoryCacheKey(documentId, size))
                    .diskCachePolicy(diskCachePolicy)
                    // Coil loads again only when the request differs. This makes it differ when a
                    // missed thumbnail starts being awaited, and again when its job has finished.
                    .setParameter("awaited", documentId in LocalAwaitedThumbnails.current)
                    .build(),
                contentDescription = filename,
                contentScale = ContentScale.Crop,
                placeholder = placeholder,
                error = placeholder,
                // Only a refusal from the server: an unreachable server says nothing about the job.
                onError = { if (it.result.throwable is HttpException) onMissed(documentId) },
                modifier = Modifier.matchParentSize(),
            )
        }
        return
    }

    // No picture: a type-colored icon + the filename, on a faint wash of the same accent — mirrors
    // the web preview page, which tints common types so documents don't all read as blank cards.
    val visual = fileTypeVisual(mimeType, filename)
    Column(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
            .background(visual.tint.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = visual.icon,
            contentDescription = null,
            tint = visual.tint,
            modifier = Modifier.size(34.dp),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = filename,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * A gallery tile's full visual: the [DocumentThumbnail] fill plus the overlays that let file types
 * read at a glance — a duration badge on videos and, for previewable documents, an extension chip,
 * both in the top corner. Shared by the document grid ([DocumentCard]) and the Search grid.
 */
@Composable
fun GalleryThumbnail(
    documentId: String,
    mimeType: String,
    filename: String,
    blurhash: String?,
    hasThumbnail: Boolean,
    modifier: Modifier = Modifier,
    size: ThumbnailSize = ThumbnailSize.MD,
    durationSeconds: Double? = null,
    isStarred: Boolean = false,
) {
    val kind = DocumentKind.of(mimeType)
    val isVideo = kind == DocumentKind.VIDEO
    val isImage = kind == DocumentKind.IMAGE
    Box(modifier) {
        DocumentThumbnail(
            documentId = documentId,
            mimeType = mimeType,
            filename = filename,
            blurhash = blurhash,
            hasThumbnail = hasThumbnail,
            size = size,
            modifier = Modifier.matchParentSize(),
        )
        // The top corner, shared: the favourite star, then a video's badge or a type chip.
        Row(
            modifier = Modifier.align(Alignment.TopEnd).padding(6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isStarred) StarredBadge()
            if (isVideo) VideoBadge(durationSeconds)
            // A previewable document (a rendered PDF/office page) still needs a type marker; files with
            // no preview already show their icon + name in the fill, so a corner chip would be redundant.
            if (!isImage && !isVideo && hasThumbnail) FileTypeBadge(mime = mimeType, filename = filename)
        }
    }
}

/** The one mark of a video on a tile: a play triangle and, when it is known, the length. */
@Composable
internal fun VideoBadge(seconds: Double?, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp))
            .padding(start = 4.dp, top = 2.dp, end = 6.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(Icons.Filled.PlayArrow, contentDescription = "Video", tint = Color.White, modifier = Modifier.size(12.dp))
        if (seconds == null) return@Row
        Text(
            text = formatDuration(seconds),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, letterSpacing = 0.sp, fontFeatureSettings = "tnum"),
            color = Color.White,
        )
    }
}

/** Corner chip naming a previewable document's type (e.g. PDF, DOCX) so it stands out in the grid. */
@Composable
private fun FileTypeBadge(mime: String, filename: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = fileTypeLabel(mime, filename),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
        )
    }
}

/** Short uppercase label for a file: its extension when short, else a MIME-derived fallback. */
internal fun fileTypeLabel(mime: String, filename: String): String {
    val ext = filename.substringAfterLast('.', "").uppercase()
    if (ext.isNotEmpty() && ext.length <= 4) return ext
    return when {
        mime == "application/pdf" -> "PDF"
        mime == "application/json" -> "JSON"
        mime.startsWith("text/") -> "TXT"
        else -> "FILE"
    }
}
