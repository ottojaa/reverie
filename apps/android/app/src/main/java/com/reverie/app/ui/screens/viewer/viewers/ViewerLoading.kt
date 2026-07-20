package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.delay

// A file already on disk decodes in tens of ms; showing a loader for that long only flashes it.
// Hold the loading bar back until a load has genuinely stalled past this threshold.
private const val LOADER_DELAY_MS = 120L
private const val CONTENT_FADE_MS = 180

/**
 * Loading scaffold shared by the file-backed viewers (text, PDF), which had the identical
 * immediate-loader pattern. [value] is the loaded payload (null = still loading); [failed]
 * short-circuits to [failureText]. [progress] is the download fraction (0f‥1f) when the streamed
 * length is known — the loading bar renders determinate then, indeterminate while it's still null.
 * The bar appears only once a load outlasts [LOADER_DELAY_MS], so fast (cached) loads never flash
 * it — and when the bar WAS shown, the ready [content] fades in over it. On the fast path the
 * content is shown outright: DocumentPage already fades the whole viewer in over its dive stand-in,
 * so a second fade would only compound.
 */
@Composable
fun <T> ViewerContent(
    value: T?,
    failed: Boolean,
    failureText: String,
    modifier: Modifier = Modifier,
    progress: Float? = null,
    content: @Composable (T) -> Unit,
) {
    // Hoisted across the loading→content branch switch so the content knows whether it's replacing
    // a visible loader (→ fade in) or appearing on the fast path (→ show outright).
    var loaderShown by remember { mutableStateOf(false) }

    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            failed -> Text(
                text = failureText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            value == null -> {
                var show by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    delay(LOADER_DELAY_MS)
                    show = true
                    loaderShown = true
                }
                // Pinned to the top of the screen (just below the status bar), not centered — a
                // download/loading bar reads as page chrome up top, not a mid-screen element.
                if (show) ViewerLoadingBar(progress, Modifier.align(Alignment.TopCenter).statusBarsPadding())
            }
            loaderShown -> {
                val contentAlpha = remember { Animatable(0f) }
                LaunchedEffect(Unit) { contentAlpha.animateTo(1f, tween(CONTENT_FADE_MS)) }
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = contentAlpha.value }) { content(value) }
            }
            else -> content(value)
        }
    }
}

/**
 * Full-width download loading bar. Determinate (animated toward the reported fraction so per-percent
 * steps read smoothly) once [progress] is known; indeterminate while it's still null — before the
 * first byte, or when the server sent no Content-Length.
 */
@Composable
private fun ViewerLoadingBar(progress: Float?, modifier: Modifier = Modifier) {
    if (progress == null) {
        LinearProgressIndicator(
            modifier = modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.primary,
        )
        return
    }
    val animated by animateFloatAsState(targetValue = progress, label = "downloadProgress")
    LinearProgressIndicator(
        progress = { animated },
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.primary,
    )
}
