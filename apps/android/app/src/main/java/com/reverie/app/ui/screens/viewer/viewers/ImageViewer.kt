package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage

/** Full-resolution image with pinch-zoom/pan; tap toggles the immersive toolbar. */
@Composable
fun ImageViewer(
    fileUrl: String?,
    contentDescription: String,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ZoomableAsyncImage(
        model = fileUrl,
        contentDescription = contentDescription,
        modifier = modifier.fillMaxSize(),
        onClick = { onTap() },
    )
}
