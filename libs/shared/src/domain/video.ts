/**
 * Offset (ms) into a video at which the backend grabs its poster/thumbnail frame
 * (ffmpeg `-ss`), and — mirrored on the client — where the player parks its FIRST
 * rendered frame so the poster→video crossfade on open reveals a matching frame
 * (the thumbnail appears to come alive rather than cut).
 *
 * Chosen just under 500ms on purpose: Media3's position display rounds to the
 * nearest second ((ms + 500) / 1000), so the parked frame still reads `0:00` rather
 * than `0:01`. On the user's first play the client rewinds to 0, so no intro is lost.
 *
 * The Android client can't import this TS package, so it hand-mirrors this value —
 * keep `VIDEO_POSTER_FRAME_MS` in `apps/android/.../document/DocumentPage.kt` in sync.
 */
export const VIDEO_POSTER_FRAME_MS = 490;

/** The same offset as an ffmpeg `-ss` argument (seconds), e.g. "0.49". */
export const VIDEO_POSTER_FRAME_SECONDS = String(VIDEO_POSTER_FRAME_MS / 1000);
