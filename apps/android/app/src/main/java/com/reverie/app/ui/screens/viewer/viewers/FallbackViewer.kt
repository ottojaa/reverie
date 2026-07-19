package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailRef
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.fileTypeVisual
import com.reverie.app.util.formatBytes

/**
 * Shown for file types with no in-app viewer. When the document has a rendered thumbnail
 * (e.g. office docs converted server-side), show that as a page preview; otherwise fall back
 * to a file-type icon. Either way, offers a download of the original.
 */
@Composable
fun FallbackViewer(
    document: DocumentDto,
    onDownload: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasThumbnail = document.hasRenderedThumbnail

    Column(
        modifier = modifier
            .fillMaxSize()
            // Opaque backdrop so the dive-hero thumbnail beneath the viewer doesn't show through.
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (hasThumbnail) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(ThumbnailRef(document.id, ThumbnailSize.LG))
                    .build(),
                contentDescription = document.original_filename,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 520.dp)
                    .clip(RoundedCornerShape(12.dp)),
            )
        } else {
            val visual = fileTypeVisual(document.mime_type, document.original_filename)
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                modifier = Modifier.size(80.dp),
            ) {
                Icon(
                    visual.icon,
                    contentDescription = null,
                    tint = visual.tint,
                    modifier = Modifier
                        .padding(20.dp)
                        .size(40.dp),
                )
            }
        }
        Text(
            text = document.original_filename,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 20.dp),
        )
        Text(
            text = "${formatBytes(document.size_bytes)} · ${if (hasThumbnail) "Preview — download to open" else "Preview not available"}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
        Button(onClick = onDownload, modifier = Modifier.padding(top = 24.dp)) {
            Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("  Download")
        }
    }
}
