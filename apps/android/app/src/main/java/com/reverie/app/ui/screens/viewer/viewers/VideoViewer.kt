package com.reverie.app.ui.screens.viewer.viewers

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.reverie.app.data.repository.SignedUrls
import com.reverie.app.di.AuthedOkHttpEntryPoint
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.launch

// Start/resume playback once this little is buffered. The DefaultLoadControl default (2500ms) read
// as "pressed play, nothing happens" on WAN links — the first frame and play-start need far less
// runway, and buffering continues behind playback either way.
private const val BUFFER_FOR_PLAYBACK_MS = 500
private const val BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 1000

// Upper bound on the bytes one player keeps buffered. ExoPlayer's own default is ~144 MB for a
// video + audio file (DefaultLoadControl.DEFAULT_VIDEO_BUFFER_SIZE + DEFAULT_AUDIO_BUFFER_SIZE),
// and that buffer lives on the Java heap, which is only ~192-256 MB per app. A multi-minute
// high-bitrate phone video filled it and the app died with an OutOfMemoryError about a second
// after opening. 32 MB is still ~20 s of a 12 Mbps video and ~2.5 s of 100 Mbps 4K.
internal const val MAX_BUFFER_BYTES = 32 * 1024 * 1024

// The first-play rewind (see posterSeekMs) only fires while the player is still parked at the
// poster frame — if the current position has moved more than this from it, the user scrubbed and
// we leave their position alone. Generous enough to cover keyframe-snap on the initial seek, tight
// enough that any real scrub lands outside it.
private const val REWIND_TOLERANCE_MS = 900L

// Signing again and reloading is tried this many times in a row when the stream's token is refused;
// a successful frame resets the count. Past it we play the original instead of looping on a dead URL.
private const val MAX_TOKEN_REFRESHES = 2

private fun toStreamItem(hlsUrl: String): MediaItem =
    MediaItem.Builder().setUri(hlsUrl).setMimeType(MimeTypes.APPLICATION_M3U8).build()

/** Which source the player is on, and how often the stream's token was just refused. Not UI state. */
private class StreamState {
    var onOriginal = false
    var refreshes = 0

    // The original's URL from the latest signing; the composable's own fileUrl is as old as the page.
    var freshFileUrl: String? = null

    // The rung (by shorter side) the viewer pinned, kept across a reload: signing again builds new
    // track groups, so the override itself no longer matches and is re-applied from this height.
    var pinnedHeight: Int? = null
}

/**
 * The load control for the viewer's players: the default buffer durations, but with the byte cap
 * [MAX_BUFFER_BYTES]. A byte target set explicitly replaces the size-by-track-type default, and
 * because time doesn't take priority over size (the default), loading stops at the byte cap even
 * when less than the maximum buffer duration is buffered.
 */
@androidx.annotation.OptIn(UnstableApi::class)
internal fun buildVideoLoadControl(): DefaultLoadControl =
    DefaultLoadControl.Builder()
        .setBufferDurationsMs(
            DefaultLoadControl.DEFAULT_MIN_BUFFER_MS,
            DefaultLoadControl.DEFAULT_MAX_BUFFER_MS,
            BUFFER_FOR_PLAYBACK_MS,
            BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS,
        )
        .setTargetBufferBytes(MAX_BUFFER_BYTES)
        .setPrioritizeTimeOverSizeThresholds(false)
        .build()

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
    // The HLS master playlist signed with [fileUrl]. When present the video streams its renditions
    // (adaptive, with a quality choice); null — or a stream that fails — plays [fileUrl], the original.
    hlsUrl: String? = null,
    // Signs the URLs again after the stream's token was refused (403/410), so playback that outlives
    // the token resumes in place instead of dropping to the original.
    refreshSignedUrls: suspend () -> SignedUrls? = { null },
    modifier: Modifier = Modifier,
    // The ExoPlayer lives with this composable, so composing it early lets the media fetch/buffer
    // run through the open dive. The PlayerView surface only attaches while this is true — flipped
    // on one frame after the dive settles (inflation never hitches the morph) and off the instant
    // a dive-back starts (the shrink never composes a live surface).
    mountSurface: Boolean = true,
    // Only the page the pager has settled on may buffer. A pager composes its neighbours too, and
    // each preparing player would otherwise pull its own buffer of the file into the app's heap.
    // A page that stops being active drops its media (and the buffer with it); coming back
    // prepares it afresh, so playback restarts from the start.
    active: Boolean = true,
    // When set, the player parks its FIRST rendered frame at this position (ms) instead of t=0, so
    // it matches the thumbnail poster DocumentPage holds over it (the backend grabs the poster at
    // this same offset) — the poster→video crossfade then reveals an identical frame. On the user's
    // first play we rewind to 0 so no intro is lost; ExoPlayer holds the parked frame through that
    // seek, so the rewind isn't visible. Null (thumb-less videos) starts at t=0, no rewind.
    posterSeekMs: Long? = null,
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
    val player = remember {
        // Stream through the app's shared OkHttp client (see AuthedOkHttp): the grid's thumbnail
        // loads keep a warm TLS connection to the same host, so the stream's first byte skips the
        // cold DNS+TCP+TLS handshake a DefaultHttpDataSource would pay.
        val okHttpClient = EntryPointAccessors
            .fromApplication(context.applicationContext, AuthedOkHttpEntryPoint::class.java)
            .okHttpClient()
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(okHttpClient)))
            .setLoadControl(buildVideoLoadControl())
            .build()
    }
    val currentOnChromeHidden by rememberUpdatedState(onChromeHidden)
    val currentOnFirstFrame by rememberUpdatedState(onFirstFrameRendered)
    val currentPosterSeekMs by rememberUpdatedState(posterSeekMs)
    val currentFileUrl by rememberUpdatedState(fileUrl)
    val currentRefresh by rememberUpdatedState(refreshSignedUrls)
    val scope = rememberCoroutineScope()
    val stream = remember { StreamState() }

    // The ladder's rungs and the viewer's choice (null = Auto), mirrored from the player's tracks.
    var qualityLevels by remember { mutableStateOf<List<VideoQualityLevel>>(emptyList()) }
    var pinnedQuality by remember { mutableStateOf<VideoQualityLevel?>(null) }
    var playingQuality by remember { mutableStateOf<String?>(null) }
    var qualityMenuOpen by remember { mutableStateOf(false) }

    // What PlayerView's controls drive. Wraps the ExoPlayer so we can intercept the user's FIRST
    // play and rewind to the start (see posterSeekMs) — but only while still parked at the poster
    // frame, so a scrub-then-play keeps the user's chosen position. The init seek below runs on the
    // wrapped player directly, so it never counts as a play.
    val controllablePlayer = remember(player) {
        RewindOnFirstPlayPlayer(player) { currentPosterSeekMs }
    }

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
    // The HLS URL's token rotates the same way, so key on the set instead of the whole URL.
    val urlKey = hlsUrl?.let(::toHlsSetKey) ?: fileUrl?.substringBefore('?')
    LaunchedEffect(urlKey, active) {
        if (fileUrl == null) return@LaunchedEffect
        if (!active) {
            player.stop()
            player.clearMediaItems()
            return@LaunchedEffect
        }
        controllablePlayer.rearm()
        stream.onOriginal = hlsUrl == null
        stream.refreshes = 0
        stream.freshFileUrl = null
        stream.pinnedHeight = null
        player.setMediaItem(hlsUrl?.let(::toStreamItem) ?: MediaItem.fromUri(fileUrl))
        player.prepare()
        player.playWhenReady = false
        // Park the first frame at the poster offset so the crossfade reveals a matching frame; the
        // wrapper rewinds to 0 on first play. Direct on the wrapped player — not a user play.
        currentPosterSeekMs?.let { player.seekTo(it) }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onRenderedFirstFrame() {
                stream.refreshes = 0
                currentOnFirstFrame()
            }

            override fun onTracksChanged(tracks: Tracks) = syncQuality(tracks)

            override fun onTrackSelectionParametersChanged(parameters: androidx.media3.common.TrackSelectionParameters) =
                syncQuality(player.currentTracks)

            override fun onPlayerError(error: PlaybackException) {
                if (stream.onOriginal) return
                val position = player.currentPosition
                val canRefresh = isTokenRefusal(error) && stream.refreshes < MAX_TOKEN_REFRESHES
                if (!canRefresh) return fallBackToOriginal(stream.freshFileUrl ?: currentFileUrl, position)
                stream.refreshes += 1
                scope.launch {
                    val fresh = currentRefresh()
                    fresh?.let { stream.freshFileUrl = it.fileUrl }
                    val freshHls = fresh?.hlsUrl ?: return@launch fallBackToOriginal(stream.freshFileUrl ?: currentFileUrl, position)
                    player.setMediaItem(toStreamItem(freshHls), position)
                    player.prepare()
                }
            }

            private fun fallBackToOriginal(url: String?, position: Long) {
                stream.onOriginal = true
                url ?: return
                player.setMediaItem(MediaItem.fromUri(url), position)
                player.prepare()
            }

            private fun syncQuality(tracks: Tracks) {
                val levels = toQualityLevels(tracks)
                val override = player.trackSelectionParameters.overrides.values
                    .firstOrNull { it.type == C.TRACK_TYPE_VIDEO }
                qualityLevels = levels
                playingQuality = toPlayingLabel(tracks)
                pinnedQuality = override?.let { o ->
                    levels.firstOrNull { l -> tracks.groups.getOrNull(l.groupIndex)?.mediaTrackGroup == o.mediaTrackGroup && l.trackIndex == o.trackIndices.firstOrNull() }
                }
                // A reloaded stream (fresh signature) has new track groups: put the viewer's rung back.
                val wanted = stream.pinnedHeight
                if (pinnedQuality == null && wanted != null) {
                    levels.firstOrNull { it.height == wanted }?.let { selectQuality(player, it) }
                }
            }
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
                        this.player = controllablePlayer
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
        // Over the video with Media3's own controls (and while its menu is open, so the controls'
        // auto-hide can't pull the menu away mid-choice). Only a stream with more than one rung has
        // anything to choose.
        if (mountSurface && qualityLevels.size > 1 && (controlsVisible || qualityMenuOpen)) {
            QualityMenuButton(
                levels = qualityLevels,
                pinned = pinnedQuality,
                playingLabel = playingQuality,
                expanded = qualityMenuOpen,
                onExpandedChange = { qualityMenuOpen = it },
                onSelect = { level ->
                    qualityMenuOpen = false
                    stream.pinnedHeight = level?.height
                    selectQuality(player, level)
                },
                modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
            )
        }
    }
}

/**
 * Rewinds to the start on the first play, if the player is still parked at the poster frame (see
 * [VideoViewer]'s posterSeekMs). [rearm] makes the next play rewind again — used when the viewer
 * loads the media afresh and parks at the poster again.
 */
private class RewindOnFirstPlayPlayer(
    private val player: Player,
    private val posterSeekMs: () -> Long?,
) : ForwardingPlayer(player) {
    private var rewound = false

    fun rearm() {
        rewound = false
    }

    override fun play() {
        rewindToStartOnce()
        super.play()
    }

    override fun setPlayWhenReady(playWhenReady: Boolean) {
        if (playWhenReady) rewindToStartOnce()
        super.setPlayWhenReady(playWhenReady)
    }

    private fun rewindToStartOnce() {
        if (rewound) return
        rewound = true
        val poster = posterSeekMs() ?: return
        if (kotlin.math.abs(currentPosition - poster) <= REWIND_TOLERANCE_MS) {
            player.seekTo(0)
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
