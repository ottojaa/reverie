package com.reverie.app.ui.screens.viewer.viewers

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.min

/** Renders a PDF (from the on-disk cache) as a vertically-scrolling list of page bitmaps. */
@Composable
fun PdfViewer(
    loadFile: suspend () -> File,
    modifier: Modifier = Modifier,
) {
    var pages by remember { mutableStateOf<List<Bitmap>?>(null) }
    var failed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching {
            val file = loadFile()
            withContext(Dispatchers.IO) { renderPdf(file, RENDER_WIDTH) }
        }.onSuccess { pages = it }.onFailure { failed = true }
    }

    // Clear the status bar + the floating viewer toolbar so the first page isn't hidden beneath them.
    val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + VIEWER_TOOLBAR_INSET
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            failed -> Text(
                text = "Couldn't open this PDF",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            pages == null -> CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            // Opaque backdrop so the dive-hero thumbnail (drawn beneath every viewer for the
            // container transform) doesn't bleed through the page gaps/padding once pages render.
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.background),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = topInset, bottom = 12.dp),
                verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
            ) {
                items(pages!!) { bitmap ->
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(androidx.compose.ui.graphics.Color.White),
                    )
                }
            }
        }
    }
}

private fun renderPdf(file: File, width: Int): List<Bitmap> {
    val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    PdfRenderer(descriptor).use { renderer ->
        val count = min(renderer.pageCount, MAX_PAGES)
        return (0 until count).map { index ->
            renderer.openPage(index).use { page ->
                val height = (width.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }
        }
    }
}

private const val RENDER_WIDTH = 1240
private const val MAX_PAGES = 60
