package com.reverie.app.ui.screens.viewer.viewers

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * HTML5-style video playback against the signed URL, with Media3's built-in controls.
 *
 * The default SurfaceView PlayerView keeps its OPAQUE shutter (the fill Media3 paints over the video
 * surface until the first frame decodes). A transparent shutter over a SurfaceView would punch a
 * hole through to the window and flash, so we leave the opaque default in place; DocumentPage draws
 * the letterbox fill behind this view and holds a matching fill cover ON TOP until
 * [onFirstFrameRendered] fires — so neither the shutter nor the surface's pre-first-frame state
 * (black, or a one-frame stretch) is ever seen.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun VideoViewer(
    fileUrl: String?,
    modifier: Modifier = Modifier,
    // The ExoPlayer lives with this composable, so composing it early lets the media fetch/buffer
    // run through the open dive. The PlayerView surface only attaches while this is true — flipped
    // on one frame after the dive settles (inflation never hitches the morph) and off the instant
    // a dive-back starts (the shrink never composes a live surface).
    mountSurface: Boolean = true,
    // Reports whether the app chrome should be hidden: true while the video plays OR its own Media3
    // controls are showing, so the app's bars never sit over the video controls (and playback stays
    // immersive). Tapping a paused video dismisses the controls → chrome returns.
    onChromeHidden: (Boolean) -> Unit = {},
    // Fired once the decoder has rendered its first frame. DocumentPage holds a fill cover over this
    // player until then, so the black surface (buffering) and any first-frame stretch are hidden.
    onFirstFrameRendered: () -> Unit = {},
) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val player = remember { ExoPlayer.Builder(context).build() }
    val currentOnChromeHidden by rememberUpdatedState(onChromeHidden)
    val currentOnFirstFrame by rememberUpdatedState(onFirstFrameRendered)

    // Controller auto-show is disabled (see the factory below), so the controls start hidden and
    // the app chrome stays put after the open dive; hide the chrome whenever the user brings the
    // controls up or the video is playing (report the OR of the two).
    var controlsVisible by remember { mutableStateOf(false) }
    var isPlaying by remember { mutableStateOf(false) }
    LaunchedEffect(controlsVisible, isPlaying) { currentOnChromeHidden(controlsVisible || isPlaying) }

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

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onRenderedFirstFrame() { currentOnFirstFrame() }
        }
        player.addListener(listener)
        onDispose {
            // Leaving the page (or swapping the player) should never strand the chrome hidden.
            currentOnChromeHidden(false)
            player.removeListener(listener)
            player.release()
        }
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

    // Dropping the surface mid-playback (dive-back) keeps this composable alive until the page
    // unmounts — pause so the audio doesn't keep running over the shrink.
    LaunchedEffect(mountSurface) { if (!mountSurface) player.pause() }

    Box(modifier.fillMaxSize()) {
        if (mountSurface) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        this.player = player
                        setShowNextButton(false)
                        setShowPreviousButton(false)
                        // No controller auto-show on attach: it flipped the app chrome right back
                        // out after the open dive faded it in (app bars in → out → Media3 bars in).
                        // The controls still toggle on tap, so the chrome swaps only when the user
                        // asks.
                        setControllerAutoShow(false)
                        // Opaque default shutter (no transparent hole); the fill cover in
                        // DocumentPage sits over it until the first frame, so its colour is never
                        // seen. Mirror Media3's control-overlay visibility into the app chrome (see
                        // the LaunchedEffect above), so the app bars hide while the controls are up
                        // and return when they dismiss.
                        setControllerVisibilityListener(
                            PlayerView.ControllerVisibilityListener { visibility ->
                                controlsVisible = visibility == android.view.View.VISIBLE
                            },
                        )
                        // Enabling the listener surfaces Media3's built-in fullscreen toggle in the
                        // controls; it reports the requested state, which we drive orientation +
                        // immersion from.
                        setFullscreenButtonClickListener { fullscreen = it }
                    }
                },
                update = { view -> view.setFullscreenButtonState(fullscreen) },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
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
