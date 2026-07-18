package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/** HTML5-style video playback against the signed URL, with Media3's built-in controls. */
@OptIn(UnstableApi::class)
@Composable
fun VideoViewer(
    fileUrl: String?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val player = remember { ExoPlayer.Builder(context).build() }

    // The signed file_url is never cached, so it arrives only after the network fetch —
    // on first composition fileUrl is null. Load the media when it lands. Key on the path
    // (minus the ?e/?s signature) so a signature rotation from a realtime refresh or a
    // rename doesn't reset playback mid-watch.
    val urlKey = fileUrl?.substringBefore('?')
    LaunchedEffect(urlKey) {
        if (fileUrl == null) return@LaunchedEffect
        player.setMediaItem(MediaItem.fromUri(fileUrl))
        player.prepare()
        player.playWhenReady = false
    }

    DisposableEffect(Unit) {
        onDispose { player.release() }
    }

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                setShowNextButton(false)
                setShowPreviousButton(false)
            }
        },
        modifier = modifier.fillMaxSize(),
    )
}
