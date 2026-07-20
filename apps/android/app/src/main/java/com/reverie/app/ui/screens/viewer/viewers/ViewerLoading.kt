package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.graphics.graphicsLayer
import kotlinx.coroutines.delay

// A file already on disk decodes in tens of ms; showing a spinner for that long only flashes it.
// Hold the spinner back until a load has genuinely stalled past this threshold.
private const val SPINNER_DELAY_MS = 120L
private const val CONTENT_FADE_MS = 180

/**
 * Loading scaffold shared by the file-backed viewers (text, PDF), which had the identical
 * immediate-spinner pattern. [value] is the loaded payload (null = still loading); [failed]
 * short-circuits to [failureText]. The spinner appears only once a load outlasts
 * [SPINNER_DELAY_MS], so fast (cached) loads never flash it — and when a spinner WAS shown, the
 * ready [content] fades in over it. On the fast path the content is shown outright: DocumentPage
 * already fades the whole viewer in over its dive stand-in, so a second fade would only compound.
 */
@Composable
fun <T> ViewerContent(
    value: T?,
    failed: Boolean,
    failureText: String,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    // Hoisted across the loading→content branch switch so the content knows whether it's replacing
    // a visible spinner (→ fade in) or appearing on the fast path (→ show outright).
    var spinnerShown by remember { mutableStateOf(false) }

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
                    delay(SPINNER_DELAY_MS)
                    show = true
                    spinnerShown = true
                }
                if (show) CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            spinnerShown -> {
                val contentAlpha = remember { Animatable(0f) }
                LaunchedEffect(Unit) { contentAlpha.animateTo(1f, tween(CONTENT_FADE_MS)) }
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = contentAlpha.value }) { content(value) }
            }
            else -> content(value)
        }
    }
}
