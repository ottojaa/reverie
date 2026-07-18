package com.reverie.app.ui.navigation

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.reverie.app.data.settings.AppSettings

// TEMPORARY / DEV TUNING ──────────────────────────────────────────────────────────────────────
// Runtime-tunable motion parameters, exposed via the "Motion (dev)" card in Settings (debug only).
// [MotionTuning.spec] is read directly by the non-composable NavHost transition lambdas in
// Motion.kt (a plain snapshot read outside composition returns the current value) AND by composable
// readers (dive boundsTransform, bottom-bar / viewer-toolbar timings), which recompose on change.
// Once the values are dialed in on-device, bake them into [MotionSpec.Default] and delete this
// holder + the dev Settings card + the DataStore motion fields.

/** Named easing curves selectable from the dev tuning UI. */
enum class EasingPreset {
    STANDARD,
    EMPHASIZED,
    EMPHASIZED_DECELERATE,
    EMPHASIZED_ACCELERATE,
    LINEAR,
    FAST_OUT_SLOW_IN,
    ;

    fun toEasing(): Easing = when (this) {
        STANDARD -> CubicBezierEasing(0.2f, 0f, 0f, 1f)
        EMPHASIZED -> CubicBezierEasing(0.2f, 0f, 0f, 1f)
        EMPHASIZED_DECELERATE -> CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
        EMPHASIZED_ACCELERATE -> CubicBezierEasing(0.3f, 0f, 1f, 1f)
        LINEAR -> LinearEasing
        FAST_OUT_SLOW_IN -> FastOutSlowInEasing
    }
}

fun String.toEasingPreset(): EasingPreset =
    runCatching { EasingPreset.valueOf(this) }.getOrNull() ?: EasingPreset.FAST_OUT_SLOW_IN

/** The full set of tunable motion values. Defaults mirror the previous compile-time constants. */
data class MotionSpec(
    /** Directional (shared-axis) page-transition duration. */
    val navMs: Int = 300,
    val directionalEasing: EasingPreset = EasingPreset.FAST_OUT_SLOW_IN,
    /** Fraction of the container width the shared-axis slide travels. */
    val slideFraction: Float = 0.10f,
    /** Predictive-back pop scale target. */
    val popScale: Float = 0.9f,
    /** Portion of [navMs] the outgoing content fades over (the rest is the incoming fade). */
    val progressThreshold: Float = 0.35f,
    /** Container-transform (document open/close) duration. */
    val diveMs: Int = 350,
    val diveEasing: EasingPreset = EasingPreset.EMPHASIZED,
    /** Bottom-nav re-entrance duration. */
    val barEnterMs: Int = 300,
    /** Viewer toolbar exit (slide-up + fade) duration on back. */
    val toolbarExitMs: Int = 200,
) {
    companion object {
        val Default = MotionSpec()
    }
}

/** Process-global runtime motion spec. Backed by snapshot state so composable readers react. */
object MotionTuning {
    var spec by mutableStateOf(MotionSpec.Default)
}

/** Bridge the persisted DataStore settings into a [MotionSpec] for the runtime holder. */
fun AppSettings.toMotionSpec(): MotionSpec = MotionSpec(
    navMs = motionNavMs,
    directionalEasing = motionDirectionalEasing.toEasingPreset(),
    slideFraction = motionSlideFraction,
    popScale = motionPopScale,
    diveMs = motionDiveMs,
    diveEasing = motionDiveEasing.toEasingPreset(),
    barEnterMs = motionBarEnterMs,
    toolbarExitMs = motionToolbarExitMs,
)
