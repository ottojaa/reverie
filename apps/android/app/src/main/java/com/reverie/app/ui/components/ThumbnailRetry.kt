package com.reverie.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.processing.MissedThumbnails

/** Ids of the missed thumbnails that may still appear. See [RetryMissedThumbnails]. */
val LocalAwaitedThumbnails = compositionLocalOf<Set<String>> { emptySet() }

/** Called with a document's id when the server had no thumbnail for it. */
val LocalOnThumbnailMissed = compositionLocalOf<(String) -> Unit> { {} }

/**
 * Makes every [DocumentThumbnail] inside [content] load again once a thumbnail it missed can be
 * there. Provided once around the app, so that no screen has to do anything for it.
 */
@Composable
fun RetryMissedThumbnails(thumbnails: MissedThumbnails, content: @Composable () -> Unit) {
    LaunchedEffect(thumbnails) { thumbnails.follow() }
    val awaited by thumbnails.awaited.collectAsStateWithLifecycle()
    CompositionLocalProvider(
        LocalAwaitedThumbnails provides awaited,
        LocalOnThumbnailMissed provides thumbnails::add,
        content = content,
    )
}
