package com.reverie.app.ui.screens.viewer.viewers

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/** HTML5-style video playback against the signed URL, with Media3's built-in controls. */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun VideoViewer(
    fileUrl: String?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val player = remember { ExoPlayer.Builder(context).build() }

    // Fullscreen = rotate to landscape + hide the system bars (and, transitively, the app chrome
    // that lives behind them). Persisted across config changes so a rotation doesn't drop us out.
    var fullscreen by rememberSaveable { mutableStateOf(false) }

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

    // Drive orientation + immersive bars off the fullscreen flag. The onDispose restores portrait
    // and the system bars, so navigating back (or being replaced) never strands the app in
    // landscape/immersive.
    DisposableEffect(activity, fullscreen) {
        val window = activity?.window
        val controller = window?.let { WindowInsetsControllerCompat(it, it.decorView) }
        if (fullscreen && activity != null) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            controller?.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller?.hide(WindowInsetsCompat.Type.systemBars())
        } else if (activity != null) {
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            controller?.show(WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            controller?.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                setShowNextButton(false)
                setShowPreviousButton(false)
                // Enabling the listener surfaces Media3's built-in fullscreen toggle in the controls;
                // it reports the requested state, which we drive orientation + immersion from.
                setFullscreenButtonClickListener { fullscreen = it }
            }
        },
        update = { view -> view.setFullscreenButtonState(fullscreen) },
        modifier = modifier.fillMaxSize(),
    )
}

/** Unwrap the (possibly ContextWrapper-wrapped) Compose context to the hosting Activity. */
private fun Context.findActivity(): Activity? {
    var ctx: Context = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}
