package com.reverie.app.ui.screens.viewer.viewers

import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource.MediaPeriodId
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import org.junit.Assert.assertTrue
import org.junit.Test

@androidx.annotation.OptIn(UnstableApi::class)
class VideoLoadControlTest {
    private fun parameters(bufferedMs: Long) = LoadControl.Parameters(
        PlayerId.UNSET,
        Timeline.EMPTY,
        MediaPeriodId(Any()),
        0L,
        bufferedMs * 1000,
        1f,
        true,
        false,
        androidx.media3.common.C.TIME_UNSET,
    )

    /** Fills the player's allocator the way a downloading high-bitrate file does. */
    private fun bufferedBytesWhenLoadingStops(loadControl: DefaultLoadControl): Int {
        loadControl.onPrepared(PlayerId.UNSET)
        loadControl.onTracksSelected(
            parameters(0),
            TrackGroupArray.EMPTY,
            emptyArray<ExoTrackSelection?>(),
        )
        val allocator = loadControl.allocator
        val held = ArrayList<Any>()
        // A bitrate so high that the buffer's duration never reaches the maximum: only the byte cap can stop it.
        while (loadControl.shouldContinueLoading(parameters(bufferedMs = 1_000))) {
            if (allocator.totalBytesAllocated > 2 * 1024 * 1024 * 1024L) error("Loading never stopped")
            held.add(allocator.allocate())
        }
        return allocator.totalBytesAllocated
    }

    @Test
    fun `loading stops once the byte cap is buffered`() {
        val stoppedAt = bufferedBytesWhenLoadingStops(buildVideoLoadControl())

        assertTrue(stoppedAt >= MAX_BUFFER_BYTES)
        assertTrue("buffered $stoppedAt bytes", stoppedAt <= MAX_BUFFER_BYTES + 1024 * 1024)
    }
}
